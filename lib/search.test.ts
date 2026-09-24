import { describe, expect, it } from "vitest";
import { formatResearch, normalizeItems } from "./search";

describe("normalizeItems", () => {
  it("归一化 Tavily 结果", () => {
    const items = normalizeItems([
      { title: "T1", url: "https://a.com", content: "内容片段" },
      { title: "忽略无URL", url: "", content: "x" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ title: "T1", url: "https://a.com", snippet: "内容片段" });
  });

  it("归一化博查结果（name/summary 字段）", () => {
    const items = normalizeItems([
      { name: "B1", url: "https://b.com", summary: "博查摘要" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("B1");
    expect(items[0].snippet).toBe("博查摘要");
  });

  it("非数组/脏数据返回空数组", () => {
    expect(normalizeItems(null)).toEqual([]);
    expect(normalizeItems("x")).toEqual([]);
    expect(normalizeItems([42])).toEqual([]);
  });
});

describe("formatResearch", () => {
  it("输出编号资料块", () => {
    const text = formatResearch([
      { title: "标题一", url: "https://a.com", snippet: "摘要注意" },
      { title: "标题二", url: "https://b.com", snippet: "另一条" },
    ]);
    expect(text).toContain("[1] 标题一");
    expect(text).toContain("[2] 标题二");
    expect(text).toContain("https://b.com");
  });
});
