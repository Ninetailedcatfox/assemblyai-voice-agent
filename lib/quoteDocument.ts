import {
  AIR_VOLUMETRIC_DIVISOR,
  DEFAULT_ASSUMPTIONS,
  type QuoteAssumptions,
} from "@/lib/products";
import { marketNameEn } from "@/lib/marketNames";
import type { QuoteContext } from "@/lib/quote";

/**
 * 确定性英文报价单生成器。
 *
 * 为什么需要它：这条链路上的 LLM 是第三方中转，实测会静默替换后端模型
 * （要 gemini-3.6-flash 给 gemini-3.5-flash-lite），延迟在 5s~54s 之间随机，
 * 约 1/6 请求返回上游 geo 错误，且输出会被截断。报价单是 demo 的核心产物，
 * 不能押在这条链路上。
 *
 * 因此：LLM 产出合格就用 LLM 的（措辞更自然），不合格/超时/报错就回退到这里。
 * 本函数是纯函数 —— 所有价格、体积重、关税都来自 `buildQuoteContext` 已经算好的
 * 数字，不重新计算、不做任何猜测，因此永远不会出现"模型编造单价"。
 */

const usd = (n: number, digits = 3) =>
  `$${n.toFixed(digits)}`;

/** 报价单有效期（天） */
const VALIDITY_DAYS = 30;

export interface QuoteDocumentOptions {
  /** 注入当前时间以便测试；默认取系统时间 */
  now?: Date;
  assumptions?: QuoteAssumptions;
  /** 改价场景：把"改了什么"明确写进报价单，避免买卖双方各记一版 */
  revision?: {
    instruction: string;
    changes: string[];
    sampleQty?: number;
  };
}

export function buildQuoteDocument(
  ctx: QuoteContext,
  options: QuoteDocumentOptions = {}
): string {
  const now = options.now ?? new Date();
  const a = options.assumptions ?? ctx.assumptions ?? DEFAULT_ASSUMPTIONS;
  const { intent, lines, flags, targetGapUsd } = ctx;

  const date = now.toISOString().slice(0, 10);
  const validUntil = new Date(now.getTime() + VALIDITY_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);
  const ref = `QTN-${date.replace(/-/g, "")}-${String(intent.quantity).slice(0, 5)}${
    options.revision ? "-R1" : ""
  }`;

  const out: string[] = [];
  let sec = 0;
  /** 二级标题编号自增 */
  const nextSection = (title: string) => {
    sec += 1;
    out.push(`## ${sec}. ${title}`);
  };

  // ── 抬头 ──────────────────────────────────────────────────────────────
  out.push("# QUOTATION");
  out.push("");
  out.push(`**Ref:** ${ref}  `);
  out.push(`**Date:** ${date}  `);
  out.push(`**Valid until:** ${validUntil} (${VALIDITY_DAYS} days)  `);
  const marketEn = marketNameEn(intent.buyerMarket);
  if (marketEn) out.push(`**Buyer market:** ${marketEn}  `);
  out.push(`**Trade term:** ${intent.incoterm} Ningbo, China`);
  out.push("");

  // ── 改价说明（只在这份是改价版本时出现）──────────────────────────────
  if (options.revision && options.revision.changes.length > 0) {
    out.push(
      `> **REVISION NOTICE — ${date}.** This supersedes the previous quotation of the same reference.`
    );
    for (const c of options.revision.changes) out.push(`> - ${c}`);
    out.push(">");
    out.push(
      "> All other terms remain unchanged. Prices shown below already reflect the revision."
    );
    out.push("");
  }

  // ── 1. 产品与价格 ─────────────────────────────────────────────────────
  nextSection("Product & Pricing");
  out.push("");
  out.push("| Item | Fits | Qty | Unit Price (FOB) | Subtotal |");
  out.push("|---|---|---:|---:|---:|");
  for (const l of lines) {
    out.push(
      `| ${l.sku.nameEn} | ${l.sku.models.join(" / ")} | ${l.qty.toLocaleString(
        "en-US"
      )} pcs | ${usd(l.cost.fobUnit)} | ${usd(l.cost.goodsValue, 2)} |`
    );
  }
  out.push("");
  out.push(
    `*Unit prices are FOB Ningbo and already reflect the volume tier for ${intent.quantity.toLocaleString(
      "en-US"
    )} pcs.*`
  );
  out.push("");

  // ── 2. 订单条款 ───────────────────────────────────────────────────────
  nextSection("Order Terms");
  out.push("");
  for (const l of lines) {
    out.push(
      `- **${l.sku.nameEn}** — MOQ ${l.sku.moq.toLocaleString("en-US")} pcs` +
        ` · sampling ${l.sku.sampleDays} days` +
        ` · production ${l.sku.productionDays} days after artwork & deposit confirmed`
    );
  }
  out.push(
    "- **Payment:** 30% T/T deposit with order, 70% before shipment. " +
      "We do not offer credit terms, consignment, or advance funding."
  );
  out.push(
    "- **Artwork:** print-ready files must be supplied by the buyer; a pre-production sample is required before mass production."
  );
  if (options.revision?.sampleQty) {
    out.push(
      `- **Trial order:** ${options.revision.sampleQty.toLocaleString(
        "en-US"
      )} pcs can ship as a separate trial shipment. Sample unit price and freight differ from the volume pricing below and will be confirmed separately.`
    );
  }
  out.push("");

  // ── 3. 运费与体积重 ───────────────────────────────────────────────────
  nextSection("Freight & Volumetric Weight");
  out.push("");
  out.push(
    "Phone cases are **light-bulky cargo**. Freight is charged on **volumetric weight**, " +
      `not actual weight (1 cbm ≈ ${AIR_VOLUMETRIC_DIVISOR} kg).`
  );
  out.push("");
  out.push("| Item | Carton volume | Volumetric weight | Freight per pc |");
  out.push("|---|---:|---:|---:|");
  for (const l of lines) {
    out.push(
      `| ${l.sku.nameEn} | ${l.cost.cbm.toFixed(2)} cbm | ${l.cost.volumetricKg.toFixed(
        1
      )} kg | ${usd(l.cost.freightUnit)} |`
    );
  }
  out.push("");
  out.push(
    `Freight basis: ${
      a.freightMode === "sea" ? "sea freight" : "air freight (volumetric weight)"
    } at ${a.freightRate} ${a.freightMode === "sea" ? "USD/cbm" : "USD/kg"}, ` +
      "subject to carrier confirmation at time of booking."
  );
  out.push("");

  // ── 4. 关税 ───────────────────────────────────────────────────────────
  nextSection("Duty (US)");
  out.push("");
  out.push(
    `Estimated at **${(a.dutyRate * 100).toFixed(1)}%** on CIF value under **HS 4202.32**.`
  );
  out.push("");
  out.push(
    "> **Section 301 additional tariffs are not included and change frequently.** " +
      "The applicable rate must be re-verified at the time of order. Duty is payable by the importer of record."
  );
  out.push("");

  // ── 5. 到岸成本参考 ───────────────────────────────────────────────────
  nextSection("Landed Cost Reference");
  out.push("");
  out.push("For your own margin planning (FOB + freight + duty, excl. local clearance):");
  out.push("");
  out.push("| Item | FOB | Freight | Duty | Est. Landed |");
  out.push("|---|---:|---:|---:|---:|");
  for (const l of lines) {
    out.push(
      `| ${l.sku.nameEn} | ${usd(l.cost.fobUnit)} | ${usd(l.cost.freightUnit)} | ${usd(
        l.cost.dutyUnit
      )} | ${usd(l.cost.landedUnit)} |`
    );
  }
  out.push("");

  // ── 6. 目标价说明（仅当客户目标价够不着时）────────────────────────────
  if (targetGapUsd !== null && targetGapUsd > 0) {
    const cheapest = lines.reduce((x, y) =>
      x.cost.landedUnit <= y.cost.landedUnit ? x : y
    );
    nextSection("Note on Your Target Price");
    out.push("");
    out.push(
      `Your target of ${usd(intent.targetPriceUsd!, 2)}/pc is below our best landed cost of ` +
        `${usd(cheapest.cost.landedUnit)}/pc — a gap of **${usd(targetGapUsd)}/pc**. ` +
        "We cannot match it without changing one of the following:"
    );
    out.push("");
    out.push(
      `1. **Specification** — move to a simpler construction (e.g. non-magnetic TPU/PC or a thinner print layer).`
    );
    out.push(
      `2. **Volume** — consolidate with other items to improve the freight tier; volume drives our pricing more than anything else in this category.`
    );
    out.push(
      `3. **Freight mode** — sea freight is already assumed; the only remaining lever is consolidating shipments.`
    );
    out.push("");
    out.push(
      "We would rather tell you this now than quote a number we cannot hold."
    );
    out.push("");
  }

  // ── 7. 知识产权 ───────────────────────────────────────────────────────
  const needsIp = lines.some((l) => l.sku.ipClearanceRequired);
  if (needsIp) {
    nextSection("IP & Artwork Clearance");
    out.push("");
    out.push(
      "One or more items above are printed-goods. **A valid authorisation chain is required before we can quote or produce them:**"
    );
    out.push("");
    out.push("- written licence or brand authorisation covering the artwork");
    out.push("- trademark / copyright registration details");
    out.push(
      "- confirmation that the design is not an unlicensed cartoon, film, sports, or brand asset"
    );
    out.push("");
    out.push(
      "We cannot accept unlicensed artwork. Unauthorised print is the single most common cause of seizure and damages claims in this category."
    );
    out.push("");
  }

  // ── 收尾 ──────────────────────────────────────────────────────────────
  nextSection("Next Steps");
  out.push("");
  out.push("1. Confirm the model breakdown (e.g. the mix across iPhone 16 / 16 Pro / 16 Pro Max).");
  out.push("2. Confirm artwork files, or request a neutral design from us.");
  out.push("3. Approve the pre-production sample.");
  out.push("4. We re-verify freight and the current Section 301 rate, then issue the final order confirmation.");
  out.push("");
  out.push("Prices are indicative pending factory confirmation and are valid for the period stated above.");
  out.push("");

  // ── 内部附注：只给用户看，明确标注不要转发 ────────────────────────────
  out.push("---");
  out.push("");
  out.push(INTERNAL_NOTES_MARKER);
  out.push("");
  for (const f of flags) out.push(`- ${f}`);
  if (targetGapUsd !== null && targetGapUsd <= 0) {
    out.push(
      `- Target price ${usd(intent.targetPriceUsd!, 2)}/pc is achievable; headroom vs. best landed cost is ${usd(
        Math.abs(targetGapUsd)
      )}/pc.`
    );
  }
  out.push(
    `- Freight basis: ${
      a.freightMode === "sea" ? "sea" : "air"
    } @ ${a.freightRate} ${a.freightMode === "sea" ? "USD/cbm" : "USD/kg"}; duty ${(
      a.dutyRate * 100
    ).toFixed(1)}%. Re-verify both before sending.`
  );

  return out.join("\n");
}

/** 内部附注的分节标记：此标记之后的内容不发给客户 */
export const INTERNAL_NOTES_MARKER = "## Internal Notes — do not forward";

/**
 * 取出真正会转发给买家的部分（去掉内部附注）。
 *
 * 判定"这份报价单能不能用"必须只看客户能看到的内容 —— 内部附注本来就是中文写的，
 * 不剥掉的话会把我们自己生成的合格报价单一并判死。
 */
export function clientFacingPart(text: string): string {
  const i = text.indexOf(INTERNAL_NOTES_MARKER);
  const head = i === -1 ? text : text.slice(0, i);
  return head.replace(/\n+---\s*$/, "").trim();
}

export interface QuoteAssessment {
  ok: boolean;
  reason?: string;
}

/** 判定 LLM 产出的报价单是否可用；不合格就回退到确定性生成 */
export function assessQuoteText(text: string, incoterm: string): QuoteAssessment {
  const t = clientFacingPart(text.trim());
  if (!t) return { ok: false, reason: "空输出" };
  // 报价单是直接转发给海外买家的，出现中文即判不合格（实测模型会把中文国名抄进去）
  if (/[\u4e00-\u9fff]/.test(t)) return { ok: false, reason: "输出含中文" };
  if (t.length < 600) return { ok: false, reason: `输出过短（${t.length} 字符）` };

  // 必须含价格，且必须提到贸易术语
  if (!/\$\s?\d/.test(t)) return { ok: false, reason: "未包含任何单价" };
  if (!t.toUpperCase().includes(incoterm.toUpperCase())) {
    return { ok: false, reason: `未包含贸易术语 ${incoterm}` };
  }

  // 关键条款至少命中 2 项，否则不是一份完整报价单
  const required = [
    /MOQ/i,
    /lead\s*time|sampling|sample/i,
    /volumetric/i,
    /duty|tariff/i,
    /licen[cs]e|authoris|authoriz|trademark/i,
  ];
  const hits = required.filter((re) => re.test(t)).length;
  if (hits < 2) return { ok: false, reason: `缺少关键条款（命中 ${hits}/5）` };

  // 结尾必须像结束，而不是被截断在半个单词上
  if (!/[.!?)\]|`*]\s*$/.test(t)) {
    return { ok: false, reason: "结尾被截断" };
  }

  return { ok: true };
}
