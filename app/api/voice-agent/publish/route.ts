import { voiceAgentDefinition } from "@/lib/voiceAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 显式发布 / 更新 Voice Agent。
 *
 * 为什么要有这个路由：`/api/voice-agent` 在缺 `ASSEMBLYAI_AGENT_ID` 时会临时建一个
 * 并缓存在进程内，但 Serverless 冷启动会让缓存失效、偶尔多建 agent。这个路由
 * 用来"建一次、把 id 写进环境变量"，之后就完全确定。
 *
 * - `POST {}`            → 新建 agent，返回 id
 * - `POST {agentId}`     → 更新已有 agent（改提示词/音色/工具后重新发布）
 */
const AGENTS_URL = "https://agents.assemblyai.com/v1/agents";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY ?? "";
  if (!apiKey) {
    return json({ error: "未配置 ASSEMBLYAI_API_KEY（见 .env.example）" }, 503);
  }

  let agentId = "";
  try {
    const body = (await request.json()) as { agentId?: unknown };
    if (typeof body.agentId === "string") agentId = body.agentId.trim();
  } catch {
    /* 允许空 body */
  }

  const isUpdate = agentId.length > 0;
  const url = isUpdate ? `${AGENTS_URL}/${encodeURIComponent(agentId)}` : AGENTS_URL;

  let res: Response;
  try {
    res = await fetch(url, {
      method: isUpdate ? "PUT" : "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(voiceAgentDefinition()),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return json(
      { error: `连接 AssemblyAI 失败：${err instanceof Error ? err.message : "网络错误"}` },
      502
    );
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return json(
      {
        error: `${isUpdate ? "更新" : "创建"} Voice Agent 失败 (${res.status})`,
        detail: text.slice(0, 400),
      },
      502
    );
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "AssemblyAI 返回了非 JSON 响应", detail: text.slice(0, 300) }, 502);
  }

  return json({
    ok: true,
    action: isUpdate ? "updated" : "created",
    agentId: data.id ?? null,
    name: data.name ?? null,
    voice: data.voice ?? null,
    toolNames: Array.isArray(data.tools)
      ? (data.tools as { name?: string }[]).map((t) => t.name ?? "?")
      : [],
    hint: "把这个 id 写进 ASSEMBLYAI_AGENT_ID 环境变量，就不用每次冷启动重建了。",
  });
}
