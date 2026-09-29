import { describe, expect, it } from "vitest";
import { CN_NUM_CHARS, compactForMatch, normalizeCnDigits, parseCnNumber } from "./cnNumber";

describe("parseCnNumber", () => {
  it("基本单位与省略写法", () => {
    expect(parseCnNumber("五")).toBe(5);
    expect(parseCnNumber("十")).toBe(10);
    expect(parseCnNumber("十五")).toBe(15); // 十前面省略了"一"
    expect(parseCnNumber("二十")).toBe(20);
    expect(parseCnNumber("一百零八")).toBe(108);
  });

  it("千/万/亿 进位", () => {
    expect(parseCnNumber("五千")).toBe(5000);
    expect(parseCnNumber("一万")).toBe(10000);
    expect(parseCnNumber("两万")).toBe(20000); // 口语用"两"
    expect(parseCnNumber("十二万五千")).toBe(125000);
  });

  it("末尾省略单位的写法（报价里很常见）", () => {
    expect(parseCnNumber("一千五")).toBe(1500);
    expect(parseCnNumber("两千三")).toBe(2300);
    expect(parseCnNumber("一万五")).toBe(15000);
  });

  it("小数点", () => {
    expect(parseCnNumber("一点一")).toBeCloseTo(1.1, 10);
    expect(parseCnNumber("零点九五")).toBeCloseTo(0.95, 10);
    expect(parseCnNumber("三点零五")).toBeCloseTo(3.05, 10);
  });

  it("解析不了就返回 NaN，不猜", () => {
    expect(parseCnNumber("")).toBeNaN();
    expect(parseCnNumber("abc")).toBeNaN();
    expect(parseCnNumber("五a")).toBeNaN();
    expect(parseCnNumber("一点x")).toBeNaN();
  });
});

describe("normalizeCnDigits", () => {
  it("把中文数字串换成阿拉伯数字", () => {
    expect(normalizeCnDigits("iPhone十六Pro Max")).toBe("iPhone16Pro Max");
    expect(normalizeCnDigits("要五千个")).toBe("要5000个");
    expect(normalizeCnDigits("iPhone十五Pro")).toBe("iPhone15Pro");
  });

  it("一句 STT 原话里多处同时生效", () => {
    const spoken = "到五千个iPhone十六Pro Max的IM图案壳。目标价一点一美元。";
    expect(normalizeCnDigits(spoken)).toBe(
      "到5000个iPhone16Pro Max的IM图案壳。目标价1.1美元。"
    );
  });

  it("不动非数字字符（图案壳里的字不在数字表里）", () => {
    expect(normalizeCnDigits("IMD图案壳")).toBe("IMD图案壳");
    expect(normalizeCnDigits("FOB宁波")).toBe("FOB宁波");
  });

  it("超大数不换（避免把量词串换脏）", () => {
    // "两万"=20000 ≥ 10000，超出阈值就原样留着，宁可不换
    expect(normalizeCnDigits("两万个")).toBe("两万个");
  });
});

describe("compactForMatch", () => {
  it("压掉空格/连字符/下划线/间隔号并转小写", () => {
    expect(compactForMatch("iPhone 16 Pro Max")).toBe("iphone16promax");
    expect(compactForMatch("iPhone16Pro Max")).toBe("iphone16promax");
    expect(compactForMatch("Galaxy-S24_Ultra")).toBe("galaxys24ultra");
    expect(compactForMatch("IMD 图案壳 · iPhone 16")).toBe("imd图案壳iphone16");
  });

  it("两种写法压完相等 —— 这是机型匹配能成立的前提", () => {
    expect(compactForMatch(normalizeCnDigits("iPhone十六Pro Max"))).toBe(
      compactForMatch("iPhone 16 Pro Max")
    );
  });
});

describe("CN_NUM_CHARS", () => {
  it("含口语写法两，且不含任何非数字汉字", () => {
    expect(CN_NUM_CHARS).toContain("两");
    expect(CN_NUM_CHARS).not.toContain("图");
    expect(CN_NUM_CHARS).not.toContain("个");
  });
});
