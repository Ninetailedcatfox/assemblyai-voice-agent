// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 锁的是这几条容易写错的行为：
 * - 缺 ASSEMBLYAI_AGENT_ID 时要先建 agent 再签 token（两次上游调用）
 * - 两个极易混淆的参数都要带上（expires_in_seconds 是兑换窗口，
 *   max_session_duration_seconds 是会话时长上限，漏掉后者默认按 3 小时计费）
 * - agent_id 要缓存，不能每次请求都新建
 * - ?check=1 只探测，不签 token
 */

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let GET: typeof import("./route").GET;

async function load() {
  ({ GET } = await import("./route"));
}

function call(query = "") {
  return GET(new Request(`http://localhost/api/voice-agent${query}`));
}

/** 上游调用的 URL 列表（按顺序） */
function urls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

describe("/api/voice-agent", () => {
  beforeEach(async () => {
    vi.resetModules(); // 清掉模块作用域的 agent_id 缓存
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ASSEMBLYAI_API_KEY = "test-key-123";
    delete process.env.ASSEMBLYAI_AGENT_ID;
    await load();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_AGENT_ID;
  });

  it("没配 KEY 时 503，且不打上游", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("先建 agent 再签 token，并把两个参数都带上", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1", name: "x" }, 201))
      .mockResolvedValueOnce(jsonResponse({ token: "tok-1" }));

    const res = await call();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      token: "tok-1",
      agentId: "agent-1",
      expiresInSeconds: 300,
      maxSessionDurationSeconds: 1200,
    });

    const [agentUrl, tokenUrl] = urls();
    expect(agentUrl).toBe("https://agents.assemblyai.com/v1/agents");
    expect(tokenUrl).toContain("agents.assemblyai.com/v1/token");
    expect(tokenUrl).toContain("expires_in_seconds=300");
    expect(tokenUrl).toContain("max_session_duration_seconds=1200");
  });

  it("创建 agent 时提交的是完整定义（含工具与音色）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ token: "t" }));

    await call();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(init.method)).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key-123");

    const body = JSON.parse(String(init.body));
    expect(body.name).toBeTruthy();
    expect(body.system_prompt).toContain("analyze_inquiry");
    expect(body.voice.voice_id).toBe("alba");
    expect(body.input.format).toMatchObject({ encoding: "audio/pcm", sample_rate: 24000 });
    expect(body.output.format).toMatchObject({ encoding: "audio/pcm", sample_rate: 24000 });
    // 工具必须是客户端执行（不配 http），否则 AAI 会去公网打我们自己的接口
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      "analyze_inquiry",
      "generate_quotation",
    ]);
    for (const t of body.tools) expect(t.http).toBeUndefined();
    // 刻意不配 llm：用托管模型，避免整条语音链路依赖自己的中转
    expect(body.llm).toBeUndefined();
  });

  it("agent_id 会被缓存，第二次请求不再新建", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ token: "t1" }))
      .mockResolvedValueOnce(jsonResponse({ token: "t2" }));

    await call();
    await call();

    // 只有一次 POST /v1/agents
    const agentCreates = urls().filter(
      (u) => u === "https://agents.assemblyai.com/v1/agents"
    );
    expect(agentCreates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("配了 ASSEMBLYAI_AGENT_ID 就完全跳过创建", async () => {
    process.env.ASSEMBLYAI_AGENT_ID = "env-agent-9";
    await load(); // 重新加载以读到新的 env
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: "t" }));

    const res = await call();
    expect((await res.json()).agentId).toBe("env-agent-9");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urls()[0]).toContain("/v1/token");
  });

  it("?check=1 只探测，不签 token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "agent-1" }, 201));
    const res = await call("?check=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, agentId: "agent-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("建 agent 失败返回 502 并带上上游详情", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Invalid voice 'xyz'. Must be one of: alba" }, 400)
    );
    const res = await call();
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.available).toBe(true);
    expect(data.error).toMatch(/创建 Voice Agent 失败 \(400\)/);
    expect(data.error).toMatch(/Invalid voice/);
  });

  it("签 token 失败返回 502", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ detail: "Unauthorized" }, 401));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/token 签发失败 \(401\)/);
  });

  it("上游返回 200 但没 token 字段时 502", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({}));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/未返回 token/);
  });

  it("网络异常返回 502 而不是抛错", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/创建 Voice Agent 失败/);
  });
});
