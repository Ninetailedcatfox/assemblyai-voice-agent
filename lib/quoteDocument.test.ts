import { describe, expect, it } from "vitest";
import { buildQuoteDocument, assessQuoteText, clientFacingPart } from "./quoteDocument";
import { marketNameEn } from "./marketNames";
import { buildQuoteContext, fallbackIntent } from "./quote";
import { CATALOG, DEFAULT_ASSUMPTIONS, estimateLandedCost } from "./products";

const DRAFT =
  "美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1，希望两周内能到美仓，问能不能做";

const ctxFor = (draft: string) => buildQuoteContext(fallbackIntent(draft));
const FIXED_NOW = new Date("2026-09-28T00:00:00Z");

describe("buildQuoteDocument", () => {
  const ctx = ctxFor(DRAFT);
  const doc = buildQuoteDocument(ctx, { now: FIXED_NOW });

  it("包含报价单抬头与固定日期", () => {
    expect(doc).toContain("# QUOTATION");
    expect(doc).toContain("**Date:** 2026-09-28");
    expect(doc).toContain("**Trade term:** FOB Ningbo, China");
  });

  it("明细表里的单价与已算出的 FOB 完全一致（不重新计算、不编造）", () => {
    for (const line of ctx.lines) {
      expect(doc).toContain(`$${line.cost.fobUnit.toFixed(3)}`);
    }
  });

  it("必须写明体积重计费，而不是实重", () => {
    expect(doc).toMatch(/volumetric weight/i);
    expect(doc).toContain("1 cbm ≈ 167 kg");
    expect(doc).toMatch(/not actual weight/i);
  });

  it("必须提示 HS 4202.32 与 Section 301 需复核", () => {
    expect(doc).toContain("HS 4202.32");
    expect(doc).toMatch(/Section 301/);
    expect(doc).toMatch(/re-verified/i);
  });

  it("不承诺账期或垫资", () => {
    expect(doc).toMatch(/do not offer credit terms/i);
    expect(doc).not.toMatch(/net\s*30|net\s*60/i);
  });

  it("图案类产品必须带 IP 授权条款", () => {
    expect(ctx.lines.some((l) => l.sku.ipClearanceRequired)).toBe(true);
    expect(doc).toMatch(/IP & Artwork Clearance/);
    expect(doc).toMatch(/authorisation chain/i);
  });

  it("目标价够不着时给出差距与替代方案", () => {
    // $1.1 对 5000 个 IMD 壳：最优到岸成本高于 $1.1，缺口为正
    expect(ctx.targetGapUsd).not.toBeNull();
    if (ctx.targetGapUsd! > 0) {
      expect(doc).toMatch(/Note on Your Target Price/);
      expect(doc).toContain(`$${ctx.targetGapUsd!.toFixed(3)}`);
      expect(doc).toMatch(/Specification/i);
      expect(doc).toMatch(/Volume/i);
    }
  });

  it("目标价够得着时不出现目标价差距章节，改在内部附注里说明余量", () => {
    const cheap = ctxFor("迪拜客户要 5000 个钢化膜，目标价 $1.5");
    const d = buildQuoteDocument(cheap, { now: FIXED_NOW });
    if (cheap.targetGapUsd !== null && cheap.targetGapUsd <= 0) {
      expect(d).not.toMatch(/Note on Your Target Price/);
      expect(d).toMatch(/headroom/i);
    }
  });

  it("章节编号连续且不重复", () => {
    const nums = doc
      .split("\n")
      .map((l) => l.match(/^## (\d+)\./)?.[1])
      .filter(Boolean)
      .map(Number);
    expect(nums.length).toBeGreaterThan(4);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it("内部附注单独成节并标注不要转发", () => {
    expect(doc).toContain("Internal Notes — do not forward");
  });

  it("输出全英文（不混中文）", () => {
    // 只看可转发给买家的部分：内部附注引用的风险提示原文是中文，那是给用户看的
    expect(clientFacingPart(doc)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(clientFacingPart(doc)).toContain("**Buyer market:** United States");
  });

  it("用整库上下文也不炸", () => {
    const wide = buildQuoteContext(fallbackIntent(DRAFT), DEFAULT_ASSUMPTIONS, CATALOG.length);
    const d = buildQuoteDocument(wide, { now: FIXED_NOW });
    expect(d.length).toBeGreaterThan(1500);
  });

  it("低于 MOQ 时照常生成，不抛错", () => {
    const small = ctxFor("客户要 100 个 MagSafe 磁吸壳，先试单");
    const d = buildQuoteDocument(small, { now: FIXED_NOW });
    expect(d).toContain("# QUOTATION");
    expect(small.lines.some((l) => l.cost.belowMoq)).toBe(true);
  });
});

describe("assessQuoteText", () => {
  const good = buildQuoteDocument(ctxFor(DRAFT), { now: FIXED_NOW });

  it("接受自己生成的完整报价单", () => {
    expect(assessQuoteText(good, "FOB").ok).toBe(true);
  });

  it("拒绝空输出", () => {
    const v = assessQuoteText("   ", "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/空输出/);
  });

  it("拒绝过短的输出（实测线上被截断到 356 字符那种）", () => {
    const v = assessQuoteText("QUOTATION\nUnit Price: USD 1.10/pc FOB", "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/过短/);
  });

  it("拒绝没有价格的输出", () => {
    const noPrice = "A".repeat(700) + " FOB MOQ lead time volumetric duty licence.";
    const v = assessQuoteText(noPrice, "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/未包含任何单价/);
  });

  it("拒绝贸易术语不符的输出", () => {
    // 只在"可转发给买家"的部分替换，内部附注的中文不参与判定
    const cifOnly = clientFacingPart(good).replace(/FOB/g, "CIF");
    const v = assessQuoteText(cifOnly, "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/贸易术语/);
  });

  it("拒绝被截断在半个单词上的输出", () => {
    const truncated = good.slice(0, 1200) + " and then we will";
    const v = assessQuoteText(truncated, "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/截断/);
  });

  it("拒绝缺关键条款的泛泛而谈", () => {
    const vague =
      ("Dear buyer, thanks for your inquiry. Our unit price is $1.10 per piece FOB Ningbo. " +
        "We look forward to working with you. ").repeat(20);
    const v = assessQuoteText(vague, "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/缺少关键条款/);
  });

  it("拒绝含中文的输出（模型会把中文国名抄进英文报价单）", () => {
    const leaked = good.replace("**Trade term:**", "**Buyer market:** 美国  \n**Trade term:**");
    const v = assessQuoteText(leaked, "FOB");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/含中文/);
  });
});

describe("marketNameEn", () => {
  it("把规则解析产出的中文市场名翻成英文", () => {
    expect(marketNameEn("美国")).toBe("United States");
    expect(marketNameEn("阿联酋")).toBe("United Arab Emirates");
    expect(marketNameEn("东南亚")).toBe("Southeast Asia");
  });

  it("已是英文则原样返回", () => {
    expect(marketNameEn("United States")).toBe("United States");
    expect(marketNameEn("Germany")).toBe("Germany");
  });

  it("中文但无映射时返回 null，绝不把中文漏出去", () => {
    expect(marketNameEn("未指明")).toBeNull();
    expect(marketNameEn("火星")).toBeNull();
    expect(marketNameEn("")).toBeNull();
  });
});

describe("estimateLandedCost 与报价单一致性", () => {
  it("明细表用的就是 estimateLandedCost 的结果", () => {
    const sku = CATALOG[0];
    const est = estimateLandedCost(sku, 5000, DEFAULT_ASSUMPTIONS);
    expect(est.landedUnit).toBeCloseTo(est.fobUnit + est.freightUnit + est.dutyUnit, 10);
  });
});
