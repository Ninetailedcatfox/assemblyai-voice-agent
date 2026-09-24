import type { ChatMessage } from "./llm";

export const WRITING_TYPES = [
  "微信公众号文章",
  "邮件",
  "会议纪要",
  "小红书文案",
  "朋友圈",
  "日报",
];

export const TONES = ["正式", "轻松", "热情", "学术"];
export const LENGTHS = ["短（约200字）", "中（约600字）", "长（约1500字）"];
export const LANGS = ["中文", "English"];

export interface WritingIntent {
  type: string;
  tone: string;
  length: string;
  lang: string;
  needSearch: boolean;
  searchQuery: string;
  summary: string;
}

const KNOWN_TYPES = WRITING_TYPES as readonly string[];

/** 解析模型返回的意图 JSON：容忍代码块围栏、前后缀文字与字段缺失 */
export function parseIntent(text: string): WritingIntent | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (key: string, fallback = "") => {
    const v = data[key];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };
  const type = str("type");
  const intent: WritingIntent = {
    type: type || "微信公众号文章",
    tone: str("tone", "正式"),
    length: LENGTHS.includes(str("length")) ? str("length") : "中（约600字）",
    lang: LANGS.includes(str("lang")) ? str("lang") : "中文",
    needSearch: data.needSearch === true,
    searchQuery: str("searchQuery").slice(0, 40),
    summary: str("summary"),
  };
  if (!KNOWN_TYPES.includes(intent.type) && intent.type.length > 12) {
    intent.type = "微信公众号文章";
  }
  return intent;
}

export function intentMessages(draft: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是写作意图分析器。根据用户的口述草稿判断写作意图，只输出一个 JSON 对象，不要输出任何解释或代码块标记。字段如下：
- "type": 从 ["微信公众号文章","邮件","会议纪要","小红书文案","朋友圈","日报"] 中选最贴合的一项；确实都不合适时给一个不超过 6 字的自定义类型
- "tone": 从 ["正式","轻松","热情","学术"] 中选；草稿明确提到语气要求时服从草稿
- "length": 从 ["短（约200字）","中（约600字）","长（约1500字）"] 中按内容量选择
- "lang": "中文" 或 "English"（草稿为英文或要求英文输出时选 English）
- "needSearch": 布尔值。内容涉及时效信息、数据、事实、排行、政策等需要联网核实的主题时为 true，纯观点/纪要/情感表达为 false
- "searchQuery": needSearch 为 true 时给 1 条适合搜索引擎的中文查询词（不超过 20 字），否则为空字符串
- "summary": 用不超过 30 字复述这个写作任务`,
    },
    { role: "user", content: draft.slice(0, 2000) },
  ];
}
