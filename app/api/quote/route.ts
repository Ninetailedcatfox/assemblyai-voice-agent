import { chatOnce } from "@/lib/llm";
import { CATALOG } from "@/lib/products";
import { buildQuoteDocument, assessQuoteText } from "@/lib/quoteDocument";
import { applyOverrides, parseRevision } from "@/lib/revision";
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
 * `polish: true` 时才启用 LLM 起草措辞，并给它这个时间预算。
 *
 * 默认不用 LLM：实测该中转 TTFB 在 5s~54s 之间随机跳（还会静默换后端模型），
 * 10s 预算下 4/4 次都没赶上。而报价单是 demo 的主产物、是发给客户的成品文件，
 * 让用户每次点"报价"都先干等 10 秒去赌一个大概率失败的请求，是错误的设计。
 * 确定性生成是毫秒级且数字必然准确，所以它是默认；LLM 只作显式开启的措辞优化。
 */
const POLISH_BUDGET_MS = 45000;

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

/** 可选的 LLM 措辞优化；返回 null 表示放弃（超时 / 产物不合格） */
async function tryPolish(
  messages: ReturnType<typeof quoteMessages>,
  incoterm: string
): Promise<{ text: string } | { reason: string }> {
  try {
    const raw = await chatOnce(messages, {
      temperature: 0.35,
      maxTokens: 2000,
      timeoutMs: POLISH_BUDGET_MS,
      totalMs: POLISH_BUDGET_MS + 5000,
      attempts: 1,
    });
    const verdict = assessQuoteText(raw, incoterm);
    if (verdict.ok) return { text: raw.trim() };
    return { reason: `LLM 产物不合格（${verdict.reason}），已改用确定性报价单` };
  } catch {
    return {
      reason: `LLM 未在 ${POLISH_BUDGET_MS / 1000}s 内产出可用结果，已改用确定性报价单`,
    };
  }
}

/**
 * 生成英文报价单。
 * - 常规：传 `draft`（+ 可选 `intent`）→ 生成报价单
 * - 改价：传 `currentQuote` + `instruction` → 在已有报价单上改（对应"口头改价"）
 *
 * 两条路径都**保证返回一份完整可用的报价单**，且默认不依赖 LLM：
 * - 常规：确定性生成（毫秒级，价格/体积重/关税全部来自已算好的上下文）
 * - 改价：把指令解析成结构化覆盖项 → 重算 → 重出，并在单子上写明改了什么
 * 识别不出任何改动时原样退回旧报价单，绝不返回半截内容把已有报价单冲掉。
 */
export async function POST(request: Request) {
  let body: {
    draft?: unknown;
    intent?: unknown;
    currentQuote?: unknown;
    instruction?: unknown;
    polish?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("请求体必须是 JSON。");
  }

  const draft = typeof body.draft === "string" ? body.draft : "";
  const currentQuote = typeof body.currentQuote === "string" ? body.currentQuote.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const polish = body.polish === true;

  if (!draft.trim() && !currentQuote) {
    return badRequest("draft 与 currentQuote 至少要有一个。");
  }

  // 意图来源优先级：
  //   1. 前端回传的结构化 intent（最可靠，来自 analyze 那一步）
  //   2. 从中文询盘原文规则解析
  //   3. 从已有报价单兜底解析 —— 让"只传 currentQuote + instruction"的改价调用也能成立
  const explicit = coerceIntent(body.intent);
  const baseIntent =
    explicit ??
    (draft.trim() ? fallbackIntent(draft) : null) ??
    (currentQuote ? fallbackIntent(currentQuote) : null);
  if (!baseIntent) {
    return badRequest("无法确定询盘意图：draft 与 currentQuote 至少要有一个。");
  }

  // 走到第 3 条时，机型/品类是从英文报价单猜的，基本不可靠；
  // 此时把整个产品库都给模型当价格来源，避免只检索到几个不相干的 SKU。
  const reliableIntent = Boolean(explicit) || Boolean(draft.trim());
  const limit = reliableIntent ? 3 : CATALOG.length;

  const isRevision = Boolean(currentQuote && instruction);

  // ── 改价路径 ──────────────────────────────────────────────────────────
  if (isRevision) {
    const overrides = parseRevision(instruction);

    // 一个可执行的改动都没识别出来：保留原报价单，并说明原因
    if (overrides.unrecognised) {
      return quoteResponse(
        currentQuote,
        "unchanged",
        "未从改价指令中识别出数量/目标价/贸易术语等可执行改动，已保留原报价单"
      );
    }

    const nextIntent = applyOverrides(baseIntent, overrides);
    const nextCtx = buildQuoteContext(nextIntent, undefined, limit);

    if (polish) {
      const r = await tryPolish(
        quoteRevisionMessages(currentQuote, instruction, nextCtx),
        nextIntent.incoterm
      );
      if ("text" in r) return quoteResponse(r.text, "ai");
    }

    return quoteResponse(
      buildQuoteDocument(nextCtx, {
        revision: {
          instruction,
          changes: overrides.changes,
          sampleQty: overrides.sampleQty,
        },
      }),
      "generated"
    );
  }

  // ── 首轮生成 ──────────────────────────────────────────────────────────
  const ctx = buildQuoteContext(baseIntent, undefined, limit);

  if (polish) {
    const r = await tryPolish(quoteMessages(ctx), baseIntent.incoterm);
    if ("text" in r) return quoteResponse(r.text, "ai");
    return quoteResponse(buildQuoteDocument(ctx), "generated", r.reason);
  }

  return quoteResponse(buildQuoteDocument(ctx), "generated");
}
