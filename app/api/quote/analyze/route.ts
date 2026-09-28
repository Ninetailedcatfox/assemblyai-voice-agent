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
 * 平台函数时长上限。必须显式声明：默认值随套餐/运行时变动，
 * 而本路由最坏情况是「两次 LLM 尝试各 20s」≈ 41s，加上冷启动必须留余量。
 * 超过这个上限的表现是连接被重置（前端只看到 RemoteDisconnected），不是优雅降级。
 */
export const maxDuration = 60;

/** 单次尝试的等首字节上限；两次尝试必须整体留在 maxDuration 之内 */
const PER_ATTEMPT_MS = 20000;

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
      timeoutMs: PER_ATTEMPT_MS,
      totalMs: PER_ATTEMPT_MS + 5000,
      attempts: 2,
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
