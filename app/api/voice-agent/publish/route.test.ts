// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/voice-agent/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("/api/voice-agent/publish", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ASSEMBLYAI_API_KEY = "test-key-123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ASSEMBLYAI_API_KEY;
  });

  it("没配 KEY 时 503", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    const res = await post({});
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空 body 走 POST 新建", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { id: "agent-9", name: "外贸询盘报价助手", voice: { voice_id: "alba" }, tools: [{ name: "analyze_inquiry" }, { name: "generate_quotation" }] },
        201
      )
    );
    const res = await post({});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, action: "created", agentId: "agent-9" });
    expect(data.toolNames).toEqual(["analyze_inquiry", "generate_quotation"]);
    expect(data.hint).toMatch(/ASSEMBLYAI_AGENT_ID/);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(init.method)).toBe("POST");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://agents.assemblyai.com/v1/agents");
  });

  it("带 agentId 走 PUT 更新", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "agent-9", tools: [] }, 200));
    const res = await post({ agentId: "agent-9" });
    expect((await res.json()).action).toBe("updated");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(init.method)).toBe("PUT");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://agents.assemblyai.com/v1/agents/agent-9"
    );
  });

  it("上游报错时把状态与详情透出来（音色写错会返回 400 Invalid voice）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Invalid voice 'nope'. Must be one of: alba" }, 400)
    );
    const res = await post({});
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/创建 Voice Agent 失败 \(400\)/);
    expect(data.detail).toMatch(/Invalid voice/);
  });

  it("非法 JSON body 也当作空 body 处理（不炸）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "agent-1" }, 201));
    const res = await POST(
      new Request("http://localhost/api/voice-agent/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(200);
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).method)).toBe("POST");
  });
});
