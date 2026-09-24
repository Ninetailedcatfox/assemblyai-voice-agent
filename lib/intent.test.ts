import { describe, expect, it } from "vitest";
import { intentMessages, parseIntent } from "./intent";

describe("parseIntent", () => {
  it("解析裸 JSON", () => {
    const intent = parseIntent(
      '{"type":"会议纪要","tone":"正式","length":"短（约200字）","lang":"中文","needSearch":false,"searchQuery":"","summary":"整理会议纪要"}'
    );
    expect(intent?.type).toBe("会议纪要");
    expect(intent?.needSearch).toBe(false);
    expect(intent?.summary).toBe("整理会议纪要");
  });

  it("容忍代码块围栏与前后缀文字", () => {
    const intent = parseIntent(
      '好的，分析如下：\n```json\n{"type":"小红书文案","tone":"热情","length":"短（约200字）","lang":"中文","needSearch":true,"searchQuery":"杭州良渚 周末攻略","summary":"写杭州探店笔记"}\n```\n以上。'
    );
    expect(intent?.type).toBe("小红书文案");
    expect(intent?.needSearch).toBe(true);
    expect(intent?.searchQuery).toBe("杭州良渚 周末攻略");
  });

  it("字段缺失/非法时回退默认值", () => {
    const intent = parseIntent('{"type":"周报","length":"超长","lang":"日语"}');
    expect(intent?.type).toBe("周报");
    expect(intent?.length).toBe("中（约600字）");
    expect(intent?.lang).toBe("中文");
    expect(intent?.tone).toBe("正式");
  });

  it("非 JSON 输入返回 null", () => {
    expect(parseIntent("抱歉，我无法判断")).toBeNull();
    expect(parseIntent("")).toBeNull();
  });

  it("超长自定义类型回退默认类型", () => {
    const intent = parseIntent('{"type":"一个特别特别长的不是类型的类型","tone":"正式"}');
    expect(intent?.type).toBe("微信公众号文章");
  });
});

describe("intentMessages", () => {
  it("草稿超长时截断到 2000 字", () => {
    const msgs = intentMessages("a".repeat(3000));
    expect(msgs[1].content.length).toBe(2000);
  });
});
