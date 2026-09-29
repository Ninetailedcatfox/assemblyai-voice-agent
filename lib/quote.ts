/**
 * 外贸询盘 → 英文报价单 的引擎层。
 *
 * 流程：口述询盘（中文）→ 解析结构化意图 → 匹配产品库 → 测算到岸成本 → 生成英文报价单。
 *
 * 设计原则：
 * - **价格只来自 `lib/products.ts`**，prompt 里明确禁止模型自己编价
 * - 无 LLM key 时用本地规则解析意图（`fallbackIntent`），保证 Demo 不开天窗
 * - 报价必须体现本品类的三个坑：体积重计费、美国关税、IP 授权链
 */

import type { ChatMessage } from "./llm";
import { marketNameEn } from "./marketNames";
import {
  CATALOG,
  DEFAULT_ASSUMPTIONS,
  estimateLandedCost,
  formatCatalog,
  searchSkus,
  type CostEstimate,
  type QuoteAssumptions,
  type Sku,
} from "./products";

export interface InquiryIntent {
  /** 买家市场，如 "美国" / "阿联酋" */
  buyerMarket: string;
  /** 买家类型，如 "亚马逊私标卖家" */
  buyerType: string;
  /** 采购品类（中文） */
  category: string;
  /** 机型；通用件为 ["universal"] */
  models: string[];
  /** 采购数量（个） */
  quantity: number;
  /** 买家目标单价（美元/个）；未提及时 null */
  targetPriceUsd: number | null;
  /** 交期要求（原文要点） */
  timeline: string;
  /** 贸易术语 */
  incoterm: "FOB" | "CIF" | "DDP" | "EXW";
  /** 买家是否要求 IP 授权链文件 */
  needIpClearance: boolean;
  /** 一句话复述 */
  summary: string;
}

export interface QuoteLine {
  sku: Sku;
  qty: number;
  cost: CostEstimate;
}

export interface QuoteContext {
  intent: InquiryIntent;
  lines: QuoteLine[];
  /** 供 prompt 注入的产品库资料块 */
  catalogText: string;
  assumptions: QuoteAssumptions;
  /** 目标价与到岸成本的差距（美元/个）；无目标价时为 null */
  targetGapUsd: number | null;
  /** 本地规则给出的提醒（不依赖 LLM） */
  flags: string[];
}

const INCOTERMS = ["FOB", "CIF", "DDP", "EXW"] as const;

// ── 意图解析 ────────────────────────────────────────────────────────────────

export function inquiryMessages(draft: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是外贸询盘解析器。用户用中文口述了一个海外买家的询盘，请提取结构化信息，只输出一个 JSON 对象，不要任何解释或代码块标记。字段如下：
- "buyerMarket": 买家所在市场（国家/地区），如 "美国"、"阿联酋"、"尼日利亚"；不确定时给最可能的
- "buyerType": 买家类型，如 "亚马逊私标卖家"、"配件批发商"、"DTC 品牌"、"本土电商卖家"
- "category": 采购品类（中文），如 "磁吸壳"、"IMD 图案壳"、"钢化膜"、"磁吸充电宝"
- "models": 机型数组，如 ["iPhone 16 Pro Max"]；通用件给 ["universal"]
- "quantity": 采购数量（整数，单位个）；没提到给 1000
- "targetPriceUsd": 买家目标单价（美元/个，数字）；没提到给 null
- "timeline": 交期要求（简要，如 "两周内到美仓"）；没提到给 ""
- "incoterm": 从 ["FOB","CIF","DDP","EXW"] 中选，默认 "FOB"
- "needIpClearance": 布尔值，买家是否要求图案授权 / 授权链文件
- "summary": 用不超过 40 字复述这个询盘`,
    },
    { role: "user", content: draft.slice(0, 2000) },
  ];
}

/** 解析模型返回的意图 JSON：容忍代码块围栏与字段缺失 */
export function parseInquiry(text: string): InquiryIntent | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  // 模型偶尔会回一个空对象 `{}`：那不算解析成功，应交给本地规则兜底
  const KNOWN_FIELDS = [
    "buyerMarket",
    "buyerType",
    "category",
    "models",
    "quantity",
    "targetPriceUsd",
    "timeline",
    "incoterm",
    "needIpClearance",
    "summary",
  ];
  if (!Object.keys(data).some((k) => KNOWN_FIELDS.includes(k))) return null;

  const str = (key: string, fallback = "") => {
    const v = data[key];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };

  const models = Array.isArray(data.models)
    ? data.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];

  const qtyRaw = data.quantity;
  const quantity =
    typeof qtyRaw === "number" && Number.isFinite(qtyRaw) && qtyRaw > 0
      ? Math.round(qtyRaw)
      : 1000;

  const priceRaw = data.targetPriceUsd;
  const targetPriceUsd =
    typeof priceRaw === "number" && Number.isFinite(priceRaw) && priceRaw > 0
      ? priceRaw
      : null;

  const incotermRaw = str("incoterm").toUpperCase();

  return {
    buyerMarket: str("buyerMarket", "未指明"),
    buyerType: str("buyerType", "买家"),
    category: str("category", "手机配件"),
    models: models.length ? models : ["universal"],
    quantity,
    targetPriceUsd,
    timeline: str("timeline"),
    incoterm: (INCOTERMS as readonly string[]).includes(incotermRaw)
      ? (incotermRaw as InquiryIntent["incoterm"])
      : "FOB",
    needIpClearance: data.needIpClearance === true,
    summary: str("summary"),
  };
}

const MARKET_HINTS: { re: RegExp; market: string; buyerType: string }[] = [
  { re: /美国|美区|亚马逊|amazon|fba|tiktok/i, market: "美国", buyerType: "亚马逊 / TikTok Shop 私标卖家" },
  { re: /迪拜|阿联酋|uae|dubai|deira/i, market: "阿联酋", buyerType: "配件批发商（迪拜 Deira 集散）" },
  { re: /沙特|利雅得|吉达|saudi/i, market: "沙特", buyerType: "配件进口商" },
  { re: /尼日利亚|肯尼亚|拉各斯|内罗毕|非洲|africa/i, market: "非洲", buyerType: "功能机 / 智能机配件进口商" },
  { re: /墨西哥|秘鲁|智利|哥伦比亚|拉美|巴西|latin/i, market: "拉美", buyerType: "配件进口商" },
  { re: /越南|印尼|印度尼西亚|shopee|lazada|东南亚/i, market: "东南亚", buyerType: "本土电商卖家供应链" },
  { re: /英国|德国|法国|欧洲|europe|uk|germany/i, market: "欧洲", buyerType: "DTC / 私标卖家" },
];

/** 从原文里挑出含交期线索的那一段（按标点切句，避免把整句都塞进交期字段） */
function extractTimeline(text: string): string {
  const seg = text.split(/[，。；;,、]/).find((s) => /周|天|尽快|urgent|asap/i.test(s));
  return seg?.trim() ?? "";
}

/** 中文数字用到的字符（含"两"这种口语写法） */
const CN_NUM_CHARS = "零一二两三四五六七八九十百千万亿";

/**
 * 解析中文数字："五千"→5000、"一万"→10000、"两万"→20000、"一点一"→1.1、"零点九五"→0.95。
 *
 * 为什么必须支持：这条链路是**中文口述**驱动的，AssemblyAI 转写出来的就是
 * "五千个""一点一美元"这种中文数字。旧实现只认阿拉伯数字，于是
 * "五千个"直接落到默认值 1000 —— 实测线上报价单写成 `1,000 pcs`，
 * 而客户口述的是 5,000 个；"一点一美元"也让 targetPriceUsd 变成 null，
 * 连带"目标价够不着"这条最关键的提醒都不出现。数字错，报价单就是废纸。
 */
export function parseCnNumber(input: string): number {
  const D: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const U: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  const s = input.trim();
  if (!s) return NaN;

  const [intPart, decPart] = s.split("点");
  let total = 0; // "万/亿"以上已结算的部分
  let section = 0; // 当前小节（万以下）
  let num = 0; // 待结算的个位数字
  let lastUnit = 0; // 最后一个单位，用于处理"一千五 = 1500"这类省略写法
  let trailingDigit: number | null = null; // 末尾未带单位的数字

  for (const ch of intPart) {
    if (ch in D) {
      num = D[ch];
      trailingDigit = num;
    } else if (ch in U) {
      section += (num === 0 ? 1 : num) * U[ch]; // "十五"的十前面省略了"一"
      num = 0;
      trailingDigit = null;
      lastUnit = U[ch];
    } else if (ch === "万") {
      total += (section + num) * 10000;
      section = 0;
      num = 0;
      trailingDigit = null;
      lastUnit = 10000;
    } else if (ch === "亿") {
      total = (total + section + num) * 100000000;
      section = 0;
      num = 0;
      trailingDigit = null;
      lastUnit = 100000000;
    } else {
      return NaN; // 混进了非数字字符，宁可放弃也不要猜
    }
  }

  let value = total + section + num;
  // "一千五"(1500)、"一万五"(15000)、"两千三"(2300)：末尾数字省略了单位，
  // 按最后一个单位的十分之一补。
  if (trailingDigit !== null && lastUnit >= 100) {
    value = total + section + trailingDigit * (lastUnit / 10);
  }

  if (decPart !== undefined) {
    const digits = [...decPart].map((c) => (c in D ? D[c] : NaN));
    if (digits.length === 0 || digits.some((d) => Number.isNaN(d))) return NaN;
    value += parseFloat(`0.${digits.join("")}`);
  }
  return value;
}

/**
 * 这个中文数字串像不像"采购数量"？
 *
 * 必须过滤：口述里 "美国一个亚马逊私标卖家" 的 "一个" 会先被正则命中，
 * 若直接采信就把数量变成 1。规则是"长度≥2 或含单位"，所以 "一" 被挡掉、
 * "五千"/"一万"/"十五" 通过。
 */
function looksLikeQuantity(cn: string): boolean {
  return cn.length >= 2 || /[十百千万亿]/.test(cn);
}

/**
 * 本地规则解析（无 LLM key 时的兜底）。
 * 只求"能跑通演示"，不追求语义理解 —— 有 LLM 时优先用模型结果。
 */
export function fallbackIntent(draft: string): InquiryIntent {
  const text = draft.trim();

  const market = MARKET_HINTS.find((h) => h.re.test(text));

  // 数量：阿拉伯数字与中文数字都要认 —— 语音转写出来的是"五千个"这种中文数字。
  //
  // 不能只取第一个匹配："美国一个亚马逊私标卖家，要五千个…" 里第一个被命中的是
  // "一个"。所以把所有候选收齐、过滤掉不合理的（`looksLikeQuantity`），取最大的那个。
  let quantity = 1000;
  const qtyCandidates: number[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*万\s*(?:个|件|pcs)?/gi)) {
    qtyCandidates.push(Math.round(parseFloat(m[1]) * 10000));
  }
  for (const m of text.matchAll(/(\d[\d,]{1,})\s*(?:个|件|pcs|pieces)/gi)) {
    qtyCandidates.push(parseInt(m[1].replace(/,/g, ""), 10));
  }
  for (const m of text.matchAll(
    new RegExp(`([${CN_NUM_CHARS}]{1,8})\\s*(?:个|件|pcs|pieces)`, "gi")
  )) {
    if (!looksLikeQuantity(m[1])) continue;
    const v = parseCnNumber(m[1]);
    if (Number.isFinite(v) && v > 0) qtyCandidates.push(v);
  }
  const usableQty = qtyCandidates.filter((v) => Number.isFinite(v) && v > 0);
  if (usableQty.length) quantity = Math.max(...usableQty);

  // 目标价：$1.2 / 1.2美元 / 1.2 USD / 一点一美元 / 零点九五美元
  let targetPriceUsd: number | null = null;
  const priceAr =
    text.match(/\$\s*(\d+(?:\.\d+)?)/) ?? text.match(/(\d+(?:\.\d+)?)\s*(?:美元|美金|usd)/i);
  const priceCn = text.match(
    new RegExp(`([${CN_NUM_CHARS}]{1,8}(?:点[${CN_NUM_CHARS}]{1,4})?)\\s*(?:美元|美金)`, "i")
  );
  if (priceAr) {
    const p = parseFloat(priceAr[1]);
    if (Number.isFinite(p) && p > 0) targetPriceUsd = p;
  } else if (priceCn) {
    const p = parseCnNumber(priceCn[1]);
    if (Number.isFinite(p) && p > 0) targetPriceUsd = p;
  }

  // 机型：直接用产品库里的机型名去命中
  const lower = text.toLowerCase();
  const models = Array.from(
    new Set(
      CATALOG.flatMap((s) => s.models).filter(
        (m) => m !== "universal" && lower.includes(m.toLowerCase())
      )
    )
  );

  // 品类：用产品库检索兜底
  const hits = searchSkus(text, 3);
  const category = hits[0]?.nameZh.split("·")[0].trim() ?? "手机配件";

  return {
    buyerMarket: market?.market ?? "未指明",
    buyerType: market?.buyerType ?? "买家",
    category,
    models: models.length ? models : ["universal"],
    quantity,
    targetPriceUsd,
    timeline: extractTimeline(text),
    incoterm: /ddp/i.test(text) ? "DDP" : /cif/i.test(text) ? "CIF" : /exw/i.test(text) ? "EXW" : "FOB",
    needIpClearance: /授权|ip|版权|图案授权|licen/i.test(text),
    summary: text.slice(0, 40),
  };
}

// ── 报价上下文 ──────────────────────────────────────────────────────────────

/** 把意图 + 产品库 + 测算结果组装成报价上下文（纯函数，可测试） */
export function buildQuoteContext(
  intent: InquiryIntent,
  assumptions: QuoteAssumptions = DEFAULT_ASSUMPTIONS,
  limit = 3
): QuoteContext {
  // 检索词：机型优先，其次品类
  const query = [...intent.models.filter((m) => m !== "universal"), intent.category]
    .filter(Boolean)
    .join(" ");
  let skus = searchSkus(query, limit);
  if (!skus.length) skus = searchSkus(intent.category, limit);
  if (!skus.length) skus = CATALOG.slice(0, limit);

  const lines: QuoteLine[] = skus.map((sku) => ({
    sku,
    qty: intent.quantity,
    cost: estimateLandedCost(sku, intent.quantity, assumptions),
  }));

  const cheapest = lines.length
    ? lines.reduce((a, b) => (a.cost.landedUnit <= b.cost.landedUnit ? a : b))
    : null;

  const targetGapUsd =
    intent.targetPriceUsd !== null && cheapest
      ? cheapest.cost.landedUnit - intent.targetPriceUsd
      : null;

  // 本地规则提醒：不依赖 LLM，保证关键风险一定会出现在报价里
  const flags: string[] = [];
  if (lines.some((l) => l.cost.belowMoq)) {
    flags.push(`数量 ${intent.quantity} 低于部分款式的起订量，需提示客户凑单或调价`);
  }
  if (lines.some((l) => l.sku.ipClearanceRequired)) {
    flags.push("涉及图案类产品：必须提供授权链文件，否则不得报价（本品类第一大死因）");
  }
  if (targetGapUsd !== null && targetGapUsd > 0) {
    flags.push(
      `客户目标价 $${intent.targetPriceUsd} 低于最优到岸成本 $${cheapest!.cost.landedUnit.toFixed(3)}，` +
        `差 $${targetGapUsd.toFixed(3)}/个 —— 必须客观说明，不要假装能降价`
    );
  }
  if (lines.some((l) => l.sku.category === "power-bank")) {
    flags.push("含锂电池：空运需 UN38.3 + MSDS，通常只能海运，交期承诺要留余量");
  }
  flags.push("报价按体积重计费（轻抛货），不是实重 —— 这是本品类最常见的报价错误");

  return {
    intent,
    lines,
    catalogText: formatCatalog(skus, assumptions),
    assumptions,
    targetGapUsd,
    flags,
  };
}

// ── 报价单生成 ──────────────────────────────────────────────────────────────

export function quoteMessages(ctx: QuoteContext): ChatMessage[] {
  const { intent, catalogText, assumptions, targetGapUsd, flags } = ctx;

  const system = `你是一名资深外贸报价专员，代表深圳华强北的手机配件供应链，为海外买家生成一份**英文报价单**。

硬性要求：
1. **只用下面【产品库】里给出的价格**。绝对不许自己编造、推测或"大概"任何单价。产品库里没有的规格，明确说明"需要确认"。
2. 报价单必须包含：产品明细表（型号 / 数量 / 阶梯单价 / 小计）、MOQ、打样周期与量产交期、贸易术语（${intent.incoterm}）、体积重说明、关税提示、IP 授权条款、下一步行动。
3. **运费必须说明按体积重（volumetric weight）计费**，不是实重 —— 手机壳是轻抛货，这是最常见的报价错误。体积重按 1 cbm ≈ 167 kg 换算。
4. **美国关税**按 HS 4202.32 基础税率约 17.6% 提示，并明确注明 Section 301 附加关税需按下单时实际税率复核。
5. 如果客户目标价低于到岸成本，**必须客观指出差距**，给出可行的替代方案（调规格 / 提数量 / 换机型 / 改海运），不要含糊其辞或假装能降价。
6. 付款与交付条款留待工厂确认，**不要承诺账期、不要承诺垫资或代管货款**。
7. 输出纯英文，专业、简洁、可直接转发给客户。用 Markdown 表格。不要输出任何中文。

【产品库（价格唯一来源）】
${catalogText}

【到岸成本测算口径】
- 运费模式：${assumptions.freightMode === "sea" ? "海运" : "空运"}，费率 ${assumptions.freightRate} ${assumptions.freightMode === "sea" ? "USD/cbm" : "USD/kg(体积重)"}
- 关税率：${(assumptions.dutyRate * 100).toFixed(1)}%（按 FOB + 运费 的 CIF 口径）
- 汇率参考：¥7.1 = $1

【必须处理的风险点】
${flags.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

  const user = `【买家询盘（口述转写，原文）】
${intent.summary || "（见下方结构化信息）"}

【结构化信息】
- 市场：${marketNameEn(intent.buyerMarket) ?? "未指明"}（写成英文，不要写中文国名）
- 买家类型：${intent.buyerType}
- 品类：${intent.category}
- 机型：${intent.models.join(", ")}
- 数量：${intent.quantity} 个
- 目标单价：${intent.targetPriceUsd !== null ? `$${intent.targetPriceUsd}/个` : "未提及"}
- 交期要求：${intent.timeline || "未提及"}
- 贸易术语：${intent.incoterm}
- 是否要求 IP 授权：${intent.needIpClearance ? "是" : "否"}
${targetGapUsd !== null ? `- 目标价与最优到岸成本差距：$${targetGapUsd.toFixed(3)}/个` : ""}

请生成英文报价单。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 报价单的追问/改价（复用口头改稿的思路，但限定在报价语境） */
export function quoteRevisionMessages(
  currentQuote: string,
  instruction: string,
  ctx: QuoteContext
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是外贸报价专员。客户对**已有英文报价单**提出了修改要求，请按要求修改。

要求：
- 价格只能取自【产品库】，不得编造
- 只改客户要求的部分，其余保持原样（保持英文、保持 Markdown 结构）
- 如果客户要求的价格低于成本，必须指出差距并给替代方案，不要假装能降
- 直接输出修改后的**完整报价单**，不要输出解释、diff 或中文

【产品库（价格唯一来源）】
${ctx.catalogText}`,
    },
    {
      role: "user",
      content: `【当前报价单】\n${currentQuote.slice(0, 6000)}\n\n【修改要求】\n${instruction}`,
    },
  ];
}

/** 把上下文压成前端可渲染的摘要（不含 prompt 大文本） */
export function summarizeContext(ctx: QuoteContext) {
  return {
    intent: ctx.intent,
    flags: ctx.flags,
    targetGapUsd: ctx.targetGapUsd,
    assumptions: ctx.assumptions,
    lines: ctx.lines.map((l) => ({
      id: l.sku.id,
      nameZh: l.sku.nameZh,
      nameEn: l.sku.nameEn,
      models: l.sku.models,
      qty: l.qty,
      fobUnit: l.cost.fobUnit,
      freightUnit: l.cost.freightUnit,
      dutyUnit: l.cost.dutyUnit,
      landedUnit: l.cost.landedUnit,
      goodsValue: l.cost.goodsValue,
      cbm: l.cost.cbm,
      volumetricKg: l.cost.volumetricKg,
      belowMoq: l.cost.belowMoq,
      moq: l.sku.moq,
      sampleDays: l.sku.sampleDays,
      productionDays: l.sku.productionDays,
      ipClearanceRequired: l.sku.ipClearanceRequired,
    })),
  };
}

export type QuoteSummary = ReturnType<typeof summarizeContext>;
