/**
 * 市场名的中→英映射。
 *
 * 询盘意图里的 `buyerMarket` 是中文（来自规则解析或 LLM），而报价单是要直接
 * 转发给海外买家的 —— 漏一个"美国"进去就是一份不能用的文件。
 *
 * 单独成模块是为了让 `lib/quote.ts`（拼 LLM prompt）和 `lib/quoteDocument.ts`
 * （本地生成报价单）都能用，而不产生循环依赖。
 */
const MARKET_EN: Record<string, string> = {
  美国: "United States",
  阿联酋: "United Arab Emirates",
  沙特: "Saudi Arabia",
  非洲: "Africa",
  拉美: "Latin America",
  东南亚: "Southeast Asia",
  欧洲: "Europe",
};

/** 取市场的英文名；中文且无映射时返回 null（调用方应省略该行） */
export function marketNameEn(market: string): string | null {
  const m = market.trim();
  if (!m) return null;
  const mapped = MARKET_EN[m];
  if (mapped) return mapped;
  return /[\u4e00-\u9fff]/.test(m) ? null : m;
}
