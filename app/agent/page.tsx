"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useVoiceAgent } from "@/lib/useVoiceAgent";

const usd = (n: number, digits = 3) => `$${n.toFixed(digits)}`;

export default function AgentPage() {
  const a = useVoiceAgent();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息进来自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [a.turns.length, a.userInterim, a.agentStream]);

  const copyQuote = async () => {
    try {
      await navigator.clipboard.writeText(a.quote);
    } catch {
      /* 剪贴板不可用，忽略 */
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">语音报价 Agent</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            说话即报价 —— AssemblyAI Voice Agent 负责听和说，报价数字由本地确定性引擎算
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${a.active ? "text-emerald-600" : "text-zinc-400"}`}
            title={a.error ?? "AssemblyAI Voice Agent 会话状态"}
          >
            {a.active ? (a.ready ? "🎧 会话进行中" : "⏳ 连接中") : "🎧 未连接"}
          </span>
          <Link
            href="/trade"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            文字模式
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            写作工作台
          </Link>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：通话 + 工具日志 */}
        <section className="flex flex-col gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              {a.active ? (
                <button
                  onClick={a.stop}
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-red-600 text-xl text-white shadow-sm hover:bg-red-500"
                  aria-label="结束会话"
                >
                  ■
                </button>
              ) : (
                <button
                  onClick={a.start}
                  disabled={!a.supported}
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xl text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="开始会话"
                >
                  🎙
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm text-zinc-800">
                  {a.active && a.ready && (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        a.speaking ? "animate-pulse bg-emerald-500" : "bg-indigo-500"
                      }`}
                    />
                  )}
                  <span className="truncate">{a.status}</span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {a.active
                    ? "直接说话即可，中途插话会打断它（barge-in）"
                    : "点麦克风开始。说一段买家询盘，例如「美国亚马逊私标卖家要 5000 个 iPhone 16 Pro Max 的 IMD 图案壳，目标价 $1.1」"}
                </p>
              </div>
            </div>
            {!a.supported && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                当前浏览器不支持 AudioWorklet / getUserMedia，请用 Chrome 或 Edge。
              </p>
            )}
            {a.error && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {a.error}
              </p>
            )}
          </div>

          {/* 对话记录 */}
          <div
            ref={scrollRef}
            className="flex min-h-64 flex-1 flex-col gap-2 overflow-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"
          >
            {a.turns.length === 0 && !a.userInterim && !a.agentStream && (
              <div className="flex flex-1 items-center justify-center text-center text-xs text-zinc-400">
                通话记录会出现在这里
              </div>
            )}
            {a.turns.map((t, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  t.role === "user"
                    ? "self-end bg-indigo-600 text-white"
                    : "self-start bg-zinc-100 text-zinc-800"
                }`}
              >
                {t.text}
              </div>
            ))}
            {a.userInterim && (
              <div className="max-w-[85%] self-end rounded-xl bg-indigo-300 px-3 py-2 text-xs italic leading-relaxed text-white">
                {a.userInterim}
              </div>
            )}
            {a.agentStream && (
              <div className="max-w-[85%] self-start rounded-xl bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-500">
                {a.agentStream}
              </div>
            )}
          </div>

          {/* 工具调用日志 —— 这是"agent 真的在调引擎"的证据 */}
          {a.toolLog.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Agent 调用的工具
              </span>
              <ul className="mt-2 space-y-1.5">
                {a.toolLog.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        t.status === "running"
                          ? "animate-pulse bg-indigo-500"
                          : t.status === "ok"
                          ? "bg-emerald-500"
                          : "bg-red-500"
                      }`}
                    />
                    <span className="font-mono text-zinc-700">{t.name}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500">
                      {t.summary ?? JSON.stringify(t.args).slice(0, 60)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* 右：分析 + 报价单 */}
        <section className="flex flex-col gap-3">
          {a.analysis && (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                询盘解析 · 到岸成本
              </span>
              <div className="mt-2 space-y-1.5">
                {a.analysis.lines.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-2 py-1.5"
                  >
                    <span className="truncate text-xs text-zinc-800">{l.nameZh}</span>
                    <span className="ml-2 whitespace-nowrap text-xs font-semibold text-zinc-900">
                      {usd(l.landedUnit)}/个
                    </span>
                  </div>
                ))}
              </div>
              {a.analysis.flags.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-lg bg-amber-50/60 p-2">
                  {a.analysis.flags.map((f, i) => (
                    <li key={i} className="text-[11px] leading-snug text-amber-900">
                      · {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {a.quote ? (
            <div className="flex flex-1 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  English Quotation
                </span>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                    {a.quoteSource === "ai" ? "LLM 起草" : "本地确定性生成"}
                  </span>
                  <button
                    onClick={copyQuote}
                    className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
                  >
                    复制
                  </button>
                </div>
              </div>
              <pre className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-zinc-800">
                {a.quote}
              </pre>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-400">
              说一段买家询盘，agent 会先调 <span className="mx-1 font-mono">analyze_inquiry</span>{" "}
              匹配产品库、算到岸成本，再调{" "}
              <span className="mx-1 font-mono">generate_quotation</span> 出英文报价单。
              <br />
              价格全部来自本地引擎，agent 不被允许编造任何数字。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
