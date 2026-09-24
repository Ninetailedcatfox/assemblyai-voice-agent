import { chatOnce, getProvider } from "@/lib/llm";
import { fallbackSceneFromPrompt, parseSceneText, sceneMessages } from "@/lib/scene";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { prompt?: unknown; provider?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "prompt 不能为空。" }, { status: 400 });

  try {
    getProvider(body.provider);
    const raw = await chatOnce(sceneMessages(prompt), {
      provider: body.provider,
      temperature: 0.35,
      maxTokens: 1200,
    });
    const scene = parseSceneText(raw, prompt);
    return Response.json({
      scene,
      source: scene.source,
      warning: scene.source === "fallback" ? "AI 已响应，但返回格式无法解析，已切换到本地可复现场景。" : undefined,
    });
  } catch {
    return Response.json({
      scene: fallbackSceneFromPrompt(prompt),
      source: "fallback",
      warning: "当前 Demo 未配置 LLM Key，已切换到本地可复现规划；场景仍可交互和导出。",
    });
  }
}
