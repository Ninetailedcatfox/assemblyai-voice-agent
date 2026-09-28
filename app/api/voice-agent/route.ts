import { voiceAgentDefinition } from "@/lib/voiceAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 最坏情况要「建 agent + 签 token」两次上游调用，留足余量 */
export const maxDuration = 60;

/**
 * Voice Agent 会话引导：签发一次性临时 token，并给出要绑定的 agent_id。
 *
 * 为什么分两层：API Key 绝不能落前端，浏览器只拿一个单次使用的临时 token 直连
 * `wss://agents.assemblyai.com/v1/ws`。
 *
 * ⚠️ 两个参数极易混淆（官方文档专门警告过）：
 *   - `expires_in_seconds`（1–600）—— **兑换窗口**：客户端必须在这个秒数内
 *     把 WebSocket 建起来。窗口过了，第一帧会收到 `session.error` code
 *     `unauthorized` 而不是 `session.ready`。收到 ready 之后这个值就不管了。
 *   - `max_session_duration_seconds`（60–10800）—— **会话时长上限**。
 * 另外 token 是**一次性**的，每次连接（包括 `session.resume` 重连）都要重新签。
 */
const TOKEN_URL = "https://agents.assemblyai.com/v1/token";
const AGENTS_URL = "https://agents.assemblyai.com/v1/agents";

/** 兑换窗口：300s 足够用户点授权 + 建连（默认 60s 太紧） */
const EXPIRES_IN_SECONDS = 300;
/** 会话上限 20 分钟：演示够用，又不会因为忘了关而按满 3 小时计费 */
const MAX_SESSION_DURATION_SECONDS = 1200;

/**
 * 进程内缓存 agent_id。
 *
 * 优先用 `ASSEMBLYAI_AGENT_ID`（配一次就不用每次建）；没配就在首次请求时建一个
 * 并缓存在模块作用域。Serverless 冷启动会让缓存失效、偶尔多建一个 agent，
 * 这比"每次请求都新建"要好得多，也比"必须手工跑一次 publish"更不容易漏。
 */
let cachedAgentId: string | null = null;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** agents.* 的鉴权：官方明确 raw key 与 Bearer 都接受 */
function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

/** 确保有一个可用的 agent，返回它的 id */
async function ensureAgentId(apiKey: string): Promise<{ id: string } | { error: string }> {
  const fromEnv = process.env.ASSEMBLYAI_AGENT_ID?.trim();
  if (fromEnv) return { id: fromEnv };
  if (cachedAgentId) return { id: cachedAgentId };

  let res: Response;
  try {
    res = await fetch(AGENTS_URL, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(voiceAgentDefinition()),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return {
      error: `创建 Voice Agent 失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { error: `创建 Voice Agent 失败 (${res.status})：${text.slice(0, 240)}` };
  }

  let data: { id?: unknown };
  try {
    data = JSON.parse(text) as { id?: unknown };
  } catch {
    return { error: "创建 Voice Agent 返回了非 JSON 响应" };
  }
  if (typeof data.id !== "string" || !data.id) {
    return { error: "创建 Voice Agent 未返回 id" };
  }

  cachedAgentId = data.id;
  return { id: data.id };
}

export async function GET(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY ?? "";
  const checkOnly = new URL(request.url).searchParams.get("check") === "1";

  if (!apiKey) {
    return json(
      { available: false, error: "未配置 ASSEMBLYAI_API_KEY（见 .env.example）" },
      503
    );
  }

  const agent = await ensureAgentId(apiKey);
  if ("error" in agent) {
    return json({ available: true, error: agent.error }, 502);
  }

  if (checkOnly) return json({ available: true, agentId: agent.id });

  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(EXPIRES_IN_SECONDS));
  url.searchParams.set("max_session_duration_seconds", String(MAX_SESSION_DURATION_SECONDS));

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return json(
      {
        available: true,
        error: `连接 AssemblyAI 失败：${err instanceof Error ? err.message : "未知错误"}`,
      },
      502
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json(
      {
        available: true,
        error: `Voice Agent token 签发失败 (${upstream.status})`,
        detail: detail.slice(0, 300),
      },
      502
    );
  }

  const data = (await upstream.json()) as { token?: unknown };
  if (typeof data.token !== "string" || !data.token) {
    return json({ available: true, error: "AssemblyAI 未返回 token" }, 502);
  }

  return json({
    token: data.token,
    agentId: agent.id,
    expiresInSeconds: EXPIRES_IN_SECONDS,
    maxSessionDurationSeconds: MAX_SESSION_DURATION_SECONDS,
  });
}
