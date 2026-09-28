import { chatOnce } from "@/lib/llm";
import { CATALOG } from "@/lib/products";
import { buildQuoteDocument, assessQuoteText } from "@/lib/quoteDocument";
import {
  buildQuoteContext,
  fallbackIntent,
  quoteMessages,
  quoteRevisionMessages,
  type InquiryIntent,
} from "@/lib/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 平台函数时长上限，见 analyze 路由同名注释 */
export const maxDuration = 60;

/**
 * 给 LLM 起草报价单的时间预算。
 *
 * 实测该中转的 TTFB 在 5s~54s 之间随机跳（还会静默换后端模型），而这是 demo
 * 的主产物：等 50 秒等于 demo 崩了。所以只给 10 秒 —— 回来就用它的措辞，
 * 回不来就用 `buildQuoteDocument` 确定性生成（毫秒级、数字必然准确）。
 * 单次尝试，不重试：重试只会把等待翻倍，而兜底产物的质量已经够直接发客户。
 */
const DRAFT_BUDGET_MS = 10000;

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** 只信任前端传回的结构化字段，缺项由 buildQuoteContext 兜底 */
function coerceIntent(raw: unknown): InquiryIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string, fb = "") => (typeof o[k] === "string" && o[k] ? (o[k] as string) : fb);
  const num = (k: string, fb: number) => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fb;
  };
  return {
    buyerMarket: str("buyerMarket", "未指明"),
    buyerType: str("buyerType", "买家"),
    category: str("category", "手机配件"),
    models: Array.isArray(o.models)
      ? (o.models as unknown[]).filter((m): m is string => typeof m === "string")
      : ["universal"],
    quantity: Math.round(num("quantity", 1000)),
    targetPriceUsd:
      typeof o.targetPriceUsd === "number" && o.targetPriceUsd > 0 ? o.targetPriceUsd : null,
    timeline: str("timeline"),
    incoterm:
      str("incoterm", "FOB").toUpperCase() === "CIF"
        ? "CIF"
        : str("incoterm", "FOB").toUpperCase() === "DDP"
        ? "DDP"
        : str("incoterm", "FOB").toUpperCase() === "EXW"
        ? "EXW"
        : "FOB",
    needIpClearance: o.needIpClearance === true,
    summary: str("summary"),
  };
}

/** 统一出口：纯文本返回，并声明这份报价单是谁产出的 */
function quoteResponse(text: string, source: string, warning?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Quote-Source": source,
  };
  if (warning) headers["X-Quote-Warning"] = encodeURIComponent(warning.slice(0, 200));
  return new Response(text, { headers });
}

/**
 * 生成英文报价单。
 * - 常规：传 `draft`（+ 可选 `intent`）→ 生成报价单
 * - 改价：传 `currentQuote` + `instruction` → 在已有报价单上改（对应"口头改价"）
 *
 * 两条路径都**保证返回一份完整可用的报价单**：LLM 只负责措辞，产物不合格时
 * 由 `buildQuoteDocument` 确定性兜底；改价路径失败则原样退回旧报价单，
 * 绝不返回半截内容把已有报价单冲掉。
 */
export async function POST(request: Request) {
  let body: {
    draft?: unknown;
    intent?: unknown;
    currentQuote?: unknown;
    instruction?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("请求体必须是 JSON。");
  }

  const draft = typeof body.draft === "string" ? body.draft : "";
  const currentQuote = typeof body.currentQuote === "string" ? body.currentQuote.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";

  if (!draft.trim() && !currentQuote) {
    return badRequest("draft 与 currentQuote 至少要有一个。");
  }

  // 意图来源优先级：
  //   1. 前端回传的结构化 intent（最可靠，来自 analyze 那一步）
  //   2. 从中文询盘原文规则解析
  //   3. 从已有报价单兜底解析 —— 让"只传 currentQuote + instruction"的改价调用也能成立
  //      （此前第 3 条缺失，改价调用会直接 400，与函数上方文档写明的契约不符）
  const explicit = coerceIntent(body.intent);
  const intent =
    explicit ??
    (draft.trim() ? fallbackIntent(draft) : null) ??
    (currentQuote ? fallbackIntent(currentQuote) : null);
  if (!intent) {
    return badRequest("无法确定询盘意图：draft 与 currentQuote 至少要有一个。");
  }

  // 走到第 3 条时，机型/品类是从英文报价单猜的，基本不可靠；
  // 此时把整个产品库都给模型当价格来源，避免只检索到几个不相干的 SKU。
  const reliableIntent = Boolean(explicit) || Boolean(draft.trim());
  const ctx = buildQuoteContext(intent, undefined, reliableIntent ? 3 : CATALOG.length);

  const isRevision = Boolean(currentQuote && instruction);
  const messages = isRevision
    ? quoteRevisionMessages(currentQuote, instruction, ctx)
    : quoteMessages(ctx);

  // ── 让 LLM 试一次，超预算或产物不合格就放弃 ────────────────────────────
  let aiText: string | null = null;
  let reason: string | undefined;
  try {
    const raw = await chatOnce(messages, {
      temperature: 0.35,
      maxTokens: 2000,
      timeoutMs: DRAFT_BUDGET_MS,
      totalMs: DRAFT_BUDGET_MS + 3000,
      attempts: 1,
    });
    const verdict = assessQuoteText(raw, intent.incoterm);
    if (verdict.ok) aiText = raw.trim();
    else reason = `LLM 产物不合格（${verdict.reason}），已改用确定性报价单`;
  } catch (err) {
    reason = `LLM 未在 ${
      DRAFT_BUDGET_MS / 1000
    }s 内产出可用结果，已改用确定性报价单`;
    void err;
  }

  if (isRevision) {
    // 改价路径没法确定性重算（指令是自然语言），失败就原样退回，不破坏已有报价单
    return aiText
      ? quoteResponse(aiText, "ai")
      : quoteResponse(currentQuote, "unchanged", reason);
  }

  return aiText
    ? quoteResponse(aiText, "ai")
    : quoteResponse(buildQuoteDocument(ctx), "generated", reason);
}
