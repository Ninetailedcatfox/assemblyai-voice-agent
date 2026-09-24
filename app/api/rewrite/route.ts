import { streamChat } from "@/lib/llm";
import { rewriteMessages } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESETS: Record<string, string> = {
  rewrite: "重写这段话，表达更准确、流畅",
  expand: "扩写这段话，补充必要细节使其更丰满（长度约为原来的 2 倍）",
  shorten: "缩短这段话，只保留核心信息（约为原来的一半长度）",
  casual: "换一种轻松自然的语气重写这段话，但保持信息不变",
};

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: {
    selection?: string;
    action?: string;
    instruction?: string;
    before?: string;
    after?: string;
    type?: string;
    tone?: string;
    lang?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求体必须是 JSON。");
  }

  const selection = typeof body.selection === "string" ? body.selection.trim() : "";
  if (!selection) return badRequest("selection 不能为空。");

  const preset = body.action ? PRESETS[body.action] : undefined;
  const custom =
    typeof body.instruction === "string" ? body.instruction.trim() : "";
  const instruction = preset || custom || PRESETS.rewrite;

  try {
    const stream = await streamChat(
      rewriteMessages(
        selection,
        instruction,
        (body.before ?? "").slice(-200),
        (body.after ?? "").slice(0, 200),
        {
          type: body.type ?? "文章",
          tone: body.tone ?? "正式",
          length: "中（约600字）",
          lang: body.lang ?? "中文",
        }
      )
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "改写失败，请重试。" },
      { status: 500 }
    );
  }
}
