import { streamChat } from "@/lib/llm";
import {
  buildQuoteContext,
  fallbackIntent,
  quoteMessages,
  quoteRevisionMessages,
  type InquiryIntent,
} from "@/lib/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const intent =
    coerceIntent(body.intent) ?? (draft.trim() ? fallbackIntent(draft) : null);
  if (!intent) return badRequest("无法确定询盘意图。");

  const ctx = buildQuoteContext(intent);

  const messages =
    currentQuote && instruction
      ? quoteRevisionMessages(currentQuote, instruction, ctx)
      : quoteMessages(ctx);

  try {
    const stream = await streamChat(messages, { temperature: 0.35, maxTokens: 3000 });
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
