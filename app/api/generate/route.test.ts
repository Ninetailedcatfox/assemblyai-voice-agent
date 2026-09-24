// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { streamChatMock } = vi.hoisted(() => ({ streamChatMock: vi.fn() }));

vi.mock("@/lib/llm", () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args),
  getProviders: () => [{ id: "custom", label: "自定义代理", model: "m" }],
  getProvider: () => ({
    id: "custom",
    label: "自定义代理",
    baseURL: "https://x/v1",
    apiKey: "k",
    model: "m",
  }),
}));

import { GET, POST } from "./route";

function makeStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/generate", () => {
  afterEach(() => vi.resetAllMocks());

  it("messages 缺失返回 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: "{}",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/messages/);
  });

  it("空 content 返回 400", async () => {
    const res = await post({ messages: [{ role: "user", content: "" }] });
    expect(res.status).toBe(400);
  });

  it("正常流式返回 200 并拼接文本", async () => {
    streamChatMock.mockResolvedValueOnce(makeStream("你好世界"));
    const res = await post({ messages: [{ role: "user", content: "草稿" }] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("你好世界");
  });

  it("streamChat 抛出时返回 500", async () => {
    streamChatMock.mockRejectedValueOnce(new Error("boom"));
    const res = await post({ messages: [{ role: "user", content: "草稿" }] });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("boom");
  });
});

describe("GET /api/generate", () => {
  it("返回可用 provider 列表", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.providers).toEqual([
      { id: "custom", label: "自定义代理", model: "m" },
    ]);
    expect(data.active).toBe("custom");
  });
});
