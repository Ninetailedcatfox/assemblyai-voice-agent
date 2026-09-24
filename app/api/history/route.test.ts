// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { store, fsMock } = vi.hoisted(() => {
  const store: Record<string, string> = {};
  const fsMock = {
    readFile: vi.fn(async (p: string) => {
      if (store[p] === undefined) throw new Error("ENOENT");
      return store[p];
    }),
    writeFile: vi.fn(async (p: string, data: string) => {
      store[p] = data;
    }),
    mkdir: vi.fn(async () => undefined),
  };
  return { store, fsMock };
});

vi.mock("node:fs/promises", () => fsMock as unknown as typeof import("node:fs/promises"));

import { GET, POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("/api/history", () => {
  afterEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.clearAllMocks();
  });

  it("GET 文件缺失时返回空列表", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toEqual([]);
  });

  it("POST 保存一条并可在 GET 中读回", async () => {
    const item = {
      id: "x",
      title: "t",
      content: "hello",
      createdAt: "2024-01-01T00:00:00Z",
    };
    const res = await post(item);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items[0]).toMatchObject({ id: "x", content: "hello" });

    const got = await GET();
    expect((await got.json()).items.length).toBe(1);
  });

  it("POST 缺少 content 返回 400", async () => {
    const res = await post({ id: "x", title: "t", content: "   " });
    expect(res.status).toBe(400);
  });

  it("POST 非法 JSON 返回 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });
});
