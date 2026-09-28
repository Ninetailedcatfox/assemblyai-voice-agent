"use client";

import { useCallback, useEffect, useRef } from "react";
import AppShell from "@/components/AppShell";
import { AGENT_SPECTRUM_BANDS } from "@/lib/agentAudio";
import { useVoiceAgent } from "@/lib/useVoiceAgent";

const usd = (n: number, digits = 3) => `$${n.toFixed(digits)}`;

const EXAMPLES: { who: string; text: string }[] = [
  {
    who: "🇺🇸 亚马逊私标卖家",
    text: "美国一个亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 1.1 美元，希望两周内到美仓，问能不能做",
  },
  {
    who: "🇦🇪 迪拜批发商",
    text: "迪拜的批发商问磁吸壳，要 1 万个，报 CIF 价，说之前从别家拿的是 1.3 美元",
  },
  {
    who: "🇩🇪 德国品牌方",
    text: "德国客户要 3000 个透明壳，走 DDP，问能不能提供授权链",
  },
];

interface IntentLike {
  buyerMarket?: string;
  buyerType?: string;
  category?: string;
  models?: string[];
  quantity?: number;
  targetPriceUsd?: number | null;
  incoterm?: string;
  timeline?: string;
}

/** 从 CSS 令牌里取色，保证画布颜色跟着主题走（而不是硬编码一套 hex） */
function readVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export default function AgentPage() {
  const a = useVoiceAgent();
  const scrollRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { levelsRef, active, ready, speaking } = a;

  // 新消息进来自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [a.turns.length, a.userInterim, a.agentStream]);

  /**
   * 一帧循环干两件事：把实测电平写进 orb 的 CSS 变量（用 ref 改样式，
   * 不走 React 状态，60fps 也不触发重渲染），以及把真实频谱画到 canvas。
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    let raf = 0;
    let frame = 0;
    let colors = { mic: "#4f46e5", agent: "#059669", line: "#e5e7eb" };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const lv = levelsRef.current;
      const orb = orbRef.current;
      if (orb) {
        orb.style.setProperty("--mic", lv.mic.toFixed(3));
        orb.style.setProperty("--agent", lv.agent.toFixed(3));
      }
      if (!canvas || !ctx) return;

      const host = canvas.parentElement ?? canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.round(canvas.clientWidth * dpr);
      const ch = Math.round(canvas.clientHeight * dpr);
      if (cw === 0 || ch === 0) return;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      // 主题色每秒重读一次就够，避免每帧 getComputedStyle
      if (frame++ % 60 === 0) {
        colors = {
          mic: readVar(host, "--accent", "#4f46e5"),
          agent: readVar(host, "--ok", "#059669"),
          line: readVar(host, "--line", "#e5e7eb"),
        };
      }

      ctx.clearRect(0, 0, cw, ch);
      const n = AGENT_SPECTRUM_BANDS;
      const gap = Math.max(1, Math.round(2 * dpr));
      const bw = (cw - gap * (n - 1)) / n;
      const mid = ch / 2;
      const maxH = mid - 3 * dpr;

      // 中线
      ctx.fillStyle = colors.line;
      ctx.fillRect(0, Math.round(mid), cw, Math.max(1, Math.round(dpr * 0.5)));

      for (let i = 0; i < n; i++) {
        const x = i * (bw + gap);
        const av = lv.agentBands[i] / 255;
        const mv = lv.micBands[i] / 255;
        // agent 向上（绿），用户麦克风向下（紫）—— 谁在说一眼可辨。
        // 静音时完全不画柱子：给每根柱子留 1px 最小高度的话，空闲状态会变成
        // 一排断断续续的虚线，看着像渲染坏了。
        const ah = av * maxH;
        const mh = mv * maxH;
        if (ah > 0.5) {
          ctx.fillStyle = colors.agent;
          ctx.fillRect(x, mid - ah, bw, ah);
        }
        if (mh > 0.5) {
          ctx.fillStyle = colors.mic;
          ctx.fillRect(x, mid, bw, mh);
        }
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef]);

  const copyQuote = async () => {
    try {
      await navigator.clipboard.writeText(a.quote);
    } catch {
      /* 剪贴板不可用，忽略 */
    }
  };

  const downloadQuote = () => {
    const blob = new Blob([a.quote], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `quotation-${new Date().toISOString().slice(0, 10)}.txt`;
    el.click();
    URL.revokeObjectURL(url);
  };

  const toggle = useCallback(() => {
    if (a.active) a.stop();
    else a.start();
  }, [a]);

  const intent = (a.analysis?.intent ?? {}) as IntentLike;
  const hasTool = a.toolLog.length > 0;

  const state: { label: string; tone: "idle" | "busy" | "ok" } = !a.active
    ? { label: "未连接", tone: "idle" }
    : speaking
    ? { label: "正在说话", tone: "ok" }
    : ready
    ? { label: "正在聆听", tone: "ok" }
    : { label: "正在连接", tone: "busy" };

  const orbTint =
    state.tone === "idle"
      ? "var(--surface)"
      : speaking
      ? "color-mix(in srgb, var(--ok) 16%, var(--surface))"
      : "color-mix(in srgb, var(--accent) 14%, var(--surface))";

  return (
    <AppShell
      wide
      title="语音报价 Agent"
      subtitle="口述买家询盘 → agent 自己听、自己调工具、自己说回结果。价格全部由本地确定性引擎计算，语言模型不被允许编造任何数字。"
      status={
        <>
          <span
            className="flex items-center gap-1.5 text-xs text-muted"
            title={a.error ?? "AssemblyAI Voice Agent 会话状态"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state.tone === "ok"
                  ? "bg-ok"
                  : state.tone === "busy"
                  ? "animate-pulse bg-warn"
                  : "bg-faint"
              }`}
            />
            {state.label}
          </span>
          <button
            onClick={toggle}
            disabled={!a.supported}
            className={a.active ? "btn" : "btn-primary"}
            style={a.active ? undefined : { background: "var(--accent)" }}
          >
            {a.active ? "结束会话" : "开始通话"}
          </button>
        </>
      }
    >
      {/* 整页按视口高度排布，只有"通话记录"和"报价单"内部滚动 ——
          否则底部会留下大片空白，看起来像没做完。 */}
      <div className="flex h-[calc(100vh-9.5rem)] min-h-[36rem] flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* ───────────────── 左：通话台 ───────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="card shrink-0 overflow-hidden">
            <div className="flex flex-col items-center gap-3 px-5 py-6">
              {/* 语音 orb：尺寸由实测电平驱动 */}
              <div
                ref={orbRef}
                className="relative grid h-32 w-32 place-items-center"
                style={{ ["--mic" as string]: "0", ["--agent" as string]: "0" }}
              >
                {active && ready && (
                  <>
                    <span
                      className="orb-ring absolute h-24 w-24 rounded-full"
                      style={{ border: "1px solid var(--accent)", opacity: 0.5 }}
                    />
                    <span
                      className="orb-ring absolute h-24 w-24 rounded-full"
                      style={{ border: "1px solid var(--accent)", animationDelay: "0.7s" }}
                    />
                  </>
                )}
                <button
                  onClick={toggle}
                  disabled={!a.supported}
                  aria-label={a.active ? "结束会话" : "开始会话"}
                  className="relative grid h-24 w-24 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: orbTint,
                    border: `1px solid ${
                      state.tone === "idle" ? "var(--line-strong)" : "var(--accent)"
                    }`,
                    boxShadow: "var(--shadow-lift)",
                    transform:
                      "scale(calc(1 + var(--mic) * 0.13 + var(--agent) * 0.09))",
                  }}
                >
                  {a.active ? (
                    <span
                      className="block h-6 w-6 rounded-[4px] bg-danger"
                      aria-hidden
                    />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-9 w-9"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.7"
                      aria-hidden
                    >
                      <rect x="9" y="2.5" width="6" height="11" rx="3" />
                      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" strokeLinecap="round" />
                      <path d="M12 18v3" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>

              {/* 真实频谱：上=agent 语音，下=用户麦克风 */}
              <canvas
                ref={canvasRef}
                className="h-14 w-full max-w-md"
                aria-label="实时语音频谱"
              />

              <p className="text-center text-xs leading-relaxed text-muted">
                {!a.supported
                  ? "当前浏览器不支持 AudioWorklet / getUserMedia，请用 Chrome 或 Edge。"
                  : a.active
                  ? "直接说话即可；中途插话会打断它（barge-in），打断后已排期的语音会被真正掐掉。"
                  : "点麦克风开始。说一段买家询盘，agent 会先解析询盘、再算到岸成本、最后念出报价要点。"}
              </p>

              {a.error && (
                <p className="alert-danger w-full px-3 py-2 text-[11px] leading-relaxed">
                  {a.error}
                </p>
              )}
            </div>

            {/* 链路信息：把"谁在干什么"摊开，这是它真在跑的凭据 */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft px-4 py-2.5">
              <span className="chip">听 · AssemblyAI Universal-3 Pro</span>
              <span className="chip">想 · 托管 LLM + 工具调用</span>
              <span className="chip">说 · 24kHz PCM16 下行</span>
              {a.agentId && (
                <span className="chip" title={a.agentId}>
                  agent {a.agentId.slice(0, 8)}…
                </span>
              )}
              <span className="chip">数字 · 本地确定性引擎</span>
            </div>
          </div>

          {/* 通话记录 */}
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-3 py-2">
              <span className="panel-title">通话记录</span>
              {a.turns.length > 0 && (
                <span className="chip">{a.turns.length} 条</span>
              )}
            </div>

            <div
              ref={scrollRef}
              className="thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3"
            >
              {a.turns.length === 0 && !a.userInterim && !a.agentStream && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                  <p className="text-xs text-muted">试试这样说：</p>
                  <div className="flex w-full max-w-md flex-col gap-2">
                    {EXAMPLES.map((ex) => (
                      <div
                        key={ex.who}
                        className="card-flat px-3 py-2 text-left"
                      >
                        <span className="block text-[10px] font-semibold text-accent">
                          {ex.who}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                          {ex.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {a.turns.map((t, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    t.role === "user"
                      ? "self-end text-white"
                      : "self-start border border-line-soft bg-surface-2 text-ink-2"
                  }`}
                  style={t.role === "user" ? { background: "var(--accent)" } : undefined}
                >
                  {t.text}
                </div>
              ))}

              {a.userInterim && (
                <div
                  className="max-w-[85%] self-end rounded-xl px-3 py-2 text-xs italic leading-relaxed text-white opacity-70"
                  style={{ background: "var(--accent)" }}
                >
                  {a.userInterim}
                </div>
              )}

              {a.agentStream && (
                <div className="max-w-[85%] self-start rounded-xl border border-line-soft bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
                  {a.agentStream}
                  <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent align-middle" />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ───────────────── 右：证据链 ───────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* 流水线状态：三段都是实时推导，不是写死的文案 */}
          <div className="card shrink-0 px-3 py-2.5">
            <span className="panel-title">执行链路</span>
            <ol className="mt-2 grid grid-cols-3 gap-2">
              {[
                {
                  k: "1",
                  t: "听清询盘",
                  d: "AssemblyAI 流式转写",
                  on: ready,
                },
                {
                  k: "2",
                  t: "调工具算价",
                  d: "analyze_inquiry → 到岸成本",
                  on: hasTool,
                },
                {
                  k: "3",
                  t: "出英文报价单",
                  d: "generate_quotation → 确定性生成",
                  on: !!a.quote,
                },
              ].map((s) => (
                <li key={s.k} className="card-flat px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: s.on ? "var(--ok)" : "var(--faint)" }}
                    >
                      {s.on ? "✓" : s.k}
                    </span>
                    <span className="truncate text-[11px] font-medium text-ink">{s.t}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-muted">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* 工具调用日志 —— "agent 真的在调引擎"的直接证据 */}
          <div className="card shrink-0 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="panel-title">Agent 的工具调用</span>
              {hasTool && <span className="chip chip-ok">{a.toolLog.length} 次</span>}
            </div>
            {hasTool ? (
              <ul className="mt-2 space-y-1.5">
                {a.toolLog.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        t.status === "running"
                          ? "animate-pulse bg-accent"
                          : t.status === "ok"
                          ? "bg-ok"
                          : "bg-danger"
                      }`}
                    />
                    <span className="shrink-0 font-mono text-ink-2">{t.name}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {t.summary ?? JSON.stringify(t.args).slice(0, 60)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                还没调用过。agent 会自己决定何时调 <span className="font-mono">analyze_inquiry</span>{" "}
                和 <span className="font-mono">generate_quotation</span>。
              </p>
            )}
          </div>

          {a.analysis && (
            <div className="card thin-scroll max-h-[19rem] shrink-0 overflow-auto px-3 py-2.5">
              <span className="panel-title">询盘解析 · 到岸成本</span>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-muted">市场</dt>
                <dd className="text-ink-2">{intent.buyerMarket ?? "—"}</dd>
                <dt className="text-muted">买家类型</dt>
                <dd className="text-ink-2">{intent.buyerType ?? "—"}</dd>
                <dt className="text-muted">机型</dt>
                <dd className="truncate text-ink-2">
                  {intent.models?.length ? intent.models.join(", ") : "—"}
                </dd>
                <dt className="text-muted">数量</dt>
                <dd className="text-ink-2">
                  {typeof intent.quantity === "number"
                    ? `${intent.quantity.toLocaleString()} 个`
                    : "—"}
                </dd>
                <dt className="text-muted">目标价</dt>
                <dd className="text-ink-2">
                  {typeof intent.targetPriceUsd === "number"
                    ? `$${intent.targetPriceUsd}`
                    : "未提及"}
                </dd>
                <dt className="text-muted">贸易术语</dt>
                <dd className="text-ink-2">{intent.incoterm ?? "—"}</dd>
              </dl>

              <div className="mt-2.5 space-y-1.5">
                {a.analysis.lines.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-2 px-2 py-1.5"
                  >
                    <span className="min-w-0 truncate text-[11px] text-ink-2">{l.nameZh}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-ink">
                      {usd(l.landedUnit)}/个
                    </span>
                  </div>
                ))}
              </div>

              {typeof a.analysis.targetGapUsd === "number" && a.analysis.targetGapUsd > 0 && (
                <p className="alert-warn mt-2 px-2 py-1.5 text-[11px] leading-relaxed">
                  客户目标价低于最优到岸成本 {usd(a.analysis.targetGapUsd)}/个 —— 报价里必须客观说明
                </p>
              )}

              {a.analysis.flags.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.analysis.flags.map((f, i) => (
                    <li key={i} className="text-[11px] leading-snug text-warn">
                      · {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {a.quote ? (
            <div className="card flex min-h-[13rem] min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2">
                <span className="panel-title">English Quotation</span>
                <div className="flex items-center gap-1.5">
                  <span className={`chip ${a.quoteSource === "ai" ? "chip-accent" : "chip-ok"}`}>
                    {a.quoteSource === "ai" ? "LLM 起草" : "本地确定性生成"}
                  </span>
                  <button onClick={copyQuote} className="btn">
                    复制
                  </button>
                  <button onClick={downloadQuote} className="btn">
                    下载 .txt
                  </button>
                </div>
              </div>
              <pre className="doc-pre thin-scroll min-h-0 flex-1 overflow-auto px-3 py-3">
                {a.quote}
              </pre>
            </div>
          ) : (
            <div className="card flex min-h-[13rem] min-w-0 flex-1 flex-col items-center justify-center gap-2 border-dashed px-6 py-8 text-center">
              <span className="text-xs text-muted">报价单会出现在这里</span>
              <p className="max-w-sm text-[11px] leading-relaxed text-faint">
                价格全部来自本地引擎 —— 16 个手机配件 SKU 的出厂价 / 运费 / 体积重 / 关税口径。
                agent 只负责把结果念出来，不被允许编造任何数字。
              </p>
            </div>
          )}
        </section>
      </div>
      </div>
    </AppShell>
  );
}
