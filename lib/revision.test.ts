import { describe, expect, it } from "vitest";
import { applyOverrides, parseRevision } from "./revision";
import { buildQuoteDocument, clientFacingPart } from "./quoteDocument";
import { buildQuoteContext, fallbackIntent } from "./quote";

const DRAFT =
  "美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1，希望两周内能到美仓，问能不能做";

describe("parseRevision — 目标价", () => {
  it("识别 $ 写法", () => {
    const r = parseRevision("买家说目标价改成 $0.95");
    expect(r.targetPriceUsd).toBe(0.95);
    expect(r.unrecognised).toBe(false);
  });

  it("识别中文货币写法", () => {
    expect(parseRevision("客户说只能给 1.2 美元").targetPriceUsd).toBe(1.2);
    expect(parseRevision("降到 1 块").targetPriceUsd).toBe(1);
  });
});

describe("parseRevision — 贸易术语", () => {
  it("识别 DDP / CIF / EXW", () => {
    expect(parseRevision("改成 DDP").incoterm).toBe("DDP");
    expect(parseRevision("报 CIF 价").incoterm).toBe("CIF");
    expect(parseRevision("按 exw 算").incoterm).toBe("EXW");
  });

  it("大小写不敏感", () => {
    expect(parseRevision("switch to ddp").incoterm).toBe("DDP");
  });
});

describe("parseRevision — 数量", () => {
  it("识别普通数字与千分位", () => {
    expect(parseRevision("客户要 20000 个").quantity).toBe(20000);
    expect(parseRevision("数量改成 5,000 pcs").quantity).toBe(5000);
  });

  it("识别「万」", () => {
    expect(parseRevision("数量加到 1 万个").quantity).toBe(10000);
    expect(parseRevision("要 2.5 万件").quantity).toBe(25000);
  });
});

describe("parseRevision — 样品单陷阱", () => {
  it("提到样品/试单时，数字是打样数量而不是订单数量", () => {
    // 若把 500 当成订单数量，整份报价会按 500 个的低阶梯价重算 —— 报错价
    const r = parseRevision("买家说目标价改成 $0.95，而且要先发 500 个样品单试单");
    expect(r.sampleQty).toBe(500);
    expect(r.quantity).toBeUndefined();
    expect(r.targetPriceUsd).toBe(0.95);
    expect(r.changes.some((c) => /trial\/sample/i.test(c))).toBe(true);
  });

  it("英文 sample / trial 同样识别", () => {
    const r = parseRevision("send 300 pcs as sample first");
    expect(r.sampleQty).toBe(300);
    expect(r.quantity).toBeUndefined();
  });
});

describe("parseRevision — 识别不出的指令", () => {
  it("没有可执行改动时标记 unrecognised", () => {
    expect(parseRevision("再考虑考虑").unrecognised).toBe(true);
    expect(parseRevision("").unrecognised).toBe(true);
    expect(parseRevision("客户觉得贵").unrecognised).toBe(true);
  });
});

describe("applyOverrides", () => {
  const base = fallbackIntent(DRAFT);

  it("只覆盖指令里出现的字段", () => {
    const next = applyOverrides(base, parseRevision("改成 DDP"));
    expect(next.incoterm).toBe("DDP");
    expect(next.quantity).toBe(base.quantity);
    expect(next.targetPriceUsd).toBe(base.targetPriceUsd);
  });

  it("不修改原意图对象", () => {
    const snapshot = JSON.stringify(base);
    applyOverrides(base, parseRevision("改成 DDP，数量 2 万个，目标价 $0.8"));
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("目标价可以被改到低于成本，交给报价单去说明差距", () => {
    // 注意：这个询盘匹配到的最便宜款是钢化膜（到岸 $0.435），
    // 所以目标价必须低于 0.435 才会产生正缺口
    const next = applyOverrides(base, parseRevision("目标价改成 $0.2"));
    const ctx = buildQuoteContext(next);
    expect(ctx.targetGapUsd).toBeGreaterThan(0);
  });
});

describe("改价后的报价单", () => {
  const base = fallbackIntent(DRAFT);

  it("写明改了什么，并标注取代上一版", () => {
    const overrides = parseRevision("目标价改成 $0.95，改成 DDP");
    const next = applyOverrides(base, overrides);
    const doc = buildQuoteDocument(buildQuoteContext(next), {
      now: new Date("2026-09-28T00:00:00Z"),
      revision: {
        instruction: "目标价改成 $0.95，改成 DDP",
        changes: overrides.changes,
        sampleQty: overrides.sampleQty,
      },
    });
    expect(doc).toContain("REVISION NOTICE");
    expect(doc).toContain("supersedes the previous quotation");
    expect(doc).toContain("$0.95/pc");
    expect(doc).toContain("**Trade term:** DDP Ningbo, China");
    // 改价版本用带 -R1 的编号，避免和上一版混淆
    expect(doc).toMatch(/QTN-\d+-5000-R1/);
  });

  it("样品单写进条款，且不改动订单数量", () => {
    const overrides = parseRevision("先发 500 个样品单试单");
    const next = applyOverrides(base, overrides);
    const doc = buildQuoteDocument(buildQuoteContext(next), {
      revision: {
        instruction: "先发 500 个样品单试单",
        changes: overrides.changes,
        sampleQty: overrides.sampleQty,
      },
    });
    expect(doc).toMatch(/Trial order/i);
    expect(doc).toContain("500 pcs");
    expect(next.quantity).toBe(base.quantity);
  });

  it("目标价改到够不着时，差距说明仍然出现", () => {
    // 到岸成本最低 $0.435，目标价 $0.20 一定够不着
    const overrides = parseRevision("目标价改成 $0.2");
    const next = applyOverrides(base, overrides);
    const doc = buildQuoteDocument(buildQuoteContext(next), {
      revision: { instruction: "x", changes: overrides.changes },
    });
    expect(doc).toMatch(/Note on Your Target Price/);
    expect(doc).toMatch(/cannot match it/i);
  });

  it("客户可见部分仍然没有中文", () => {
    const overrides = parseRevision("目标价改成 $0.95，改成 DDP");
    const doc = buildQuoteDocument(
      buildQuoteContext(applyOverrides(base, overrides)),
      { revision: { instruction: "x", changes: overrides.changes } }
    );
    expect(clientFacingPart(doc)).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
