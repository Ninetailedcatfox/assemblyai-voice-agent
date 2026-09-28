// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * 这组测试锁的是"两种鉴权写法都要试"这条行为。
 *
 * 起因：用假 key 探测时，`Authorization: <KEY>` 与 `Authorization: Bearer <KEY>`
 * 返回的是完全一样的 `404 {"detail":"Invalid API key"}`，无法从错误响应判断
 * AAI 到底要哪种写法。与其上线时赌一把，不如两种都试。
 */

const fetchMock = vi.fn();

function call(query = "") {
  return GET(new Request(`http://localhost/api/aai-token${query}`));
}

function authOf(callIndex: number): string {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return String((init?.headers as Record<string, string>)?.Authorization ?? "");
}

describe("/api/aai-token", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.ASSEMBLYAI_API_KEY = "test-key-123";
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    delete process.env.ASSEMBLYAI_API_KEY;
  });

  it("没配 KEY 时返回 503 且说明 available:false", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("?check=1 只探测可用性，不签发 token、不打上游", async () => {
    const res = await call("?check=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("先用不带 Bearer 的写法（官方文档写法）", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "t1" }), { status: 200 })
    );
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: "t1", authForm: "raw" });
    expect(authOf(0)).toBe("test-key-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("不带 Bearer 失败时自动改用 Bearer 重试", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Invalid API key" }), { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "t2" }), { status: 200 })
      );

    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: "t2", authForm: "bearer" });
    expect(authOf(0)).toBe("test-key-123");
    expect(authOf(1)).toBe("Bearer test-key-123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("两种写法都失败时返回 502 并带上上游状态与详情", async () => {
    // 每次都要给新的 Response：body 只能读一次，复用同一个对象会让第二次
    // text() 抛错（真实 fetch 每次都返回新对象，所以这是测试侧的坑）
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ detail: "Invalid API key" }), { status: 404 })
    );
    const res = await call();
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/签发失败 \(404\)/);
    expect(data.detail).toMatch(/Invalid API key/);
    // 仍然是 available:true —— KEY 配了，只是这次签发失败，前端据此决定是否降级
    expect(data.available).toBe(true);
  });

  it("上游返回 200 但没有 token 字段时，继续试下一种写法", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "t3" }), { status: 200 })
      );
    const res = await call();
    expect(await res.json()).toMatchObject({ token: "t3", authForm: "bearer" });
  });

  it("网络异常返回 502 而不是抛错", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/连接 AssemblyAI 失败/);
  });

  it("token 请求带上兑换窗口参数（默认 60 太紧，用户授权手慢就会失效）", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "t" }), { status: 200 })
    );
    const res = await call();
    expect(await res.json()).toMatchObject({ expiresInSeconds: 300 });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("expires_in_seconds=300");
    expect(url).toContain("streaming.assemblyai.com/v3/token");
  });
});
