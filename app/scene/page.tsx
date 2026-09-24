"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import SceneCanvas from "./SceneCanvas";
import { DEFAULT_SCENE_PROMPT, fallbackSceneFromPrompt, type SceneSpec } from "@/lib/scene";

const EXAMPLES = [
  "一片有萤火虫和发光石头的森林，中央有一条通往古树的小路",
  "一座霓虹城市广场，三栋高楼围绕一个会发光的传送门",
  "漂浮在银河中的小行星基地，带轨道环和两个信号晶体",
];

export default function SceneBuilderPage() {
  const [prompt, setPrompt] = useState(DEFAULT_SCENE_PROMPT);
  const [spec, setSpec] = useState<SceneSpec>(() => fallbackSceneFromPrompt(DEFAULT_SCENE_PROMPT));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("本地规则引擎已就绪；配置 LLM 后会自动升级为 AI 场景编排。");

  const objectSummary = useMemo(() => spec.objects.map((item) => item.label), [spec.objects]);

  async function generate() {
    const value = prompt.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    setNotice("正在把自然语言拆成场景、物体、坐标和交互规则…");
    try {
      const response = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const data = (await response.json()) as { scene?: SceneSpec; warning?: string; error?: string };
      if (!response.ok || !data.scene) throw new Error(data.error ?? "场景生成失败");
      setSpec(data.scene);
      setNotice(data.warning ?? "AI 已完成场景编排：现在可以直接拖拽预览，并继续修改描述迭代。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "场景生成失败");
      setSpec(fallbackSceneFromPrompt(value));
      setNotice("已切换到本地可复现模式，仍然可以继续演示和导出场景 JSON。");
    } finally {
      setLoading(false);
    }
  }

  function downloadSpec() {
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-builder-scene.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#070b16] text-slate-100">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">AI BUILDER / ORACLE SCENE</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">一句话入境，点击对象观场起卦</h1>
        </div>
        <Link href="/" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-300/50 hover:text-white">
          返回写作工作台
        </Link>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 pb-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-cyan-950/10">
          <div className="mb-5 flex items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-cyan-200">01 起意</span>
            <span>→</span>
            <span className="rounded-full bg-violet-400/15 px-2 py-1 text-violet-200">02 入境</span>
            <span>→</span>
            <span className="rounded-full bg-amber-400/15 px-2 py-1 text-amber-200">03 观场</span>
          </div>
          <label htmlFor="scene-prompt" className="text-sm font-medium text-slate-200">告诉 Agent 你想观什么场</label>
          <textarea
            id="scene-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="mt-2 h-36 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60"
            placeholder="例如：一座漂浮在银河中的图书馆…"
          />
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="mt-3 w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "入境中…" : "生成 / 重新生成卦境"}
          </button>
          <div className="mt-5 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">灵感快捷输入</div>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="block w-full rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-left text-xs leading-5 text-slate-400 transition hover:border-cyan-300/30 hover:text-slate-200"
              >
                {example}
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-400">
            <div className="font-medium text-slate-200">卦境流水线</div>
            <div className="mt-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-300" />自然语言解析</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-300" />场景图编排</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-300" />Three.js 浏览器预览</div>
          </div>
        </section>

        <section className="min-w-0">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-h-[520px] rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-2 shadow-2xl shadow-cyan-950/20">
              <SceneCanvas spec={spec} />
            </div>
            <aside className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">Scene Plan</div>
                  <h2 className="mt-1 text-xl font-semibold text-white">{spec.title}</h2>
                </div>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200">
                  {spec.source === "ai" ? "AI" : "LOCAL"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">{spec.description}</p>
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Scene Graph</div>
                <div className="mt-3 space-y-2">
                  {objectSummary.map((item, index) => (
                    <div key={`${item}-${index}`} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs text-slate-300">
                      <span>{item}</span><span className="text-slate-600">0{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Interactions</div>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-400">
                  {spec.interactions.map((item) => <li key={item}>✦ {item}</li>)}
                </ul>
              </div>
              <button type="button" onClick={downloadSpec} className="mt-5 w-full rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-300/40 hover:text-white">
                导出场景 JSON
              </button>
            </aside>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-400">
            <span className="mr-2 text-cyan-200">●</span>{notice}
            {error && <span className="ml-2 text-amber-200">({error})</span>}
          </div>
          <div className="mt-3 rounded-2xl border border-violet-300/10 bg-violet-300/[0.04] px-4 py-3 text-xs leading-5 text-slate-400">
            下一阶段：点击场景对象，让它结合当前卦境给出创作式观场解读，并支持继续追问。
          </div>
        </section>
      </div>
    </main>
  );
}
