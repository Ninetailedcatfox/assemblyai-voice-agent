import { describe, expect, it } from "vitest";
import {
  parseSuggestions,
  rewriteMessages,
  suggestMessages,
} from "./prompts";

const OPTS = { type: "微信公众号文章", tone: "轻松", length: "中（约600字）", lang: "中文" };

describe("rewriteMessages", () => {
  it("携带选中片段与上下文", () => {
    const msgs = rewriteMessages("这句要改", "扩写这段话", "上文内容", "下文内容", OPTS);
    expect(msgs[1].content).toContain("【选中片段】");
    expect(msgs[1].content).toContain("这句要改");
    expect(msgs[1].content).toContain("上文内容");
    expect(msgs[0].content).toContain("扩写这段话");
  });
});

describe("parseSuggestions", () => {
  it("解析带围栏的建议 JSON", () => {
    const s = parseSuggestions(
      '```json\n{"titles":["早睡一周，我变了","别再熬了","十一点后的世界"],"tags":["#早睡","#自律","#健康"],"tips":["第一段可以加个数据","结尾加行动号召"]}\n```'
    );
    expect(s.titles).toHaveLength(3);
    expect(s.tags).toContain("#早睡");
    expect(s.tips).toHaveLength(2);
  });

  it("脏输出回退空数组", () => {
    expect(parseSuggestions("没有建议")).toEqual({ titles: [], tags: [], tips: [] });
    expect(parseSuggestions('{"titles":"不是数组"}')).toEqual({
      titles: [],
      tags: [],
      tips: [],
    });
  });
});

describe("suggestMessages", () => {
  it("限制成稿长度避免超 token", () => {
    const msgs = suggestMessages("x".repeat(5000), OPTS);
    expect(msgs[1].content.length).toBe(3000);
  });
});
