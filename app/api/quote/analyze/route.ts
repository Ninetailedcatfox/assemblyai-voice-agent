import { chatOnce } from "@/lib/llm";
import {
  buildQuoteContext,
  fallbackIntent,
  inquiryMessages,
  parseInquiry,
  summarizeContext,
  type InquiryIntent,
} from "@/lib/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 第一步：把口述询盘解析成结构化意图，并匹配产品库 + 测算到岸成本。
 *
 * 与写作线一致的原则：**解析失败不算错误**。没有 LLM key、模型返回脏 JSON、
 * 上游超时 —— 一律回退本地规则解析（`fallbackIntent`），返回 200，让演示继续。
 */
export async function POST(request: Request) {
  let draft = "";
  try {
    const body = (await request.json()) as { draft?: unknown };
    if (typeof body.draft === "string") draft = body.draft;
  } catch {
    /* fallthrough */
  }

  if (!draft.trim()) {
    return Response.json({ error: "draft 不能为空。" }, { status: 400 });
  }

  let intent: InquiryIntent;
  let source: "ai" | "fallback" = "fallback";
  let warning: string | undefined;

  try {
    const raw = await chatOnce(inquiryMessages(draft.trim()), {
      temperature: 0.2,
      maxTokens: 700,
    });
    const parsed = parseInquiry(raw);
    if (parsed) {
      intent = parsed;
      source = "ai";
    } else {
      intent = fallbackIntent(draft);
      warning = "模型返回格式无法解析，已用本地规则解析询盘。";
    }
  } catch (err) {
    intent = fallbackIntent(draft);
    warning = `未配置或无法访问 LLM（${
      err instanceof Error ? err.message.slice(0, 80) : "未知错误"
    }），已用本地规则解析询盘。`;
  }

  const ctx = buildQuoteContext(intent);
  return Response.json({ source, warning, ...summarizeContext(ctx) });
}
