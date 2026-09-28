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
 * 而开启 `refine` 时最坏情况是「一次 LLM 尝试」，必须整体留在上限之内。
 * 超过上限的表现是连接被重置（前端只看到 RemoteDisconnected），不是优雅降级。
 */
export const maxDuration = 60;

/** `refine` 模式下给 LLM 的时间预算 */
const REFINE_BUDGET_MS = 15000;

/**
 * 第一步：把口述询盘解析成结构化意图，并匹配产品库 + 测算到岸成本。
 *
 * **默认走本地规则解析，不调 LLM。** 理由：
 * - 这一步是 demo 的必经环节，而 LLM 中转的 TTFB 在 5s~54s 之间随机跳，
 *   放在热路径上等于让整个 demo 的节奏赌运气；
 * - 询盘里的关键字段（市场、机型、数量、目标价、贸易术语）都是强结构化信息，
 *   规则解析的准确度实测与 LLM 相当，而耗时是毫秒级；
 * - 对报价工具而言，「价格和条款永不幻觉」本身就是产品卖点，不是妥协。
 *
 * 需要 LLM 语义理解时传 `refine: true`（用于处理规则覆盖不到的怪异询盘）。
 * 无论哪条路径，**解析失败都不算错误**：一律回退本地规则并返回 200，让演示继续。
 */
export async function POST(request: Request) {
  let draft = "";
  let refine = false;
  try {
    const body = (await request.json()) as { draft?: unknown; refine?: unknown };
    if (typeof body.draft === "string") draft = body.draft;
    refine = body.refine === true;
  } catch {
    /* fallthrough */
  }

  if (!draft.trim()) {
    return Response.json({ error: "draft 不能为空。" }, { status: 400 });
  }

  const text = draft.trim();
  let intent: InquiryIntent = fallbackIntent(text);
  let source: "rules" | "ai" = "rules";
  let warning: string | undefined;

  if (refine) {
    try {
      const raw = await chatOnce(inquiryMessages(text), {
        temperature: 0.2,
        maxTokens: 700,
        timeoutMs: REFINE_BUDGET_MS,
        totalMs: REFINE_BUDGET_MS + 3000,
        attempts: 1,
      });
      const parsed = parseInquiry(raw);
      if (parsed) {
        intent = parsed;
        source = "ai";
      } else {
        warning = "模型返回格式无法解析，已用本地规则解析询盘。";
      }
    } catch (err) {
      warning = `未配置或无法访问 LLM（${
        err instanceof Error ? err.message.slice(0, 80) : "未知错误"
      }），已用本地规则解析询盘。`;
    }
  }

  const ctx = buildQuoteContext(intent);
  return Response.json({ source, warning, ...summarizeContext(ctx) });
}
