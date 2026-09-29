/**
 * 中文数字 ↔ 阿拉伯数字。**这条链路是中文口述驱动的，所以它是一等公民，不是小工具。**
 *
 * 为什么单独成模块：`lib/quote.ts`（意图解析）和 `lib/products.ts`（产品库检索）
 * 都要用它，而后者被前者 import —— 放任何一边都会形成循环依赖。
 *
 * 实测代价（都是线上真实会话里抓到的，不是假想）：
 * - "五千个" 被读成默认值 1000 → 报价单写 `1,000 pcs`
 * - "一点一美元" 解析不出 → 目标价 null → "目标价够不着" 这条最关键的提醒消失
 * - "iPhone十六Pro Max" 匹配不到任何机型 → 整张报价单退化成通用配件
 */

/** 中文数字用到的字符（含"两"这种口语写法） */
export const CN_NUM_CHARS = "零一二两三四五六七八九十百千万亿";

const D: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const U: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/**
 * 解析中文数字："五千"→5000、"一万"→10000、"两万"→20000、
 * "一点一"→1.1、"零点九五"→0.95、"一千五"→1500。
 *
 * 解析不了就返回 `NaN`（宁可放弃也不猜）。
 */
export function parseCnNumber(input: string): number {
  const s = input.trim();
  if (!s) return NaN;

  const [intPart, decPart] = s.split("点");
  let total = 0; // "万/亿"以上已结算的部分
  let section = 0; // 当前小节（万以下）
  let num = 0; // 待结算的个位数字
  let lastUnit = 0; // 最后一个单位，用于处理"一千五 = 1500"这类省略写法
  let trailingDigit: number | null = null; // 末尾未带单位的数字
  /**
   * 末尾数字能否按"省略单位"解释。
   * 必须跟踪：出现"零"就说明后面的数字是**显式**的低位，
   * 不能再当省略单位算 —— 否则 "一百零八" 会算成 100 + 8×10 = 180，
   * "一千零五" 会算成 1500。这两个都是真实会出现在报价里的数。
   */
  let elidable = false;

  for (const ch of intPart) {
    if (ch in D) {
      num = D[ch];
      trailingDigit = num;
      if (ch === "零") elidable = false;
    } else if (ch in U) {
      section += (num === 0 ? 1 : num) * U[ch]; // "十五"的十前面省略了"一"
      num = 0;
      trailingDigit = null;
      lastUnit = U[ch];
      elidable = true;
    } else if (ch === "万") {
      total += (section + num) * 10000;
      section = 0;
      num = 0;
      trailingDigit = null;
      lastUnit = 10000;
      elidable = true;
    } else if (ch === "亿") {
      total = (total + section + num) * 100000000;
      section = 0;
      num = 0;
      trailingDigit = null;
      lastUnit = 100000000;
      elidable = true;
    } else {
      return NaN; // 混进了非数字字符，宁可放弃也不要猜
    }
  }

  let value = total + section + num;
  // "一千五"(1500)、"一万五"(15000)、"两千三"(2300)：末尾数字省略了单位，
  // 按最后一个单位的十分之一补。
  if (elidable && trailingDigit !== null && lastUnit >= 100) {
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
 * 把文本里的中文数字串就地换成阿拉伯数字："iPhone十六Pro Max" → "iPhone16Pro Max"。
 *
 * 只用于**匹配**（机型名比对、检索词），不用于展示 —— 因为整句里
 * "一个""两周"这种也会被换掉，换完的句子不通顺。
 * 超过 4 位的数不换（"两周内"这种量词串没有换的价值，换了反而脏）。
 */
export function normalizeCnDigits(text: string): string {
  return text.replace(new RegExp(`[${CN_NUM_CHARS}点]{1,8}`, "g"), (m) => {
    // 以"点"开头的串不换：那是 "重点一：" 这类标点后的字，
    // 硬换会把 "点一" 变成 "0.1"，把原文弄脏。
    if (m.startsWith("点")) return m;
    const v = parseCnNumber(m);
    return Number.isFinite(v) && v > 0 && v < 10000 ? String(v) : m;
  });
}

/**
 * 压掉空格/连字符/下划线，用于机型名比对。
 *
 * 为什么需要：口述转写不会给你 "iPhone 16 Pro Max" 这么标准的写法，
 * 出来的是 "iPhone16Pro Max" 这种没有空格的样子。逐字 `includes` 必然匹配不上。
 */
export function compactForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·]+/g, "");
}
