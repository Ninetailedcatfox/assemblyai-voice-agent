import { describe, expect, it } from "vitest";
import {
  draftMessages,
  planMessages,
  polishMessages,
  quickMessages,
  type PromptOptions,
} from "./prompts";

const opts: PromptOptions = {
  type: "邮件",
  tone: "正式",
  length: "中（约600字）",
  lang: "中文",
};

describe("prompts", () => {
  it("quick 返回 [system, user] 且非空，并注入类型/语气/语言", () => {
    const [sys, user] = quickMessages("草稿", opts);
    expect(sys.role).toBe("system");
    expect(user.role).toBe("user");
    expect(sys.content.length).toBeGreaterThan(0);
    expect(user.content.length).toBeGreaterThan(0);
    expect(sys.content).toContain("邮件");
    expect(sys.content).toContain("正式");
    expect(sys.content).toContain("中文");
  });

  it("plan 返回 [system, user] 且非空", () => {
    const [sys, user] = planMessages("草稿", opts);
    expect(sys.role).toBe("system");
    expect(user.role).toBe("user");
    expect(sys.content.length).toBeGreaterThan(0);
    expect(user.content.length).toBeGreaterThan(0);
  });

  it("draft 嵌入大纲与素材到 user", () => {
    const [sys, user] = draftMessages("大纲内容", "原始素材", opts);
    expect(sys.role).toBe("system");
    expect(user.role).toBe("user");
    expect(sys.content).toContain("邮件");
    expect(user.content).toContain("大纲内容");
    expect(user.content).toContain("原始素材");
  });

  it("polish 将原文放入 user，且 system 要求基于原文", () => {
    const [sys, user] = polishMessages("成稿文本", opts);
    expect(sys.role).toBe("system");
    expect(user.role).toBe("user");
    expect(user.content).toContain("成稿文本");
    expect(sys.content).toContain("原文");
  });
});
