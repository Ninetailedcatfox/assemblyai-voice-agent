import Link from "next/link";
import AppShell from "@/components/AppShell";

/**
 * 站点首页 = 语音 Agent 的介绍页。
 *
 * 之前的 `/` 是「AI 写作工作台」（另一个项目搬过来的），评委点开根域名看到的
 * 是一个和本次提交无关的中文写作工具 —— 首页必须讲清楚这个项目是什么。
 * 写作工作台挪到了 /studio，导航里仍然可达。
 *
 * 页面上的数字全部来自线上实测（`_bench_live.py` / `_e2e_prod.py` 的输出），
 * 不是估的。改这里之前先重跑那两个脚本。
 */

const MEASURED = [
  { k: "0.58 s", v: "session.ready", d: "建连耗时" },
  { k: "336 ms", v: "greeting TTFA", d: "首字音频延迟" },
  { k: "2 / 2", v: "tool calls", d: "成功且无超时" },
  { k: "4,241", v: "client-facing chars", d: "客户可见报价单，0 个中文字符" },
  { k: "981 ms", v: "POST /api/quote/analyze", d: "线上中位耗时" },
  { k: "1,130 ms", v: "POST /api/quote", d: "线上中位耗时" },
  { k: "176", v: "unit tests", d: "16 个文件全绿" },
  { k: "53.6 s", v: "session", d: "含 greeting 与收尾的整段会话" },
];

const FLOW = [
  {
    n: "01",
    t: "说",
    h: "口述询盘",
    d: "中文说一句：卖家是谁、要什么机型、多少量、目标价、什么时候要到。不用整理成表格。",
  },
  {
    n: "02",
    t: "算",
    h: "确定性引擎算价",
    d: "匹配产品目录 → 工厂价 → 体积重运费 → 关税 → 到岸成本 → 与目标价的差额。全程纯函数，不经过模型。",
  },
  {
    n: "03",
    t: "报",
    h: "口播 + 出单",
    d: "先语音把结论和风险讲回来，屏幕上同时落一份可以直接转发给海外买家的英文报价单。",
  },
];

const ASSEMBLYAI = [
  {
    h: "一条 WebSocket 跑完 STT + LLM + TTS",
    d: "wss://agents.assemblyai.com/v1/ws —— 听、想、说共用一条连接，中间没有第三方胶水层。",
    code: "wss://agents.assemblyai.com/v1/ws",
  },
  {
    h: "Agent 定义发布在服务端",
    d: "POST /v1/agents 一次性写入 system prompt、音色、greeting、26 个行业 keyterm（FOB / CIF / MOQ / 体积重 / 到岸成本 / 授权链 …）和两个 JSON-Schema 工具。",
    code: "POST /v1/agents  ·  PUT /v1/agents/{id}",
  },
  {
    h: "工具由模型自己决定什么时候调",
    d: "analyze_inquiry 解析询盘并算到岸成本；generate_quotation 出报价单，也能按一句口述修正重新报价。浏览器执行，结果原路回同一条 socket。",
    code: "tool.call → 本地引擎 → tool.result",
  },
  {
    h: "服务端时间线可直接取证",
    d: "GET /v1/sessions/{id} 返回 artifacts 与逐轮 timeline（含 time_to_first_audio_ms、每次 tool call 的耗时）。演示视频里的数字就是从它读出来的。",
    code: "GET /v1/sessions/{id}",
  },
];

export default function Home() {
  return (
    <AppShell
      title="说一句询盘，拿到一份能直接发客户的英文报价单"
      subtitle="AssemblyAI Voice Agent Hackathon 2026 · 跨境贸易询盘 → 语音口播 → 确定性引擎出单"
      status={
        <a
          className="btn-ghost"
          href="https://github.com/Ninetailedcatfox/assemblyai-voice-agent"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      }
    >
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="card relative overflow-hidden p-6 sm:p-8"
        style={{
          background:
            "radial-gradient(900px 380px at 6% -30%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 68%), var(--surface)",
        }}
      >
        <span className="chip chip-accent">跨境贸易 · 语音优先</span>
        <h2 className="mt-3 max-w-3xl text-2xl font-bold leading-snug tracking-tight text-ink sm:text-3xl">
          外贸业务员对着麦克风说一段话，
          <br className="hidden sm:block" />
          剩下的匹配、算价、成稿、口播，Agent 全包。
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-2">
          买家从 WhatsApp 发来一条语音询盘，业务员要查产品线、把工厂价算成到岸成本（运费 · 体积重 ·
          关税 · MOQ · 打样与交期 · IP 授权风险），再写成英文报价单 —— 一单 20 到 40 分钟，
          而且每次都要重新手算。这个项目把这段工作压成一次对话。
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Link
            href="/agent"
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)", boxShadow: "var(--shadow-lift)" }}
          >
            进入语音 Agent
          </Link>
          <Link
            href="/trade"
            className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2"
          >
            不开麦，文字模式
          </Link>
          <span className="text-xs text-faint">
            需要浏览器麦克风权限；没配 API Key 时页面会明说，不会假装在跑。
          </span>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {FLOW.map((s) => (
            <div key={s.n} className="card-flat p-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-faint">{s.n}</span>
                <span
                  className="text-lg font-bold"
                  style={{
                    background:
                      "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #22d3ee))",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  {s.t}
                </span>
                <span className="text-xs font-semibold text-ink-2">{s.h}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── AssemblyAI 用在哪 ────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">
              AssemblyAI 用在哪
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              语音链路全部落在 Voice Agent API 上，没有自建 STT/TTS，也没有第二家模型供应商。
            </p>
          </div>
          <span className="chip">Voice Agent API · agents.assemblyai.com</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {ASSEMBLYAI.map((a) => (
            <div key={a.h} className="card p-4">
              <h3 className="text-sm font-semibold text-ink">{a.h}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{a.d}</p>
              <code className="mt-2.5 block truncate rounded-lg border border-line-soft bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-2">
                {a.code}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* ── 关键设计决定 ─────────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="card p-5">
          <span className="chip chip-warn">设计决定</span>
          <h2 className="mt-2.5 text-base font-semibold tracking-tight text-ink">
            报价单里的每一个数字都来自纯函数，不来自语言模型
          </h2>
          <p className="mt-2 max-w-4xl text-xs leading-relaxed text-ink-2">
            模型只负责听、决定调什么工具、以及把结果说出来 —— 它不被允许编价格。
            这不是一开始就这么设计的：第一版让模型直接写整份报价单，结果 3,924 字符的文档
            被静默截断成 356 字符，而且两次运行数字会漂移。改成确定性引擎之后，
            输出的每一份报价单都要先过一遍自检（不含中文、长度足够、含价格、含贸易术语、
            含关键条款、结尾没被截断），不合格就自己拒绝自己。
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              ["lib/quoteDocument.ts", "报价单生成器 · 纯函数 + 自检"],
              ["lib/products.ts", "16 个 SKU 的华强北真实价目（工厂价 / FOB / 体积重 / 关税）"],
              ["lib/revision.ts", "口述改价的结构化解析（「降到 1 块，改 DDP」）"],
            ].map(([f, d]) => (
              <div key={f} className="card-flat px-3 py-2.5">
                <code className="block font-mono text-[11px] text-ink-2">{f}</code>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 实测数字 ─────────────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="mb-3">
          <h2 className="text-base font-semibold tracking-tight text-ink">量出来的数字</h2>
          <p className="mt-0.5 text-xs text-muted">
            全部取自线上部署的真实会话与真实 HTTP 请求，仓库里有可复现的脚本。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MEASURED.map((m) => (
            <div key={m.v} className="card p-3.5">
              <div className="text-xl font-bold tracking-tight text-ink">{m.k}</div>
              <div className="mt-0.5 font-mono text-[11px] text-accent">{m.v}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted">{m.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 页脚导航 ─────────────────────────────────────────────────── */}
      <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-xs text-muted">
        <Link className="hover:text-ink-2" href="/agent">
          语音 Agent
        </Link>
        <Link className="hover:text-ink-2" href="/trade">
          外贸模式（文字）
        </Link>
        <Link className="hover:text-ink-2" href="/studio">
          写作工作台
        </Link>
        <a
          className="hover:text-ink-2"
          href="https://github.com/Ninetailedcatfox/assemblyai-voice-agent"
          target="_blank"
          rel="noreferrer"
        >
          GitHub 仓库
        </a>
        <span className="ml-auto text-faint">MIT · Next.js 16 · React 19 · TypeScript</span>
      </footer>
    </AppShell>
  );
}
