import type { ChatMessage } from "./llm";

export interface PromptOptions {
  type: string;
  tone: string;
  length: string;
  lang: string;
}

const sys = (content: string): ChatMessage => ({
  role: "system",
  content,
});

const usr = (content: string): ChatMessage => ({
  role: "user",
  content,
});

/** 快速模式：一次性成稿 */
export function quickMessages(
  draft: string,
  o: PromptOptions
): ChatMessage[] {
  const system = `你是一名${o.type}写作助手。请根据用户的口述草稿或要点，以${o.tone}的语气、${o.length}篇幅，用${o.lang}完成一篇可直接使用的${o.type}。

要求：
- 保留用户原意，补充必要细节使其通顺完整
- 只输出正文，不要任何解释、标题或开场白
- 开头直接进入内容`;
  return [sys(system), usr(draft)];
}

/** 阶段一：规划，输出大纲要点；有检索资料时要求结合资料 */
export function planMessages(
  draft: string,
  o: PromptOptions,
  research?: string
): ChatMessage[] {
  const system = `你是一名${o.type}写作规划师。请基于用户的口述草稿/要点，先规划本文结构，用 3-6 个中文要点列出大纲（每条一行，以“- ”开头）。只输出大纲，不要展开正文。语言：${o.lang}。`;
  const user = research
    ? `${draft}\n\n【参考资料】\n${research}\n（规划时可参考以上资料；与主题无关的内容忽略）`
    : draft;
  return [sys(system), usr(user)];
}

/** 阶段二：成稿，基于大纲+草稿写出完整正文；引用检索资料时标注编号 */
export function draftMessages(
  plan: string,
  draft: string,
  o: PromptOptions,
  research?: string
): ChatMessage[] {
  const system = `你是一名${o.type}写作助手。请基于下面的[大纲]和[原始素材]，以${o.tone}的语气、${o.length}篇幅，用${o.lang}写出完整正文。

要求：
- 严格遵循大纲结构展开
- 吸收原始素材中的要点，必要时补充使内容丰满
- 如提供[参考资料]，适度吸收其中有用的信息，引用处用 [1][2] 编号标注，并在文末以“参考来源”小节列出编号对应的来源标题
- 只输出正文，不要任何解释或开场白`;
  const user = `【大纲】\n${plan}\n\n【原始素材】\n${draft}${
    research ? `\n\n【参考资料】\n${research}` : ""
  }`;
  return [sys(system), usr(user)];
}

/** 阶段三：润色，对已有成稿做精修 */
export function polishMessages(
  draftText: string,
  o: PromptOptions
): ChatMessage[] {
  const system = `你是一名资深中文文字编辑。请基于[原文]逐句润色精修，要求：

- 必须基于用户提供的原文进行润色，保持原意、事实与主题，不得另起新主题或自行创作新内容
- 修正语病、重复与不通顺处，增强节奏感与可读性
- 保持${o.tone}语气、${o.lang}，篇幅与原文相当
- 直接输出润色后的完整全文，不要任何解释、标题或前缀`;
  return [sys(system), usr(draftText)];
}

/** 选中改写：只输出改写后的片段，保持与前后文衔接 */
export function rewriteMessages(
  selection: string,
  instruction: string,
  before: string,
  after: string,
  o: PromptOptions
): ChatMessage[] {
  const system = `你是一名资深${o.type}文字编辑。请按要求改写[选中片段]，要求：
- ${instruction}
- 与[上文][下文]自然衔接，不重复上下文内容
- 保持全文语言（${o.lang}）一致
- 只输出改写后的片段本身，不要任何解释、引号或前后缀`;
  const user = `【上文】\n${before}\n\n【选中片段】\n${selection}\n\n【下文】\n${after}`;
  return [sys(system), usr(user)];
}

export interface Suggestions {
  titles: string[];
  tags: string[];
  tips: string[];
}

/** 成稿后的智能建议：候选标题、标签、改进点 */
export function suggestMessages(text: string, o: PromptOptions): ChatMessage[] {
  const system = `你是一名${o.type}内容策划。请针对[成稿]输出改进建议，只输出一个 JSON 对象（无其他文字、无代码块标记）：
- "titles": 3 个候选标题（字符串数组，吸引人但不标题党，${o.lang}）
- "tags": 3-6 个发布标签/话题（字符串数组，# 开头）
- "tips": 2-3 条具体改进建议（字符串数组，每条不超过 30 字，指出可补强之处）`;
  return [sys(system), usr(text.slice(0, 3000))];
}

/** 解析建议 JSON：容忍围栏与脏字符，字段缺失给空数组 */
export function parseSuggestions(text: string): Suggestions {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { titles: [], tags: [], tips: [] };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { titles: [], tags: [], tips: [] };
  }
  const list = (key: string, max: number) => {
    const v = data[key];
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
      : [];
  };
  return {
    titles: list("titles", 3),
    tags: list("tags", 6),
    tips: list("tips", 3),
  };
}
