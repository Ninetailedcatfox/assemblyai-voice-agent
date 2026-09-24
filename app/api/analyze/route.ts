import { chatOnce } from "@/lib/llm";
import { intentMessages, parseIntent } from "@/lib/intent";
import {
  formatResearch,
  getSearchProviderId,
  searchWeb,
  type SearchResult,
} from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 前端探针：检索功能是否可用 */
export async function GET() {
  return Response.json({ enabled: getSearchProviderId() !== null });
}

/**
 * 意图识别 + 联网检索。
 * 智能识别是增强项：任何失败都以 200 + null intent 返回，前端静默回退手动参数。
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

  try {
    const raw = await chatOnce(intentMessages(draft.trim()));
    const intent = parseIntent(raw);
    let research: SearchResult[] = [];
    if (intent?.needSearch && intent.searchQuery && getSearchProviderId()) {
      research = await searchWeb(intent.searchQuery, 5);
    }
    return Response.json({
      intent,
      research,
      researchText: research.length ? formatResearch(research) : "",
    });
  } catch (err) {
    return Response.json({
      intent: null,
      research: [],
      researchText: "",
      error: err instanceof Error ? err.message : "意图识别失败",
    });
  }
}
