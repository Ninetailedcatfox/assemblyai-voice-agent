import { describe, expect, it } from "vitest";
import {
  buildQuoteContext,
  fallbackIntent,
  parseInquiry,
  quoteMessages,
  quoteRevisionMessages,
  summarizeContext,
  type InquiryIntent,
} from "./quote";
import { DEFAULT_ASSUMPTIONS } from "./products";

const baseIntent = (over: Partial<InquiryIntent> = {}): InquiryIntent => ({
  buyerMarket: "美国",
  buyerType: "亚马逊私标卖家",
  category: "IMD 图案壳",
  models: ["iPhone 16 Pro Max"],
  quantity: 5000,
  targetPriceUsd: null,
  timeline: "",
  incoterm: "FOB",
  needIpClearance: false,
  summary: "测试询盘",
  ...over,
});

describe("parseInquiry", () => {
  it("解析标准 JSON", () => {
    const intent = parseInquiry(
      JSON.stringify({
        buyerMarket: "阿联酋",
        buyerType: "批发商",
        category: "磁吸壳",
        models: ["iPhone 15"],
        quantity: 2000,
        targetPriceUsd: 1.2,
        timeline: "两周内",
        incoterm: "CIF",
        needIpClearance: false,
        summary: "迪拜批发商要磁吸壳",
      })
    );
    expect(intent?.buyerMarket).toBe("阿联酋");
    expect(intent?.quantity).toBe(2000);
    expect(intent?.incoterm).toBe("CIF");
    expect(intent?.targetPriceUsd).toBe(1.2);
  });

  it("容忍代码块围栏与前后缀文字", () => {
    const intent = parseInquiry(
      '好的，这是结果：\n```json\n{"buyerMarket":"美国","quantity":3000}\n```\n以上。'
    );
    expect(intent?.buyerMarket).toBe("美国");
    expect(intent?.quantity).toBe(3000);
  });

  it("字段缺失时给安全默认值", () => {
    const intent = parseInquiry('{"summary":"x"}');
    expect(intent?.quantity).toBe(1000);
    expect(intent?.models).toEqual(["universal"]);
    expect(intent?.incoterm).toBe("FOB");
    expect(intent?.targetPriceUsd).toBeNull();
  });

  it("非法 incoterm 回落到 FOB", () => {
    expect(parseInquiry('{"incoterm":"XYZ"}')?.incoterm).toBe("FOB");
  });

  it("完全不是 JSON 时返回 null（交给本地兜底）", () => {
    expect(parseInquiry("抱歉，我无法处理")).toBeNull();
    expect(parseInquiry("{}")).toBeNull();
  });
});

describe("fallbackIntent（无 LLM 时的本地规则解析）", () => {
  it("提取市场、数量、机型、目标价", () => {
    const intent = fallbackIntent(
      "美国亚马逊卖家要 5000 个 iPhone 16 Pro Max 的磁吸壳，目标价 $1.2"
    );
    expect(intent.buyerMarket).toBe("美国");
    expect(intent.quantity).toBe(5000);
    expect(intent.targetPriceUsd).toBe(1.2);
    expect(intent.models).toContain("iPhone 16 Pro Max");
  });

  it("支持「万」为单位", () => {
    expect(fallbackIntent("客户要 1 万个磁吸壳").quantity).toBe(10000);
    expect(fallbackIntent("要 2.5 万件").quantity).toBe(25000);
  });

  it("识别贸易术语与 IP 授权要求", () => {
    expect(fallbackIntent("要 DDP 报价，需要图案授权文件").incoterm).toBe("DDP");
    expect(fallbackIntent("要 DDP 报价，需要图案授权文件").needIpClearance).toBe(true);
    expect(fallbackIntent("报 CIF 价").incoterm).toBe("CIF");
  });

  it("识别中东 / 非洲市场", () => {
    expect(fallbackIntent("迪拜的批发商想拿货").buyerMarket).toBe("阿联酋");
    expect(fallbackIntent("尼日利亚客户要功能机壳").buyerMarket).toBe("非洲");
  });

  it("信息不足时不抛错，给可用默认值", () => {
    const intent = fallbackIntent("随便报个价");
    expect(intent.quantity).toBe(1000);
    expect(intent.models).toEqual(["universal"]);
    expect(intent.incoterm).toBe("FOB");
  });
});

describe("buildQuoteContext", () => {
  it("匹配到产品并算出到岸成本（FOB + 运费 + 关税）", () => {
    const ctx = buildQuoteContext(baseIntent());
    expect(ctx.lines.length).toBeGreaterThan(0);
    const line = ctx.lines[0];
    expect(line.cost.landedUnit).toBeCloseTo(
      line.cost.fobUnit + line.cost.freightUnit + line.cost.dutyUnit,
      10
    );
    expect(line.cost.landedUnit).toBeGreaterThan(line.cost.fobUnit);
  });

  it("目标价低于到岸成本时算出差距（差距 = 最优到岸成本 − 目标价）", () => {
    // 注意：5000 个时最优到岸成本约 $0.44/个（钢化膜），所以目标价要压到 0.05 才算真的做不到
    const ctx = buildQuoteContext(baseIntent({ targetPriceUsd: 0.05 }));
    const cheapest = Math.min(...ctx.lines.map((l) => l.cost.landedUnit));
    expect(ctx.targetGapUsd).not.toBeNull();
    expect(ctx.targetGapUsd!).toBeCloseTo(cheapest - 0.05, 10);
    expect(ctx.targetGapUsd!).toBeGreaterThan(0);
    expect(ctx.flags.some((f) => f.includes("低于最优到岸成本"))).toBe(true);
  });

  it("目标价其实能做到时，差距为负且不触发「做不到」提醒", () => {
    const ctx = buildQuoteContext(baseIntent({ targetPriceUsd: 5 }));
    expect(ctx.targetGapUsd!).toBeLessThan(0);
    expect(ctx.flags.some((f) => f.includes("低于最优到岸成本"))).toBe(false);
  });

  it("没有目标价时差距为 null", () => {
    expect(buildQuoteContext(baseIntent()).targetGapUsd).toBeNull();
  });

  it("永远带上「按体积重计费」的提醒", () => {
    const ctx = buildQuoteContext(baseIntent());
    expect(ctx.flags.some((f) => f.includes("体积重"))).toBe(true);
  });

  it("命中需授权的图案款时给出 IP 风险提醒", () => {
    const ctx = buildQuoteContext(
      baseIntent({ category: "热款 IP 快反壳", models: ["universal"] })
    );
    expect(ctx.lines.some((l) => l.sku.ipClearanceRequired)).toBe(true);
    expect(ctx.flags.some((f) => f.includes("授权链"))).toBe(true);
  });

  it("数量低于 MOQ 时给出提醒", () => {
    const ctx = buildQuoteContext(baseIntent({ quantity: 50 }));
    expect(ctx.flags.some((f) => f.includes("起订量"))).toBe(true);
  });

  it("含锂电池产品给出空运限制提醒", () => {
    const ctx = buildQuoteContext(
      baseIntent({ category: "磁吸充电宝", models: ["universal"] })
    );
    expect(ctx.lines.some((l) => l.sku.category === "power-bank")).toBe(true);
    expect(ctx.flags.some((f) => f.includes("UN38.3"))).toBe(true);
  });

  it("换空运假设会显著抬高运费", () => {
    const sea = buildQuoteContext(baseIntent(), DEFAULT_ASSUMPTIONS);
    const air = buildQuoteContext(baseIntent(), {
      freightMode: "air",
      freightRate: 27,
      dutyRate: 0.176,
    });
    expect(air.lines[0].cost.freightUnit).toBeGreaterThan(
      sea.lines[0].cost.freightUnit * 5
    );
  });
});

describe("quoteMessages", () => {
  it("system prompt 里写死「价格只能取自产品库」与体积重口径", () => {
    const ctx = buildQuoteContext(baseIntent());
    const [system] = quoteMessages(ctx);
    expect(system.content).toContain("只用下面【产品库】里给出的价格");
    expect(system.content).toContain("体积重");
    expect(system.content).toContain("HS 4202.32");
    // 产品库资料块必须注入（价格来源）
    expect(system.content).toContain("id: ");
    expect(system.content).toContain("到岸测算");
  });

  it("user prompt 带上结构化询盘信息", () => {
    const ctx = buildQuoteContext(baseIntent({ targetPriceUsd: 1.1 }));
    const [, user] = quoteMessages(ctx);
    // 市场名必须给英文：给中文国名的话，模型会把"美国"原样抄进英文报价单
    expect(user.content).toContain("United States");
    expect(user.content).not.toContain("市场：美国");
    expect(user.content).toContain("iPhone 16 Pro Max");
    expect(user.content).toContain("5000");
    expect(user.content).toContain("$1.1");
  });

  it("市场名映射不到时写「未指明」，不把中文漏给模型", () => {
    const ctx = buildQuoteContext(baseIntent({ buyerMarket: "火星" }));
    const [, user] = quoteMessages(ctx);
    expect(user.content).toContain("市场：未指明");
  });

  it("禁止中文输出（买家是海外客户）", () => {
    const [system] = quoteMessages(buildQuoteContext(baseIntent()));
    expect(system.content).toContain("不要输出任何中文");
  });
});

describe("quoteRevisionMessages（口头改价）", () => {
  it("带上当前报价单、修改指令与产品库", () => {
    const ctx = buildQuoteContext(baseIntent());
    const msgs = quoteRevisionMessages("QUOTE BODY", "把单价降到 $1.0", ctx);
    expect(msgs[1].content).toContain("QUOTE BODY");
    expect(msgs[1].content).toContain("把单价降到 $1.0");
    expect(msgs[0].content).toContain("id: ");
    // 低到成本以下时必须指出差距，不许假装能降
    expect(msgs[0].content).toContain("必须指出差距");
  });
});

describe("summarizeContext", () => {
  it("输出前端可渲染的字段，且不含 prompt 大文本", () => {
    const s = summarizeContext(buildQuoteContext(baseIntent()));
    expect(s.lines.length).toBeGreaterThan(0);
    expect(s.lines[0]).toHaveProperty("landedUnit");
    expect(s.lines[0]).toHaveProperty("volumetricKg");
    expect(JSON.stringify(s)).not.toContain("【产品库");
    expect(s.flags.length).toBeGreaterThan(0);
  });
});
