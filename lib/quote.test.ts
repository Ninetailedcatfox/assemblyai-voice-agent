import { describe, expect, it } from "vitest";
import {
  buildQuoteContext,
  fallbackIntent,
  parseCnNumber,
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

/**
 * 中文数字解析。
 *
 * 这组用例是回归防线：语音链路转写出来的就是中文数字，旧实现只认阿拉伯数字，
 * 导致线上报价单把客户口述的"五千个"写成 1,000 pcs、"一点一美元"直接丢失。
 */
describe("parseCnNumber（中文数字）", () => {
  it("基本单位", () => {
    expect(parseCnNumber("五")).toBe(5);
    expect(parseCnNumber("十五")).toBe(15);
    expect(parseCnNumber("五十")).toBe(50);
    expect(parseCnNumber("五千")).toBe(5000);
    expect(parseCnNumber("五百")).toBe(500);
  });

  it("万 / 亿", () => {
    expect(parseCnNumber("一万")).toBe(10000);
    expect(parseCnNumber("两万")).toBe(20000);
    expect(parseCnNumber("两万五")).toBe(25000);
    expect(parseCnNumber("一万二千")).toBe(12000);
    expect(parseCnNumber("一亿")).toBe(100000000);
  });

  it("口语省略单位：一千五 = 1500、两千三 = 2300", () => {
    expect(parseCnNumber("一千五")).toBe(1500);
    expect(parseCnNumber("两千三")).toBe(2300);
    expect(parseCnNumber("一万五")).toBe(15000);
  });

  it("小数（「点」）", () => {
    expect(parseCnNumber("一点一")).toBeCloseTo(1.1, 10);
    expect(parseCnNumber("零点九五")).toBeCloseTo(0.95, 10);
    expect(parseCnNumber("二点五")).toBeCloseTo(2.5, 10);
  });

  it("混入非数字字符时返回 NaN，不瞎猜", () => {
    expect(Number.isNaN(parseCnNumber("五千个"))).toBe(true);
    expect(Number.isNaN(parseCnNumber("abc"))).toBe(true);
    expect(Number.isNaN(parseCnNumber(""))).toBe(true);
  });
});

describe("fallbackIntent 认中文数字（语音转写的真实形态）", () => {
  it("口述询盘：五千个 + 一点一美元", () => {
    const intent = fallbackIntent(
      "美国一个亚马逊私标卖家，要五千个 iPhone 16 Pro Max 的 IMD 图案壳，" +
        "目标价一点一美元，希望两周内能到美仓，问能不能做。"
    );
    // "美国一个" 里的 "一个" 不能被当成数量
    expect(intent.quantity).toBe(5000);
    expect(intent.targetPriceUsd).toBeCloseTo(1.1, 10);
    expect(intent.buyerMarket).toBe("美国");
  });

  it("中文「万」与小数价", () => {
    expect(fallbackIntent("要两万个磁吸壳").quantity).toBe(20000);
    expect(fallbackIntent("客户给零点九五美元").targetPriceUsd).toBeCloseTo(0.95, 10);
  });

  it("阿拉伯数字的老路径没被破坏", () => {
    expect(fallbackIntent("要 5000 个磁吸壳").quantity).toBe(5000);
    expect(fallbackIntent("目标价 $1.2").targetPriceUsd).toBe(1.2);
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

  it("目标价低于到岸成本时算出差距（差距 = 同类最优到岸成本 − 目标价）", () => {
    const ctx = buildQuoteContext(baseIntent({ targetPriceUsd: 0.05 }));
    expect(ctx.targetBaseline).not.toBeNull();
    // 基准必须是"客户要的那类"（IMD 图案壳），不是报价单里最便宜的那张配件
    const pool = ctx.lines.filter((l) => l.sku.category === ctx.lines[0].sku.category);
    const sameSpec = Math.min(...pool.map((l) => l.cost.landedUnit));
    expect(ctx.targetGapUsd).not.toBeNull();
    expect(ctx.targetGapUsd!).toBeCloseTo(sameSpec - 0.05, 10);
    expect(ctx.targetGapUsd!).toBeGreaterThan(0);
    expect(ctx.flags.some((f) => f.includes("低于同类最优到岸成本"))).toBe(true);
  });

  it("报价单里混进便宜配件，不能把「目标价够不着」这条提醒抹掉", () => {
    // 实测踩过：给 IMD 图案壳的询盘里混进一张 $0.435 的钢化膜，
    // 缺口从正数变成负数，整段提醒消失 —— 而客户要的那款差得远。
    // 旧实现拿"全局最低"当基准，于是要靠 $0.05 这种荒唐目标价才能触发提醒。
    const spoken =
      "美国一个亚马逊私标卖家，要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，" +
      "目标价 $1.1，希望两周内能到美仓。";
    const ctx = buildQuoteContext(fallbackIntent(spoken));
    const globalCheapest = Math.min(...ctx.lines.map((l) => l.cost.landedUnit));
    expect(globalCheapest).toBeLessThan(1.1); // 确实有比目标价还便宜的配件混进来
    expect(ctx.targetBaseline!.sku.id).toBe("imd-ip16pm"); // 但基准必须是客户要的那款
    expect(ctx.targetGapUsd!).toBeGreaterThan(0); // 缺口仍为正 → 提醒照常出现
    expect(ctx.flags.some((f) => f.includes("目标价"))).toBe(true);
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

describe("机型匹配 —— 口述转写的失真形态（线上实测踩过）", () => {
  it("中文数字机型 iPhone十六Pro Max 能匹配到产品库机型", () => {
    const intent = fallbackIntent("美国私标卖家要五千个iPhone十六Pro Max的IMD图案壳");
    expect(intent.models).toContain("iPhone 16 Pro Max");
    expect(intent.models).not.toEqual(["universal"]);
  });

  it("没有空格的机型 iPhone16Pro Max 也能匹配", () => {
    const intent = fallbackIntent("要 5000 个 iPhone16Pro Max 的磁吸壳");
    expect(intent.models).toContain("iPhone 16 Pro Max");
  });

  it("整句 STT 原话：机型/数量/目标价/IP 一次全中", () => {
    const spoken =
      "美国一个亚马逊私标卖家。 到五千个iPhone十六Pro Max的IM图案壳。 " +
      "目标价一点一美元。 希望两周内能到美仓。 能不能做？";
    const intent = fallbackIntent(spoken);
    expect(intent.models).toContain("iPhone 16 Pro Max");
    expect(intent.quantity).toBe(5000);
    expect(intent.targetPriceUsd).toBe(1.1);
    expect(intent.needIpClearance).toBe(true);
  });

  it("机型匹配失败会让报价单丢掉 IP 条款 —— 用这条守住不回归", () => {
    const spoken =
      "美国一个亚马逊私标卖家。 到五千个iPhone十六Pro Max的IM图案壳。 目标价一点一美元。";
    const ctx = buildQuoteContext(fallbackIntent(spoken));
    expect(ctx.lines.some((l) => l.sku.ipClearanceRequired)).toBe(true);
    // 报的必须真是 IMD 图案壳，不是"反正都是壳"
    expect(ctx.lines[0].sku.id).toBe("imd-ip16pm");
  });

  it("目标价够不着时缺口为正（$1.1 对 5000 个 IMD 壳）", () => {
    const spoken =
      "美国一个亚马逊私标卖家。 到五千个iPhone十六Pro Max的IM图案壳。 目标价一点一美元。";
    const ctx = buildQuoteContext(fallbackIntent(spoken));
    expect(ctx.targetGapUsd).not.toBeNull();
    expect(ctx.targetGapUsd!).toBeGreaterThan(0);
  });
});
