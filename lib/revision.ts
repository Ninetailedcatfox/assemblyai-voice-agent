import type { InquiryIntent } from "./quote";

/**
 * 口头改价指令 → 结构化覆盖项。
 *
 * 为什么不让 LLM 干这件事：改价指令本质是结构化的（数量 / 目标价 / 贸易术语 /
 * 交期），而实测 LLM 中转的 TTFB 在 5s~54s 之间随机跳，改价又要重出整份报价单，
 * 一条"把单价降到 $1.0"等 40 秒的语音交互是不可用的。规则解析是毫秒级，
 * 而且**改价改的是钱，确定性比措辞优美重要得多**。
 *
 * 需要语义理解（规则覆盖不到的怪指令）时，仍可走 LLM 路径。
 */

const INCOTERMS = ["DDP", "CIF", "EXW", "FOB"] as const;

export interface RevisionOverrides {
  quantity?: number;
  targetPriceUsd?: number;
  incoterm?: InquiryIntent["incoterm"];
  /** 样品/试单数量 —— 不等于订单数量，只作条款说明 */
  sampleQty?: number;
  /** 人话说明改了什么，直接渲染进报价单 */
  changes: string[];
  /** 完全没识别出任何可执行改动 */
  unrecognised: boolean;
}

/** 样品单信号词：出现这些词时，指令里的数字是打样数量，不是订单数量 */
const SAMPLE_HINT = /样品|打样|试单|试样|sample|trial/i;

export function parseRevision(instruction: string): RevisionOverrides {
  const t = instruction.trim();
  const changes: string[] = [];
  const out: RevisionOverrides = { changes, unrecognised: false };

  const isSample = SAMPLE_HINT.test(t);

  // ── 数量：5000 个 / 1 万个 / 5,000 pcs ────────────────────────────────
  const wan = t.match(/(\d+(?:\.\d+)?)\s*万\s*(?:个|件|pcs|pieces)?/i);
  const plain = t.match(/(\d[\d,]{2,})\s*(?:个|件|pcs|pieces)/i);
  let qty: number | undefined;
  if (wan) qty = Math.round(parseFloat(wan[1]) * 10000);
  else if (plain) qty = parseInt(plain[1].replace(/,/g, ""), 10);

  if (qty !== undefined && Number.isFinite(qty) && qty > 0) {
    if (isSample) {
      out.sampleQty = qty;
      changes.push(
        `Buyer requested a ${qty.toLocaleString("en-US")} pcs trial/sample order — quoted as a separate sample line, order quantity unchanged.`
      );
    } else {
      out.quantity = qty;
      changes.push(`Order quantity updated to ${qty.toLocaleString("en-US")} pcs.`);
    }
  }

  // ── 目标价：$1.0 / 1.0 美元 / 降到 1 块 ───────────────────────────────
  const price =
    t.match(/\$\s*(\d+(?:\.\d+)?)/) ?? t.match(/(\d+(?:\.\d+)?)\s*(?:美元|美金|usd|块)/i);
  if (price) {
    const p = parseFloat(price[1]);
    if (Number.isFinite(p) && p > 0) {
      out.targetPriceUsd = p;
      changes.push(`Buyer's target price updated to $${p.toFixed(2)}/pc.`);
    }
  }

  // ── 贸易术语：DDP / CIF / EXW / FOB ──────────────────────────────────
  for (const term of INCOTERMS) {
    if (new RegExp(`\\b${term}\\b`, "i").test(t)) {
      out.incoterm = term;
      changes.push(`Trade term changed to ${term}.`);
      break;
    }
  }

  if (changes.length === 0) out.unrecognised = true;
  return out;
}

/** 把覆盖项套到原意图上，得到新的意图（不修改入参） */
export function applyOverrides(
  intent: InquiryIntent,
  o: RevisionOverrides
): InquiryIntent {
  return {
    ...intent,
    quantity: o.quantity ?? intent.quantity,
    targetPriceUsd:
      o.targetPriceUsd !== undefined ? o.targetPriceUsd : intent.targetPriceUsd,
    incoterm: o.incoterm ?? intent.incoterm,
    summary: intent.summary
      ? `${intent.summary}（改价后：数量 ${o.quantity ?? intent.quantity}，目标价 ${
          o.targetPriceUsd ?? intent.targetPriceUsd ?? "未提及"
        }，术语 ${o.incoterm ?? intent.incoterm}）`
      : intent.summary,
  };
}
