"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  source: "ai" | "fallback";
  warning?: string;
  intent: Intent;
  flags: string[];
  targetGapUsd: number | null;
  assumptions: { freightMode: "sea" | "air"; freightRate: number; dutyRate: number };
  lines: QuoteLineSummary[];
}

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
    setStages(pendingStages());
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
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">外贸询盘 → 英文报价单</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            口述海外买家询盘 → 匹配手机配件产品库 → 测算到岸成本 → 生成可直接发出的英文报价单
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${
              engine === "aai" ? "text-emerald-600" : "text-zinc-400"
            }`}
            title={aai.error ?? "未配置 ASSEMBLYAI_API_KEY，已降级"}
          >
            {engine === "aai" ? "🎙 AssemblyAI 实时转写" : "🎙 浏览器语音转写（降级）"}
          </span>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            写作工作台
          </Link>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：询盘输入 */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              口述询盘（中文）
            </label>
            {!draft && !speech.listening && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => setDraft(ex.text)}
                    className="rounded-full border border-dashed border-indigo-300 bg-white px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {speech.listening && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              聆听中…{speech.interim && <span>{speech.interim}</span>}
            </div>
          )}

          <textarea
            value={speech.listening ? draft + speech.interim : draft}
            readOnly={speech.listening}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例如：美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1，两周内到美仓…"
            className="min-h-40 flex-1 resize-none rounded-xl border border-zinc-300 bg-white p-4 text-sm leading-relaxed shadow-sm outline-none focus:border-indigo-400"
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={run}
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "处理中…" : "解析并报价"}
            </button>
            {speech.listening ? (
              <button
                onClick={stopVoice}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
              >
                停止录音
              </button>
            ) : (
              <button
                onClick={startVoice}
                disabled={!speech.supported || busy}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                🎤 语音输入
              </button>
            )}
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
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
                      ? "bg-emerald-500"
                      : stages[k] === "running"
                      ? "animate-pulse bg-indigo-500"
                      : stages[k] === "error"
                      ? "bg-red-500"
                      : "bg-zinc-300"
                  }`}
                />
                <span className={stages[k] === "pending" ? "text-zinc-400" : "text-zinc-700"}>
                  {STAGE_LABELS[k]}
                </span>
              </li>
            ))}
          </ol>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </section>

        {/* 右：分析结果 + 报价单 */}
        <section className="flex flex-col gap-3">
          {analysis && (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    询盘解析
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      analysis.source === "ai"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {analysis.source === "ai" ? "LLM 解析" : "本地规则兜底"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-zinc-500">市场</dt>
                  <dd className="text-zinc-800">{analysis.intent.buyerMarket}</dd>
                  <dt className="text-zinc-500">买家类型</dt>
                  <dd className="text-zinc-800">{analysis.intent.buyerType}</dd>
                  <dt className="text-zinc-500">机型</dt>
                  <dd className="text-zinc-800">{analysis.intent.models.join(", ")}</dd>
                  <dt className="text-zinc-500">数量</dt>
                  <dd className="text-zinc-800">
                    {analysis.intent.quantity.toLocaleString()} 个
                  </dd>
                  <dt className="text-zinc-500">目标价</dt>
                  <dd className="text-zinc-800">
                    {analysis.intent.targetPriceUsd !== null
                      ? `$${analysis.intent.targetPriceUsd}`
                      : "未提及"}
                  </dd>
                  <dt className="text-zinc-500">贸易术语</dt>
                  <dd className="text-zinc-800">{analysis.intent.incoterm}</dd>
                </dl>
                {analysis.warning && (
                  <p className="mt-2 text-[11px] text-amber-700">{analysis.warning}</p>
                )}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  匹配产品 · 到岸成本拆解
                </span>
                <div className="mt-2 space-y-2">
                  {analysis.lines.map((l) => (
                    <div key={l.id} className="rounded-lg border border-zinc-100 bg-zinc-50 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-800">{l.nameZh}</span>
                        <span className="whitespace-nowrap text-xs font-semibold text-zinc-900">
                          {usd(l.landedUnit)}/个
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-zinc-500">
                        <span>FOB {usd(l.fobUnit)}</span>
                        <span>运费 {usd(l.freightUnit)}</span>
                        <span>关税 {usd(l.dutyUnit)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
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
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                              低于 MOQ
                            </span>
                          )}
                          {l.ipClearanceRequired && (
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                              需 IP 授权链
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {analysis.targetGapUsd !== null && analysis.targetGapUsd > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                    客户目标价低于最优到岸成本 {usd(analysis.targetGapUsd)}/个 —— 报价里必须客观说明
                  </p>
                )}
              </div>

              {analysis.flags.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    风险提醒
                  </span>
                  <ul className="mt-1.5 space-y-1">
                    {analysis.flags.map((f, i) => (
                      <li key={i} className="text-[11px] leading-snug text-amber-900">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {(quote || revising) && (
            <div className="flex flex-1 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  English Quotation
                </span>
                <button
                  onClick={copyQuote}
                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
                >
                  复制
                </button>
              </div>
              <pre className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-zinc-800">
                {quote || "生成中…"}
              </pre>
              <div className="border-t border-zinc-100 p-2">
                <div className="flex gap-2">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void revise();
                    }}
                    placeholder="口头改价 / 改交期，例如：单价降到 $1.0，改成 DDP"
                    className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs outline-none focus:border-indigo-400"
                  />
                  <button
                    onClick={revise}
                    disabled={revising || !instruction.trim()}
                    className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {revising ? "改价中…" : "改价"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!analysis && !quote && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-400">
              左侧口述一段买家询盘，点「解析并报价」。
              <br />
              产品库 16 个 SKU，价格口径取自华强北真实出厂价 / FOB / 体积重 / 关税。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
