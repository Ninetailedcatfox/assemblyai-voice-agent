/**
 * AssemblyAI Voice Agent 的 agent 定义。
 *
 * 这一层是"语音外壳"，报价的**全部数字**仍然来自 `lib/quoteDocument.ts` 那套
 * 确定性引擎 —— 通过两个客户端工具（analyze_inquiry / generate_quotation）
 * 暴露给 agent 调用。agent 只负责听懂中文口述、决定调哪个工具、把结果用中文
 * 讲回来；它不被允许自己编造任何价格。
 *
 * 为什么工具是**客户端**执行（不配 `http`）：报价引擎已经在同一个 Next.js
 * 应用里，浏览器直接 fetch 自己的 /api/quote* 就行，不需要让 AssemblyAI
 * 的服务器绕一圈回来打公网（那还会受 8 KiB 响应体上限和公网可达性约束）。
 */

import { AGENT_SAMPLE_RATE } from "./agentAudio";

/** 官方示例统一用 alba；可用环境变量覆盖 */
export const VOICE_AGENT_VOICE_ID = process.env.VOICE_AGENT_VOICE_ID || "alba";

export { AGENT_SAMPLE_RATE };

export const VOICE_AGENT_NAME = "外贸询盘报价助手";

/**
 * 系统提示词。写成"语音优先"：短句、口语、不许念表格。
 *
 * 第 1 条最关键 —— 让模型把用户**原话**传给工具，而不是自己摘要。
 * 一旦它改写或翻译，规则解析就拿不到"1 万个""目标价 $1.1"这些原始数字了。
 */
export const VOICE_AGENT_SYSTEM_PROMPT = `你是"报价助手"，替一家中国手机配件供应商，把海外买家的询盘变成可以直接发给客户的英文报价单。用户会用中文口述询盘。

工作流程（必须遵守）：
1. 用户说完询盘后，**先调用 analyze_inquiry**，把用户的**原话逐字**作为 inquiry 参数传进去。不要改写、不要翻译、不要摘要、不要自己补数字。
2. 拿到分析结果后，**再调用 generate_quotation**，同样传原话。
3. 报价单生成后，用中文口播 2 到 3 句：先说最便宜那款的到岸成本，再说必须提醒的风险（比如目标价够不着、图案类要授权链、按体积重计费），最后说报价单已经生成、可以复制发出去。
4. 用户如果说"改成…""降到…""换成 DDP""先发几百个样品"这类修改，再调 generate_quotation，并把这些话放进 revision_instruction。
5. **绝对不许自己编造任何价格、起订量、交期、关税**。所有数字只能来自工具返回的结果。
6. 回复要短、口语化，一到两句。**不要念表格、不要念 Markdown、不要念英文报价单全文** —— 报价单在屏幕上给用户看。
7. 如果用户没说清数量或机型，先用一句话追问，再调工具。

语气：干脆、专业、像个做了十年的外贸业务员。不用"亲""哦"这类词，不用感叹号。`;

export const VOICE_AGENT_GREETING =
  "你好，我是报价助手。把买家的询盘说给我听，我来出英文报价单。";

/**
 * 关键词加权（最多 100 个）。口述转写里这些词最容易错，
 * 提前 bias 一下能明显减少返工。
 */
export const VOICE_AGENT_KEYTERMS = [
  "FOB",
  "CIF",
  "DDP",
  "EXW",
  "MOQ",
  "起订量",
  "体积重",
  "到岸成本",
  "关税",
  "授权链",
  "私标",
  "询盘",
  "报价单",
  "磁吸壳",
  "钢化膜",
  "图案壳",
  "功能机壳",
  "华强北",
  "iPhone",
  "MagSafe",
  "IMD",
  "亚马逊",
  "试单",
  "打样",
  "海运",
  "空运",
];

/** 客户端工具定义（不配 http = 由浏览器执行） */
export const AGENT_TOOLS = [
  {
    name: "analyze_inquiry",
    description:
      "分析买家的询盘：解析出市场、买家类型、机型、数量、目标价、贸易术语，" +
      "匹配产品库并测算到岸成本（含体积重运费与关税），列出必须提醒的风险点。" +
      "只要用户描述了买家要什么，就调用它。inquiry 必须传用户的原话。",
    parameters: {
      type: "object",
      properties: {
        inquiry: {
          type: "string",
          description: "用户口述的中文询盘原文，逐字传入，不要改写或翻译。",
          examples: [
            "美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1，希望两周内能到美仓",
          ],
        },
      },
      required: ["inquiry"],
    },
    // 报价测算很快，但用户说完话需要即时反馈，用 interactive
    execution_mode: "interactive",
    timeout_seconds: 30,
  },
  {
    name: "generate_quotation",
    description:
      "生成一份可直接发给客户的英文报价单（Markdown，含明细表、MOQ、交期、" +
      "体积重说明、关税提示、IP 条款、下一步）。首轮生成传 inquiry 即可；" +
      "用户要改价/改条款时，把原询盘放进 inquiry，把修改要求放进 revision_instruction。",
    parameters: {
      type: "object",
      properties: {
        inquiry: {
          type: "string",
          description: "用户口述的中文询盘原文，逐字传入。",
        },
        revision_instruction: {
          type: "string",
          description:
            "仅在用户要求修改时填写。例如「目标价改成 $0.95，改成 DDP」「先发 500 个样品单试单」。",
          examples: ["目标价改成 $0.95，改成 DDP", "先发 500 个样品单试单"],
        },
      },
      required: ["inquiry"],
    },
    execution_mode: "interactive",
    timeout_seconds: 30,
  },
] as const;

/** 交给 POST /v1/agents 的完整 body */
export function voiceAgentDefinition() {
  return {
    name: VOICE_AGENT_NAME,
    system_prompt: VOICE_AGENT_SYSTEM_PROMPT,
    greeting: VOICE_AGENT_GREETING,
    voice: { voice_id: VOICE_AGENT_VOICE_ID },
    input: {
      type: "audio",
      format: { encoding: "audio/pcm", sample_rate: AGENT_SAMPLE_RATE },
      keyterms: VOICE_AGENT_KEYTERMS,
    },
    output: {
      type: "audio",
      voice: VOICE_AGENT_VOICE_ID,
      format: { encoding: "audio/pcm", sample_rate: AGENT_SAMPLE_RATE },
    },
    tools: AGENT_TOOLS,
    // 刻意不配 llm：用 AssemblyAI 的托管模型。
    // 配自己的中转会让整条语音链路重新依赖那个 TTFB 5~54s 乱跳的第三方。
  };
}

export type AgentToolName = (typeof AGENT_TOOLS)[number]["name"];
