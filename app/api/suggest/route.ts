import { chatOnce } from "@/lib/llm";
import { parseSuggestions, suggestMessages } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { text?: string; type?: string; tone?: string; lang?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "text 不能为空。" }, { status: 400 });
  }

  try {
    const raw = await chatOnce(
      suggestMessages(text, {
        type: body.type ?? "文章",
        tone: body.tone ?? "正式",
        length: "中（约600字）",
        lang: body.lang ?? "中文",
      })
    );
    return Response.json({ suggestions: parseSuggestions(raw) });
  } catch (err) {
    return Response.json({
      suggestions: { titles: [], tags: [], tips: [] },
      error: err instanceof Error ? err.message : "建议生成失败",
    });
  }
}
