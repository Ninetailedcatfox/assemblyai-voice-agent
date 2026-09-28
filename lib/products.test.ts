import { describe, expect, it } from "vitest";
import {
  CATALOG,
  DEFAULT_ASSUMPTIONS,
  estimateLandedCost,
  fobForQty,
  formatCatalog,
  searchSkus,
  volumetricWeightKg,
} from "./products";

describe("CATALOG", () => {
  it("SKU 数量在 10-20 之间，id 唯一", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(CATALOG.length).toBeLessThanOrEqual(20);
    expect(new Set(CATALOG.map((s) => s.id)).size).toBe(CATALOG.length);
  });

  it("每个 SKU 的阶梯价单调递减、数量递增", () => {
    for (const sku of CATALOG) {
      const tiers = [...sku.tiers].sort((a, b) => a.minQty - b.minQty);
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].minQty).toBeGreaterThan(tiers[i - 1].minQty);
        expect(tiers[i].fobUsd).toBeLessThan(tiers[i - 1].fobUsd);
      }
      // 首档数量必须等于 MOQ，否则报价会出现"低于起订量还给了阶梯价"
      expect(tiers[0].minQty).toBe(sku.moq);
    }
  });

  it("出厂价与 FOB 区间合法，且 FOB 高于出厂价换算值（毛利为正）", () => {
    for (const sku of CATALOG) {
      expect(sku.factoryPriceCny[0]).toBeLessThanOrEqual(sku.factoryPriceCny[1]);
      expect(sku.fobUsd[0]).toBeLessThanOrEqual(sku.fobUsd[1]);
      // ¥ → $ 约 7.1，出厂价上限换算后应低于 FOB 上限
      expect(sku.factoryPriceCny[1] / 7.1).toBeLessThan(sku.fobUsd[1]);
    }
  });

  it("热款 IP 快反款被标记为需要 IP 授权链文件", () => {
    const hot = CATALOG.find((s) => s.id === "hot-ip-orig");
    expect(hot?.ipClearanceRequired).toBe(true);
    expect(hot?.note).toContain("授权链");
  });
});

describe("searchSkus", () => {
  it("按机型命中", () => {
    const hits = searchSkus("我需要 iPhone 16 Pro Max 的壳");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((s) => s.models.includes("iPhone 16 Pro Max"))).toBe(true);
  });

  it("按品类中文名命中", () => {
    const hits = searchSkus("磁吸壳");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((s) => s.category === "magsafe-case")).toBe(true);
  });

  it("空查询返回全库前 N 个（供演示兜底）", () => {
    expect(searchSkus("")).toHaveLength(5);
    expect(searchSkus("   ", 3)).toHaveLength(3);
  });

  it("完全无关的查询返回空", () => {
    expect(searchSkus("zzzzz")).toEqual([]);
  });
});

describe("fobForQty", () => {
  const sku = CATALOG.find((s) => s.id === "imd-ip16pm")!;

  it("按数量取对应阶梯价", () => {
    expect(fobForQty(sku, 1000)).toBe(1.3);
    expect(fobForQty(sku, 5000)).toBe(1.05);
    expect(fobForQty(sku, 99999)).toBe(0.92);
  });

  it("低于 MOQ 时退回首档价（不虚构更低价格）", () => {
    expect(fobForQty(sku, 100)).toBe(1.3);
  });
});

describe("运费与到岸成本（轻抛货按体积重，不按实重）", () => {
  const sku = CATALOG.find((s) => s.id === "imd-ip16pm")!;

  it("海运单位运费落在业务文档实测区间 $0.15-0.3/个", () => {
    const est = estimateLandedCost(sku, sku.moq, DEFAULT_ASSUMPTIONS);
    expect(est.freightUnit).toBeGreaterThanOrEqual(0.15);
    expect(est.freightUnit).toBeLessThanOrEqual(0.3);
  });

  it("空运单位运费落在业务文档实测区间 $1.5-3/个，且显著高于海运", () => {
    const air = estimateLandedCost(sku, sku.moq, {
      freightMode: "air",
      freightRate: 27,
      dutyRate: 0.176,
    });
    const sea = estimateLandedCost(sku, sku.moq, DEFAULT_ASSUMPTIONS);
    expect(air.freightUnit).toBeGreaterThanOrEqual(1.5);
    expect(air.freightUnit).toBeLessThanOrEqual(3);
    expect(air.freightUnit).toBeGreaterThan(sea.freightUnit * 5);
  });

  it("空运按体积重计费，体积重远大于实重（这就是报价最容易错的地方）", () => {
    const est = estimateLandedCost(sku, sku.moq, DEFAULT_ASSUMPTIONS);
    expect(volumetricWeightKg(sku.cbmPer1000)).toBeCloseTo(83.5, 1);
    expect(est.volumetricKg).toBeGreaterThan(sku.weightKgPer1000);
  });

  it("到岸成本 = FOB + 运费 + 关税，且货值/体积计算正确", () => {
    const est = estimateLandedCost(sku, 5000, DEFAULT_ASSUMPTIONS);
    expect(est.qty).toBe(5000);
    expect(est.fobUnit).toBe(1.05);
    expect(est.cbm).toBeCloseTo(2.5, 3);
    expect(est.landedUnit).toBeCloseTo(
      est.fobUnit + est.freightUnit + est.dutyUnit,
      10
    );
    expect(est.goodsValue).toBeCloseTo(1.05 * 5000, 6);
  });

  it("低于 MOQ 会被标记出来，交给 Agent 提醒客户", () => {
    const est = estimateLandedCost(sku, 100, DEFAULT_ASSUMPTIONS);
    expect(est.belowMoq).toBe(true);
    expect(estimateLandedCost(sku, 5000, DEFAULT_ASSUMPTIONS).belowMoq).toBe(false);
  });
});

describe("formatCatalog", () => {
  it("输出可注入 prompt 的编号资料块，含阶梯价与到岸测算", () => {
    const text = formatCatalog(searchSkus("磁吸壳"));
    expect(text).toContain("[1]");
    expect(text).toContain("阶梯:");
    expect(text).toContain("到岸测算");
    expect(text).toContain("id: ms-ip16");
  });

  it("需授权的 SKU 会带上警示行", () => {
    const text = formatCatalog([CATALOG.find((s) => s.id === "hot-ip-orig")!]);
    expect(text).toContain("需 IP 授权链文件");
  });
});
