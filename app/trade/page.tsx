"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { useTranscription } from "@/lib/useTranscription";

interface QuoteLineSummary {
  id: string;
  nameZh: string;
  nameEn: string;
  models: string[];
  qty: number;
  fobUnit: number;
  freightUnit: number;
  dutyUnit: number;
  landedUnit: number;
  goodsValue: number;
  cbm: number;
  volumetricKg: number;
  belowMoq: boolean;
  moq: number;
  sampleDays: number;
  productionDays: number;
  ipClearanceRequired: boolean;
}

interface Intent {
  buyerMarket: string;
  buyerType: string;
  category: string;
  models: string[];
  quantity: number;
  targetPriceUsd: number | null;
  timeline: string;
  incoterm: string;
  needIpClearance: boolean;
  summary: string;
}

interface Analysis {
  source: "rules" | "ai";
  warning?: string;
  intent: Intent;
  flags: string[];
  targetGapUsd: number | null;
  /** 缺口是跟哪一行比出来的（同类最优），用于把提示写清楚 */
  targetBaseline: { id: string; nameZh: string; landedUnit: number } | null;
  assumptions: { freightMode: "sea" | "air"; freightRate: number; dutyRate: number };
  lines: QuoteLineSummary[];
}

/** 报价单是谁产出的：ai = LLM 起草；generated = 本地确定性生成；unchanged = 改价失败原样退回 */
type QuoteSource = "" | "ai" | "generated" | "unchanged";

type StageKey = "analyze" | "match" | "cost" | "draft";
type StageStatus = "pending" | "running" | "done" | "error";

const STAGE_LABELS: Record<StageKey, string> = {
  analyze: "解析询盘",
  match: "匹配产品库",
  cost: "测算到岸成本",
  draft: "生成英文报价单",
};
const STAGE_ORDER: StageKey[] = ["analyze", "match", "cost", "draft"];

const pendingStages = (): Record<StageKey, StageStatus> => ({
  analyze: "pending",
  match: "pending",
  cost: "pending",
  draft: "pending",
});

const EXAMPLES = [
  {
    label: "🇺🇸 美国私标卖家",
    text: "美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1，希望两周内能到美仓，问能不能做",
  },
  {
    label: "🇦🇪 迪拜批发商",
    text: "迪拜 Deira 的批发商问磁吸壳，要 1 万个，报 CIF 价，说之前从别家拿的是 $1.3",
  },
  {
    label: "🇳🇬 尼日利亚进口商",
    text: "尼日利亚客户要 2 万个功能机壳，问能不能便宜点，主要卖诺基亚那种机器",
  },
];

async function pipeStream(res: Response, onChunk: (chunk: string) => void) {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

const usd = (n: number, digits = 3) => `$${n.toFixed(digits)}`;

export default function TradePage() {
  const [draft, setDraft] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [quote, setQuote] = useState("");
  const [stages, setStages] = useState<Record<StageKey, StageStatus>>(pendingStages);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [quoteSource, setQuoteSource] = useState<QuoteSource>("");
  const [quoteNote, setQuoteNote] = useState("");

  const { engine, aai, speech } = useTranscription("zh-CN");
  const prevTranscript = useRef("");

  useEffect(() => {
    if (!speech.listening) {
      prevTranscript.current = "";
      return;
    }
    const added = speech.transcript.slice(prevTranscript.current.length);
    if (added) setDraft((d) => d + added);
    prevTranscript.current = speech.transcript;
  }, [speech.transcript, speech.listening]);

  const setStage = (key: StageKey, status: StageStatus) =>
    setStages((s) => ({ ...s, [key]: status }));

  const reset = () => {
    setAnalysis(null);
    setQuote("");
    setError("");
    setQuoteSource("");
    setQuoteNote("");
    setStages(pendingStages());
  };

  /** 从响应头读报价单来源与告警（服务端在降级时会说明原因） */
  const readQuoteMeta = (res: Response) => {
    const src = res.headers.get("X-Quote-Source");
    setQuoteSource(src === "ai" || src === "generated" || src === "unchanged" ? src : "");
    const warn = res.headers.get("X-Quote-Warning");
    setQuoteNote(warn ? decodeURIComponent(warn) : "");
  };

  const run = async () => {
    if (!draft.trim() || busy) return;
    reset();
    setBusy(true);
    try {
      // 阶段 1：解析询盘 + 匹配产品 + 测算成本（后端一次算完）
      setStage("analyze", "running");
      const res = await fetch("/api/quote/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const data = (await res.json()) as Analysis & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "询盘解析失败");
      setStage("analyze", "done");
      setStage("match", "done");
      setStage("cost", "done");
      setAnalysis(data);

      // 阶段 2：流式生成英文报价单
      setStage("draft", "running");
      const quoteRes = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, intent: data.intent }),
      });
      if (!quoteRes.ok) {
        const d = (await quoteRes.json()) as { error?: string };
        throw new Error(d.error ?? "报价单生成失败");
      }
      readQuoteMeta(quoteRes);
      setStage("draft", "done");
      await pipeStream(quoteRes, (chunk) => setQuote((q) => q + chunk));
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
      setStages((s) => {
        const next = { ...s };
        for (const k of STAGE_ORDER) if (next[k] === "running") next[k] = "error";
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  /** 口头改价：把当前报价单 + 修改指令发回去，流式覆盖 */
  const revise = async () => {
    if (!instruction.trim() || !quote || revising) return;
    setRevising(true);
    setError("");
    const previous = quote;
    setQuote("");
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          intent: analysis?.intent,
          currentQuote: previous,
          instruction,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "改价失败");
      }
      readQuoteMeta(res);
      setInstruction("");
      await pipeStream(res, (chunk) => setQuote((q) => q + chunk));
    } catch (err) {
      setQuote(previous); // 失败就还原，别把原报价弄丢
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setRevising(false);
    }
  };

  const copyQuote = async () => {
    try {
      await navigator.clipboard.writeText(quote);
    } catch {
      /* 剪贴板不可用，忽略 */
    }
  };

  const startVoice = () => {
    prevTranscript.current = "";
    speech.start();
  };
  const stopVoice = () => {
    if (speech.interim) setDraft((d) => d + speech.interim);
    speech.stop();
  };

  return (
    <AppShell
      title="外贸询盘 → 英文报价单"
      subtitle="口述海外买家询盘 → 匹配手机配件产品库 → 测算到岸成本 → 生成可直接发出的英文报价单"
      status={
        <span
          className={`chip ${engine === "aai" ? "chip-ok" : "chip-warn"}`}
          title={aai.error ?? "未配置 ASSEMBLYAI_API_KEY，已降级为浏览器语音转写"}
        >
          {engine === "aai" ? "🎙 AssemblyAI 实时转写" : "🎙 浏览器语音转写（降级）"}
        </span>
      }
    >
      <div className="flex h-[calc(100vh-9.5rem)] min-h-[36rem] flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：询盘输入 */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              口述询盘（中文）
            </label>
            {!draft && !speech.listening && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => setDraft(ex.text)}
                    className="rounded-full border border-dashed border-line-strong bg-surface px-2.5 py-1 text-xs text-accent hover:bg-accent-soft"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {speech.listening && (
            <div className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-danger">
              <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
              聆听中…{speech.interim && <span>{speech.interim}</span>}
            </div>
          )}

          <textarea
            value={speech.listening ? draft + speech.interim : draft}
            readOnly={speech.listening}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例如：美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1，两周内到美仓…"
            className="thin-scroll max-h-80 min-h-32 flex-1 resize-none rounded-xl border border-line-strong bg-surface p-4 text-sm leading-relaxed shadow-sm outline-none focus:border-accent"
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={run}
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "处理中…" : "解析并报价"}
            </button>
            {speech.listening ? (
              <button
                onClick={stopVoice}
                className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2"
              >
                停止录音
              </button>
            ) : (
              <button
                onClick={startVoice}
                disabled={!speech.supported || busy}
                className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                🎤 语音输入
              </button>
            )}
            <button
              onClick={reset}
              className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2"
            >
              清空
            </button>
          </div>

          {/* 时间线 */}
          <ol className="mt-1 space-y-1.5">
            {STAGE_ORDER.map((k) => (
              <li key={k} className="flex items-center gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    stages[k] === "done"
                      ? "bg-ok"
                      : stages[k] === "running"
                      ? "animate-pulse bg-accent"
                      : stages[k] === "error"
                      ? "bg-danger"
                      : "bg-line-strong"
                  }`}
                />
                <span className={stages[k] === "pending" ? "text-faint" : "text-ink-2"}>
                  {STAGE_LABELS[k]}
                </span>
              </li>
            ))}
          </ol>

          {error && (
            <div className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </section>

        {/* 右：分析结果 + 报价单 */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          {analysis && (
            <>
              <div className="card shrink-0 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    询盘解析
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      analysis.source === "ai"
                        ? "bg-ok-soft text-ok"
                        : "bg-surface-2 text-muted"
                    }`}
                    title="默认走确定性规则解析（毫秒级、不会幻觉）；传 refine 才启用 LLM 语义解析"
                  >
                    {analysis.source === "ai" ? "LLM 语义解析" : "规则解析 · 确定性"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">市场</dt>
                  <dd className="text-ink-2">{analysis.intent.buyerMarket}</dd>
                  <dt className="text-muted">买家类型</dt>
                  <dd className="text-ink-2">{analysis.intent.buyerType}</dd>
                  <dt className="text-muted">机型</dt>
                  <dd className="text-ink-2">{analysis.intent.models.join(", ")}</dd>
                  <dt className="text-muted">数量</dt>
                  <dd className="text-ink-2">
                    {analysis.intent.quantity.toLocaleString()} 个
                  </dd>
                  <dt className="text-muted">目标价</dt>
                  <dd className="text-ink-2">
                    {analysis.intent.targetPriceUsd !== null
                      ? `$${analysis.intent.targetPriceUsd}`
                      : "未提及"}
                  </dd>
                  <dt className="text-muted">贸易术语</dt>
                  <dd className="text-ink-2">{analysis.intent.incoterm}</dd>
                </dl>
                {analysis.warning && (
                  <p className="mt-2 text-[11px] text-warn">{analysis.warning}</p>
                )}
              </div>

              <div className="card thin-scroll max-h-[19rem] shrink-0 overflow-auto p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  匹配产品 · 到岸成本拆解
                </span>
                <div className="mt-2 space-y-2">
                  {analysis.lines.map((l) => (
                    <div key={l.id} className="rounded-lg border border-line-soft bg-surface-2 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-ink-2">{l.nameZh}</span>
                        <span className="whitespace-nowrap text-xs font-semibold text-ink">
                          {usd(l.landedUnit)}/个
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted">
                        <span>FOB {usd(l.fobUnit)}</span>
                        <span>运费 {usd(l.freightUnit)}</span>
                        <span>关税 {usd(l.dutyUnit)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
                        <span>货值 {usd(l.goodsValue, 0)}</span>
                        <span>体积 {l.cbm.toFixed(2)} cbm</span>
                        <span title="空运按体积重计费，不是实重">
                          体积重 {l.volumetricKg.toFixed(1)} kg
                        </span>
                        <span>
                          MOQ {l.moq} · 打样 {l.sampleDays} 天 / 量产 {l.productionDays} 天
                        </span>
                      </div>
                      {(l.belowMoq || l.ipClearanceRequired) && (
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
                          {l.belowMoq && (
                            <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">
                              低于 MOQ
                            </span>
                          )}
                          {l.ipClearanceRequired && (
                            <span className="rounded bg-danger-soft px-1.5 py-0.5 text-danger">
                              需 IP 授权链
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {analysis.targetGapUsd !== null && analysis.targetGapUsd > 0 && (
                  <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1.5 text-[11px] text-warn">
                    客户目标价低于
                    {analysis.targetBaseline ? `「${analysis.targetBaseline.nameZh}」` : "同类"}最优到岸成本{" "}
                    {usd(analysis.targetGapUsd)}/个 —— 报价里必须客观说明
                  </p>
                )}
              </div>

              {analysis.flags.length > 0 && (
                <div className="shrink-0 rounded-xl border border-warn-line bg-warn-soft/60 p-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-warn">
                    风险提醒
                  </span>
                  <ul className="mt-1.5 space-y-1">
                    {analysis.flags.map((f, i) => (
                      <li key={i} className="text-[11px] leading-snug text-warn">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {(quote || revising) && (
            <div className="card flex min-h-[13rem] min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  English Quotation
                </span>
                <div className="flex items-center gap-2">
                  {quoteSource && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        quoteSource === "ai"
                          ? "bg-ok-soft text-ok"
                          : quoteSource === "unchanged"
                          ? "bg-warn-soft text-warn"
                          : "bg-surface-2 text-muted"
                      }`}
                    >
                      {quoteSource === "ai"
                        ? "LLM 起草"
                        : quoteSource === "unchanged"
                        ? "未改动"
                        : "本地生成"}
                    </span>
                  )}
                  <button
                    onClick={copyQuote}
                    className="rounded border border-line-strong px-2 py-1 text-[11px] text-muted hover:bg-surface-2"
                  >
                    复制
                  </button>
                </div>
              </div>
              {quoteNote && (
                <p className="border-b border-line-soft bg-warn-soft/60 px-3 py-1.5 text-[11px] text-warn">
                  {quoteNote}
                </p>
              )}
              <pre className="doc-pre thin-scroll min-h-0 flex-1 overflow-auto px-3 py-3">
                {quote || "生成中…"}
              </pre>
              <div className="border-t border-line-soft p-2">
                <div className="flex gap-2">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void revise();
                    }}
                    placeholder="口头改价 / 改交期，例如：单价降到 $1.0，改成 DDP"
                    className="flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-xs outline-none focus:border-accent"
                  />
                  <button
                    onClick={revise}
                    disabled={revising || !instruction.trim()}
                    className="rounded-lg bg-ink px-3 py-1.5 text-xs text-white hover:bg-ink-2 disabled:opacity-50"
                  >
                    {revising ? "改价中…" : "改价"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!analysis && !quote && (
            <div className="flex min-h-[13rem] min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-6 text-center text-xs text-faint">
              <span>左侧口述一段买家询盘，点「解析并报价」。</span>
              <span>产品库 16 个 SKU，价格口径取自华强北真实出厂价 / FOB / 体积重 / 关税。</span>
            </div>
          )}
        </section>
      </div>
      </div>
    </AppShell>
  );
}
