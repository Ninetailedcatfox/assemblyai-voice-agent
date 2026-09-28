/**
 * 手机配件 SKU 库 —— 外贸询盘 Agent 的检索层。
 *
 * 数据口径**全部来自白泽自己的业务文档**，不是我编的：
 *   `Desktop\新建文件夹\轻工业品线\00_轻工业品线总览与打法.md`（2026-09-13）
 *
 * 关键口径（改数前先回去看那份文档）：
 * - 华强北出厂：磁吸壳 ¥6-12/个，普通 IMD 壳 ¥4-8
 * - FOB 报价：$0.9-1.8/个（含包装）
 * - 轻抛货**按体积重计费**，不是实重 —— 报价最容易错的地方
 * - 美国关税：HS 4202.32 基础税率 ~17.6% + 301 叠加（**波动大，下单前实测**）
 * - 佣金：工厂端 3-5% / 买家端 5-8%（本赛只做纯牵线，不垫资、不经手货款）
 * - ⚠️ IP 侵权是本品类第一大死因：未授权卡通/影视/体育图案，单案赔偿 $2-15 万起
 */

export type SkuCategory =
  | "magsafe-case"
  | "imd-case"
  | "clear-case"
  | "feature-phone-case"
  | "tablet-case"
  | "screen-protector"
  | "magnetic-mount"
  | "power-bank"
  | "cable"
  | "hot-ip-case";

/** 阶梯价：数量越大单价越低（FOB，美元/个） */
export interface SkuTier {
  minQty: number;
  fobUsd: number;
}

export interface Sku {
  id: string;
  nameZh: string;
  nameEn: string;
  category: SkuCategory;
  /** 适配机型；"universal" = 通用（如功能机） */
  models: string[];
  /** 华强北出厂价（人民币/个），区间 [低, 高] */
  factoryPriceCny: [number, number];
  /** FOB 报价（美元/个，含包装），区间 [低, 高] */
  fobUsd: [number, number];
  /** 起订量（个） */
  moq: number;
  /** 打样天数 */
  sampleDays: number;
  /** 量产交期（天，到美仓参考 14 天） */
  productionDays: number;
  /** 每 1000 个的体积（cbm）—— 轻抛货报价必须用它算运费 */
  cbmPer1000: number;
  /** 每 1000 个的实重（kg）—— 仅参考，**报价不要按它算空运** */
  weightKgPer1000: number;
  /** 是否需要 IP 授权链文件（未授权图案 = 第一大死因） */
  ipClearanceRequired: boolean;
  tiers: SkuTier[];
  note: string;
}

export const CATALOG: Sku[] = [
  {
    id: "ms-ip16",
    nameZh: "MagSafe 磁吸壳 · iPhone 16 系列",
    nameEn: "MagSafe Magnetic Case for iPhone 16 Series",
    category: "magsafe-case",
    models: ["iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max"],
    factoryPriceCny: [9, 12],
    fobUsd: [1.3, 1.8],
    moq: 500,
    sampleDays: 3,
    productionDays: 14,
    cbmPer1000: 0.52,
    weightKgPer1000: 34,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 1.8 },
      { minQty: 2000, fobUsd: 1.55 },
      { minQty: 5000, fobUsd: 1.35 },
    ],
    note: "苹果生态客单价高；只做磁吸结构件可绕开 MFi 认证要求。",
  },
  {
    id: "ms-ip15",
    nameZh: "MagSafe 磁吸壳 · iPhone 15 系列",
    nameEn: "MagSafe Magnetic Case for iPhone 15 Series",
    category: "magsafe-case",
    models: ["iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max"],
    factoryPriceCny: [8, 11],
    fobUsd: [1.2, 1.6],
    moq: 500,
    sampleDays: 3,
    productionDays: 14,
    cbmPer1000: 0.52,
    weightKgPer1000: 34,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 1.6 },
      { minQty: 2000, fobUsd: 1.4 },
      { minQty: 5000, fobUsd: 1.22 },
    ],
    note: "存量机型，适合做复购补货而不是追热点。",
  },
  {
    id: "ms-s24",
    nameZh: "MagSafe 磁吸壳 · 三星 Galaxy S24 系列",
    nameEn: "MagSafe Magnetic Case for Samsung Galaxy S24 Series",
    category: "magsafe-case",
    models: ["Galaxy S24", "Galaxy S24+", "Galaxy S24 Ultra"],
    factoryPriceCny: [8, 11],
    fobUsd: [1.2, 1.6],
    moq: 500,
    sampleDays: 4,
    productionDays: 14,
    cbmPer1000: 0.53,
    weightKgPer1000: 35,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 1.6 },
      { minQty: 2000, fobUsd: 1.38 },
      { minQty: 5000, fobUsd: 1.2 },
    ],
    note: "安卓磁吸生态在欧美走量，竞争比 iPhone 小。",
  },
  {
    id: "mount-car",
    nameZh: "磁吸车载支架",
    nameEn: "Magnetic Car Mount",
    category: "magnetic-mount",
    models: ["universal"],
    factoryPriceCny: [5, 9],
    fobUsd: [0.9, 1.4],
    moq: 1000,
    sampleDays: 4,
    productionDays: 16,
    cbmPer1000: 0.9,
    weightKgPer1000: 78,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 1000, fobUsd: 1.4 },
      { minQty: 5000, fobUsd: 1.15 },
      { minQty: 10000, fobUsd: 0.95 },
    ],
    note: "体积偏大，拼柜时优先和壳类混装压体积。",
  },
  {
    id: "pb-mag-5000",
    nameZh: "磁吸充电宝 5000mAh",
    nameEn: "MagSafe Magnetic Power Bank 5000mAh",
    category: "power-bank",
    models: ["universal"],
    factoryPriceCny: [28, 45],
    fobUsd: [4.5, 7.5],
    moq: 500,
    sampleDays: 7,
    productionDays: 20,
    cbmPer1000: 1.6,
    weightKgPer1000: 210,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 7.5 },
      { minQty: 2000, fobUsd: 6.2 },
      { minQty: 5000, fobUsd: 5.1 },
    ],
    note: "带锂电池：空运需 UN38.3 + MSDS，多数情况只能海运 —— 报价必须说明，否则交期承诺会翻车。",
  },
  {
    id: "imd-ip16pm",
    nameZh: "IMD 图案壳 · iPhone 16 Pro Max",
    nameEn: "IMD Printed Case for iPhone 16 Pro Max",
    category: "imd-case",
    models: ["iPhone 16 Pro Max"],
    factoryPriceCny: [4, 8],
    fobUsd: [0.9, 1.3],
    moq: 1000,
    sampleDays: 3,
    productionDays: 14,
    cbmPer1000: 0.5,
    weightKgPer1000: 32,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 1000, fobUsd: 1.3 },
      { minQty: 5000, fobUsd: 1.05 },
      { minQty: 10000, fobUsd: 0.92 },
    ],
    note: "主力走量款。图案必须是原创公版，卡通/影视/体育 logo 一律不接。",
  },
  {
    id: "imd-ip13-14",
    nameZh: "IMD 图案壳 · iPhone 13 / 14 通用",
    nameEn: "IMD Printed Case for iPhone 13 / 14",
    category: "imd-case",
    models: ["iPhone 13", "iPhone 14"],
    factoryPriceCny: [4, 6],
    fobUsd: [0.85, 1.1],
    moq: 1000,
    sampleDays: 3,
    productionDays: 14,
    cbmPer1000: 0.5,
    weightKgPer1000: 32,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 1000, fobUsd: 1.1 },
      { minQty: 5000, fobUsd: 0.92 },
      { minQty: 10000, fobUsd: 0.85 },
    ],
    note: "存量机型走量款，单价最低，适合做拉美/东南亚价格敏感市场。",
  },
  {
    id: "imd-pixel8",
    nameZh: "IMD 图案壳 · Google Pixel 8 / 8a",
    nameEn: "IMD Printed Case for Google Pixel 8 / 8a",
    category: "imd-case",
    models: ["Pixel 8", "Pixel 8a", "Pixel 9"],
    factoryPriceCny: [5, 9],
    fobUsd: [1.0, 1.5],
    moq: 500,
    sampleDays: 4,
    productionDays: 16,
    cbmPer1000: 0.5,
    weightKgPer1000: 33,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 1.5 },
      { minQty: 2000, fobUsd: 1.25 },
      { minQty: 5000, fobUsd: 1.1 },
    ],
    note: "小众机型切法：大厂不做，竞争小、复购稳。需要独立开模。",
  },
  {
    id: "imd-gaming",
    nameZh: "IMD 图案壳 · 游戏手机（ROG / 红魔）",
    nameEn: "IMD Printed Case for Gaming Phones (ROG / RedMagic)",
    category: "imd-case",
    models: ["ROG Phone 8", "RedMagic 9 Pro"],
    factoryPriceCny: [6, 10],
    fobUsd: [1.1, 1.6],
    moq: 500,
    sampleDays: 5,
    productionDays: 18,
    cbmPer1000: 0.55,
    weightKgPer1000: 38,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 1.6 },
      { minQty: 2000, fobUsd: 1.35 },
      { minQty: 5000, fobUsd: 1.2 },
    ],
    note: "小众机型，机型碎片化最严重，必须按销量数据选款，别囤。",
  },
  {
    id: "clear-uv-ip16",
    nameZh: "抗 UV 透明壳 · iPhone 16",
    nameEn: "Anti-UV Clear Case for iPhone 16",
    category: "clear-case",
    models: ["iPhone 16", "iPhone 16 Pro"],
    factoryPriceCny: [5, 8],
    fobUsd: [1.0, 1.4],
    moq: 1000,
    sampleDays: 3,
    productionDays: 14,
    cbmPer1000: 0.5,
    weightKgPer1000: 32,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 1000, fobUsd: 1.4 },
      { minQty: 5000, fobUsd: 1.15 },
      { minQty: 10000, fobUsd: 1.02 },
    ],
    note: "抗 UV 原料成本 +¥0.5/个，但这是差评之源（黄变）——必须留样对比，报价里别省这一毛。",
  },
  {
    id: "glass-ip16",
    nameZh: "钢化膜 · iPhone 16 全系",
    nameEn: "Tempered Glass Screen Protector for iPhone 16 Series",
    category: "screen-protector",
    models: ["iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max"],
    factoryPriceCny: [0.6, 1.5],
    fobUsd: [0.15, 0.35],
    moq: 5000,
    sampleDays: 2,
    productionDays: 12,
    cbmPer1000: 0.045,
    weightKgPer1000: 12,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 5000, fobUsd: 0.35 },
      { minQty: 20000, fobUsd: 0.25 },
      { minQty: 50000, fobUsd: 0.18 },
    ],
    note: "体积极小但**起订量高**，适合和壳类拼柜摊运费。单件利润薄，靠量。",
  },
  {
    id: "glass-univ",
    nameZh: "钢化膜 · 通用 6.1 英寸",
    nameEn: "Universal Tempered Glass 6.1 inch",
    category: "screen-protector",
    models: ["universal"],
    factoryPriceCny: [0.5, 1.2],
    fobUsd: [0.12, 0.3],
    moq: 10000,
    sampleDays: 2,
    productionDays: 12,
    cbmPer1000: 0.045,
    weightKgPer1000: 12,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 10000, fobUsd: 0.3 },
      { minQty: 50000, fobUsd: 0.2 },
      { minQty: 100000, fobUsd: 0.14 },
    ],
    note: "非洲/拉美价格敏感市场主力，走量最大。",
  },
  {
    id: "feat-nokia",
    nameZh: "功能机壳 · 诺基亚 105 / 110 通用",
    nameEn: "Feature Phone Case for Nokia 105 / 110",
    category: "feature-phone-case",
    models: ["Nokia 105", "Nokia 110", "universal"],
    factoryPriceCny: [1.5, 3],
    fobUsd: [0.3, 0.6],
    moq: 2000,
    sampleDays: 3,
    productionDays: 15,
    cbmPer1000: 0.32,
    weightKgPer1000: 20,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 2000, fobUsd: 0.6 },
      { minQty: 10000, fobUsd: 0.45 },
      { minQty: 20000, fobUsd: 0.35 },
    ],
    note: "蓝海：大厂基本退出功能机配件，非洲/南亚存量市场大。客单价低，靠拼柜走量。",
  },
  {
    id: "tab-ipad109",
    nameZh: "平板壳 · iPad 10.9 带笔槽",
    nameEn: "Tablet Case for iPad 10.9 with Pencil Holder",
    category: "tablet-case",
    models: ["iPad 10.9", "iPad Air 11"],
    factoryPriceCny: [12, 20],
    fobUsd: [2.0, 3.2],
    moq: 500,
    sampleDays: 5,
    productionDays: 18,
    cbmPer1000: 1.3,
    weightKgPer1000: 145,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 500, fobUsd: 3.2 },
      { minQty: 2000, fobUsd: 2.6 },
      { minQty: 5000, fobUsd: 2.2 },
    ],
    note: "东南亚电商（Shopee/Lazada）走量不错；体积大，拼柜要算好。",
  },
  {
    id: "cable-c60w",
    nameZh: "编织数据线 Type-C 60W 1m",
    nameEn: "Braided USB-C Cable 60W 1m",
    category: "cable",
    models: ["universal"],
    factoryPriceCny: [3, 6],
    fobUsd: [0.7, 1.1],
    moq: 2000,
    sampleDays: 3,
    productionDays: 15,
    cbmPer1000: 0.18,
    weightKgPer1000: 42,
    ipClearanceRequired: false,
    tiers: [
      { minQty: 2000, fobUsd: 1.1 },
      { minQty: 10000, fobUsd: 0.88 },
      { minQty: 20000, fobUsd: 0.76 },
    ],
    note: "易起量、无开模成本；但认证（USB-IF）和快充协议虚标是投诉高发区。",
  },
  {
    id: "hot-ip-orig",
    nameZh: "热款快反壳 · 原创公版图案",
    nameEn: "Trend-Reactive Case (Original Artwork Only)",
    category: "hot-ip-case",
    models: ["iPhone 16 Pro Max", "iPhone 16", "Galaxy S24 Ultra"],
    factoryPriceCny: [6, 11],
    fobUsd: [1.1, 1.6],
    moq: 500,
    sampleDays: 3,
    productionDays: 14,
    cbmPer1000: 0.5,
    weightKgPer1000: 32,
    ipClearanceRequired: true,
    tiers: [
      { minQty: 500, fobUsd: 1.6 },
      { minQty: 2000, fobUsd: 1.35 },
      { minQty: 5000, fobUsd: 1.18 },
    ],
    note:
      "⚠️ 只接**原创公版**设计。卡通/影视/体育等 IP 图案必须提供授权链文件，否则一律不报价 —— " +
      "这是本品类第一大死因（FBA 卖家被投诉直接封店，会回头追偿）。" +
      "热款生命周期只有 4-8 周，首批建议 500-1000 个试单，爆了再追，绝不压大货。",
  },
];

// ── 报价测算 ────────────────────────────────────────────────────────────────
// 轻抛货的铁律：**按体积重计费，不是实重**。这是本品类最常见的报价错误。

/** 空运体积重换算：1 cbm ≈ 167 kg（标准 6000 除数的倒数） */
export const AIR_VOLUMETRIC_DIVISOR = 167;

export function volumetricWeightKg(cbm: number): number {
  return cbm * AIR_VOLUMETRIC_DIVISOR;
}

export interface QuoteAssumptions {
  freightMode: "sea" | "air";
  /** 海运：美元/cbm；空运：美元/kg（体积重） */
  freightRate: number;
  /** 关税税率。美国 HS 4202.32 基础 ~17.6%，301 叠加另计 —— 下单前必须实测 */
  dutyRate: number;
}

/**
 * 默认假设已用文档里的实测区间校准：
 * - 海运：0.5 cbm/1000 个壳 × $450/cbm ≈ $0.225/个（文档实测 $0.15-0.3）✓
 * - 空运：0.5 cbm × 167 ≈ 83.5 kg/1000 个 × $27/kg ≈ $2.25/个（文档实测 $1.5-3）✓
 * ⚠️ 运费和关税波动大，正式报价前必须重新核价，不能拿这套默认值直接发客户。
 */
export const DEFAULT_ASSUMPTIONS: QuoteAssumptions = {
  freightMode: "sea",
  freightRate: 450,
  dutyRate: 0.176,
};

/** 按数量取阶梯 FOB 单价（低于 MOQ 返回区间上限，并提示需确认） */
export function fobForQty(sku: Sku, qty: number): number {
  const applicable = sku.tiers
    .filter((t) => qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
  return applicable ? applicable.fobUsd : sku.tiers[0]?.fobUsd ?? sku.fobUsd[1];
}

export interface CostEstimate {
  qty: number;
  fobUnit: number;
  freightUnit: number;
  /** 关税按 (FOB + 运费) 的 CIF 口径估算 */
  dutyUnit: number;
  /** 到岸单位成本（不含买家当地清关/派送） */
  landedUnit: number;
  /** 本单货值（FOB × 数量） */
  goodsValue: number;
  /** 需要的柜量体积（cbm） */
  cbm: number;
  /** 空运体积重（kg）—— 用来说明"为什么不能按实重报" */
  volumetricKg: number;
  belowMoq: boolean;
}

export function estimateLandedCost(
  sku: Sku,
  qty: number,
  a: QuoteAssumptions = DEFAULT_ASSUMPTIONS
): CostEstimate {
  const fobUnit = fobForQty(sku, qty);
  const thousands = qty / 1000;
  const cbm = thousands * sku.cbmPer1000;
  const volumetricKg = volumetricWeightKg(cbm);

  const freightUnit =
    a.freightMode === "sea"
      ? (cbm * a.freightRate) / qty
      : (volumetricKg * a.freightRate) / qty;

  const dutyUnit = (fobUnit + freightUnit) * a.dutyRate;

  return {
    qty,
    fobUnit,
    freightUnit,
    dutyUnit,
    landedUnit: fobUnit + freightUnit + dutyUnit,
    goodsValue: fobUnit * qty,
    cbm,
    volumetricKg,
    belowMoq: qty < sku.moq,
  };
}

// ── 检索（替代 Tavily 的"产品库检索"层）────────────────────────────────────

/**
 * 关键词检索。询盘是口述转来的、写法随意，所以做宽松匹配：
 * 机型、品类、中英文名都参与打分。空查询返回全库（供演示）。
 */
export function searchSkus(query: string, limit = 5): Sku[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATALOG.slice(0, limit);

  const terms = q.split(/[\s,，、/]+/).filter((t) => t.length >= 2);

  const scored = CATALOG.map((sku) => {
    const haystack = [
      sku.nameZh,
      sku.nameEn,
      sku.category,
      ...sku.models,
      sku.note,
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const t of terms) if (haystack.includes(t)) score += 2;
    // 型号精确命中权重更高（询盘里最关键的信息就是机型）
    for (const m of sku.models) {
      const ml = m.toLowerCase();
      if (ml !== "universal" && q.includes(ml)) score += 5;
    }
    if (q.includes(sku.id)) score += 5;
    return { sku, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.sku);
}

/** 把 SKU 格式化成可注入 prompt 的资料块（对齐 lib/search.ts 的 formatResearch） */
export function formatCatalog(skus: Sku[], assumptions = DEFAULT_ASSUMPTIONS): string {
  return skus
    .map((s, i) => {
      const est = estimateLandedCost(s, s.moq, assumptions);
      return [
        `[${i + 1}] ${s.nameZh} / ${s.nameEn}  (id: ${s.id})`,
        `    机型: ${s.models.join(", ")}`,
        `    出厂: ¥${s.factoryPriceCny[0]}-${s.factoryPriceCny[1]}/个 | FOB: $${s.fobUsd[0]}-${s.fobUsd[1]}/个`,
        `    阶梯: ${s.tiers.map((t) => `${t.minQty}+ → $${t.fobUsd}`).join(" | ")}`,
        `    MOQ: ${s.moq} | 打样 ${s.sampleDays} 天 | 量产 ${s.productionDays} 天`,
        `    体积: ${s.cbmPer1000} cbm/1000个（实重 ${s.weightKgPer1000} kg/1000个）`,
        `    ${s.moq} 个到岸测算: 运费 $${est.freightUnit.toFixed(3)}/个 + 关税 $${est.dutyUnit.toFixed(3)}/个 = 到岸 $${est.landedUnit.toFixed(3)}/个`,
        s.ipClearanceRequired ? "    ⚠️ 需 IP 授权链文件（未授权图案禁止报价）" : "",
        `    备注: ${s.note}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
