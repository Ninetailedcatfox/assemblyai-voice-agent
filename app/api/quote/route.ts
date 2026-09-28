import { streamChat } from "@/lib/llm";
import { CATALOG } from "@/lib/products";
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

/**
 * 生成英文报价单（流式）。
 * - 常规：传 `draft`（+ 可选 `intent`）→ 生成报价单
 * - 改价：传 `currentQuote` + `instruction` → 在已有报价单上改（对应"口头改价"）
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
  const ctx = buildQuoteContext(
    intent,
    undefined,
    reliableIntent ? 3 : CATALOG.length
  );

  const messages =
    currentQuote && instruction
      ? quoteRevisionMessages(currentQuote, instruction, ctx)
      : quoteMessages(ctx);

  try {
    const stream = await streamChat(messages, {
      temperature: 0.35,
      maxTokens: 2000,
      timeoutMs: 25000,
      totalMs: 55000,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "报价单生成失败，请重试。" },
      { status: 500 }
    );
  }
}
