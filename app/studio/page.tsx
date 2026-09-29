"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  quickMessages,
  planMessages,
  draftMessages,
  polishMessages,
  rewriteMessages,
  type PromptOptions,
  type Suggestions,
} from "@/lib/prompts";
import {
  LANGS,
  LENGTHS,
  TONES,
  WRITING_TYPES,
  type WritingIntent,
} from "@/lib/intent";
import { useTranscription } from "@/lib/useTranscription";
import { mergeHistories, type HistoryItem } from "@/lib/historyStore";

interface ProviderInfo {
  id: string;
  label: string;
  model: string;
}

interface ResearchItem {
  title: string;
  url: string;
}

type StageStatus = "pending" | "running" | "done" | "error" | "skip";
type StageKey = "analyze" | "search" | "plan" | "draft" | "polish" | "suggest";
type Stages = Record<StageKey, StageStatus>;
type TouchedKey = "type" | "tone" | "length" | "lang";

const STAGE_LABELS: Record<StageKey, string> = {
  analyze: "意图识别",
  search: "联网检索",
  plan: "规划大纲",
  draft: "撰写初稿",
  polish: "润色精修",
  suggest: "智能建议",
};

const STAGE_ORDER: StageKey[] = ["analyze", "search", "plan", "draft", "polish", "suggest"];

const HISTORY_KEY = "ai-writing-studio:history";

const EXAMPLES = [
  {
    label: "📋 会议纪要",
    text: "今天下午三点和市场部开了个会，主要说了下周新品发布的事，小李负责物料，小王对接媒体，发布会定在周四上午十点，地点还没定，我催行政本周给答复",
  },
  {
    label: "✍️ 公众号文章",
    text: "写一篇关于早睡的文章。要点：现在的人都熬夜，刷手机到一两点；长期熬夜伤身体，免疫力下降、记忆力变差；我自己试了三周十一点睡，皮肤和精神都明显变好；给大家三个建议：睡前一小时不碰手机、卧室灯光调暗、固定起床时间",
  },
  {
    label: "📸 小红书",
    text: "周末去了杭州良渚，遗址公园和大屋顶书馆，人不多拍照绝美，地铁2号线能到，门票60，推荐傍晚去光线最好，帮我写一篇种草笔记",
  },
];

const REWRITE_ACTIONS: { label: string; instruction: string }[] = [
  { label: "重写", instruction: "重写这段话，表达更准确、流畅，消除口语化表达" },
  { label: "扩写", instruction: "扩写这段话，补充必要细节使其更丰满（约为原来的 2 倍长度）" },
  { label: "缩短", instruction: "缩短这段话，只保留核心信息（约为原来的一半长度）" },
  { label: "换个语气", instruction: "换一种轻松自然的语气重写这段话，保持信息不变" },
];

const ALL_STAGES_PENDING = (): Stages => ({
  analyze: "pending",
  search: "pending",
  plan: "pending",
  draft: "pending",
  polish: "pending",
  suggest: "pending",
});

export default function Home() {
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState("");
  const [output, setOutput] = useState("");
  const [type, setType] = useState("微信公众号文章");
  const [tone, setTone] = useState("正式");
  const [length, setLength] = useState(LENGTHS[1]);
  const [lang, setLang] = useState(LANGS[0]);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [mode, setMode] = useState<"quick" | "agent">("agent");
  const [polishOn, setPolishOn] = useState(true);
  const [provider, setProvider] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [error, setError] = useState("");
  const [cloudSynced, setCloudSynced] = useState(false);
  const [stages, setStages] = useState<Stages>(ALL_STAGES_PENDING);
  const [intent, setIntent] = useState<WritingIntent | null>(null);
  const [research, setResearch] = useState<ResearchItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0, text: "" });

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
    } catch {
      return [];
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  // 用户手动改过的参数，意图识别不再覆盖
  const [touchedKeys, setTouchedKeys] = useState<Set<TouchedKey>>(() => new Set());

  const opts = useMemo<PromptOptions>(
    () => ({ type, tone, length, lang }),
    [type, tone, length, lang]
  );

  // 转写引擎：优先 AssemblyAI Realtime STT，不可用则降级浏览器 Web Speech
  const { engine, aai, speech } = useTranscription("zh-CN");
  const prevTranscript = useRef("");
  // 语音识别：已确认文本实时追加进草稿；停止时把临时文本一并补上
  useEffect(() => {
    if (!speech.listening) {
      prevTranscript.current = "";
      return;
    }
    const added = speech.transcript.slice(prevTranscript.current.length);
    if (added) setDraft((d) => d + added);
    prevTranscript.current = speech.transcript;
  }, [speech.transcript, speech.listening]);

  const handleVoiceStart = () => {
    prevTranscript.current = "";
    speech.start();
  };
  const handleVoiceStop = () => {
    if (speech.interim) setDraft((d) => d + speech.interim);
    speech.stop();
  };
  const handleVoiceStopAndRun = () => {
    if (speech.interim) setDraft((d) => d + speech.interim);
    speech.stop();
    run();
  };
  const clearAll = () => {
    setDraft("");
    setOutput("");
    setPlan("");
    setError("");
    setIntent(null);
    setResearch([]);
    setSuggestions(null);
    setTouchedKeys(new Set());
    setStages(ALL_STAGES_PENDING());
  };

  const markTouched = (key: TouchedKey) => {
    setTouchedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const setStage = (key: StageKey, status: StageStatus) =>
    setStages((s) => ({ ...s, [key]: status }));

  useEffect(() => {
    fetch("/api/generate")
      .then((r) => r.json())
      .then((data: { providers: ProviderInfo[]; active: string | null }) => {
        setProviders(data.providers);
        if (data.active) setProvider(data.active);
        else if (data.providers[0]) setProvider(data.providers[0].id);
      })
      .catch(() => {
        /* provider probe failed, UI still usable */
      });
    fetch("/api/analyze")
      .then((r) => r.json())
      .then((data: { enabled: boolean }) => setSearchEnabled(data.enabled === true))
      .catch(() => setSearchEnabled(false));
    fetch("/api/history")
      .then((r) => r.json())
      .then((data: { items: HistoryItem[] }) => {
        if (Array.isArray(data.items) && data.items.length) {
          setCloudSynced(true);
          setHistory((prev) => mergeHistories(prev, data.items));
        }
      })
      .catch(() => {
        /* cloud unavailable, keep local history */
      });
  }, []);

  const saveHistory = useCallback((content: string) => {
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      title: content.trim().slice(0, 20) || "未命名",
      content,
      createdAt: new Date().toISOString(),
    };
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 50);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* storage full, ignore */
      }
      return next;
    });
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
    })
      .then(() => setCloudSynced(true))
      .catch(() => {
        /* cloud sync optional, ignore failures */
      });
  }, []);

  const streamStage = useCallback(
    async (
      messages: { role: "system" | "user" | "assistant"; content: string }[],
      onDelta: (delta: string) => void,
      signal?: AbortSignal
    ) => {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ messages, provider }),
      });
      if (!res.ok) {
        let message = `请求失败 (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          /* keep status message */
        }
        throw new Error(message);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("浏览器不支持流式读取。");
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onDelta(decoder.decode(value, { stream: true }));
      }
    },
    [provider]
  );

  // 单阶段调用：流式输出到 onDelta；空结果或上游报错时各自动重试一次
  const runStage = useCallback(
    async (
      build: () => { role: "system" | "user" | "assistant"; content: string }[],
      onDelta: (acc: string) => void,
      signal?: AbortSignal
    ): Promise<string> => {
      let acc = "";
      const pull = (d: string) => {
        acc += d;
        onDelta(acc);
      };
      const attempt = () => streamStage(build(), pull, signal);
      try {
        await attempt();
      } catch (e) {
        if (signal?.aborted) throw e; // 用户主动停止，不再重试
        acc = "";
        await attempt();
      }
      if (!acc.trim()) {
        acc = "";
        try {
          await attempt();
        } catch (e) {
          if (signal?.aborted) throw e;
        }
      }
      return acc;
    },
    [streamStage]
  );

  const typeOptions = useMemo(() => {
    const extra = customTypes.filter((t) => !WRITING_TYPES.includes(t));
    return [...WRITING_TYPES, ...extra];
  }, [customTypes]);

  // 把意图识别结果应用到未被用户手动改过的参数上
  const applyIntent = useCallback((it: WritingIntent) => {
    setIntent(it);
    if (it.type) {
      if (!WRITING_TYPES.includes(it.type)) {
        setCustomTypes((prev) => (prev.includes(it.type) ? prev : [...prev, it.type]));
      }
      if (!touchedKeys.has("type")) setType(it.type);
    }
    if (!touchedKeys.has("tone")) setTone(it.tone);
    if (!touchedKeys.has("length")) setLength(it.length);
    if (!touchedKeys.has("lang")) setLang(it.lang);
  }, [touchedKeys]);

  const scroll = () => outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);

  const runAnalyze = useCallback(
    async (signal: AbortSignal, draftText: string) => {
      setStage("analyze", "running");
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({ draft: draftText }),
        });
        const data = (await res.json()) as {
          intent: WritingIntent | null;
          research?: { title: string; url: string }[];
        };
        if (data.intent) {
          applyIntent(data.intent);
          setStage("analyze", "done");
        } else {
          setStage("analyze", "skip");
        }
        const items = data.research ?? [];
        setResearch(items);
        setStage("search", items.length ? "done" : "skip");
        return items.length
          ? items
              .map((r, i) => `[${i + 1}] ${r.title}\n    来源: ${r.url}`)
              .join("\n")
          : "";
      } catch (e) {
        if (signal.aborted) throw e;
        setStage("analyze", "skip");
        setStage("search", "skip");
        return "";
      }
    },
    [applyIntent]
  );

  const runSuggest = useCallback(
    async (signal: AbortSignal, text: string) => {
      setStage("suggest", "running");
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({ text, type, tone, lang }),
        });
        const data = (await res.json()) as { suggestions?: Suggestions };
        const s = data.suggestions;
        if (s && (s.titles.length || s.tags.length || s.tips.length)) {
          setSuggestions(s);
          setStage("suggest", "done");
        } else {
          setStage("suggest", "skip");
        }
      } catch (e) {
        if (signal.aborted) throw e;
        setStage("suggest", "skip");
      }
    },
    [type, tone, lang]
  );

  // 从成稿阶段重跑（大纲被手动编辑后）
  const rerunFromDraft = useCallback(
    async (planText: string, draftText: string, researchText: string) => {
      if (!planText.trim() || !draftText.trim() || loading) return;
      setLoading(true);
      setError("");
      setSuggestions(null);
      const abort = new AbortController();
      abortRef.current = abort;
      setStages((s) => ({
        ...ALL_STAGES_PENDING(),
        analyze: s.analyze,
        search: s.search,
        plan: "done",
        draft: "running",
      }));
      try {
        setStages((s) => ({ ...s, polish: polishOn ? "pending" : "skip" }));
        const outAcc = await runStage(
          () => draftMessages(planText, draftText, opts, researchText),
          (a) => {
            setOutput(a);
            scroll();
          },
          abort.signal
        );
        setStages((s) => ({ ...s, draft: outAcc.trim() ? "done" : "error" }));
        if (!outAcc.trim()) throw new Error("初稿生成失败，请重试。");

        let finalText = outAcc;
        if (polishOn) {
          setStages((s) => ({ ...s, polish: "running" }));
          const polished = await runStage(
            () => polishMessages(outAcc, opts),
            (a) => {
              setOutput(a);
              scroll();
            },
            abort.signal
          );
          setStages((s) => ({ ...s, polish: polished.trim() ? "done" : "skip" }));
          if (polished.trim()) finalText = polished;
          else setOutput(outAcc);
        }
        if (finalText.trim()) saveHistory(finalText);
        await runSuggest(abort.signal, finalText);
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "生成失败，请重试。");
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [loading, polishOn, opts, runStage, runSuggest, saveHistory]
  );

  const run = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || loading) return;
    if (!provider) {
      setError(
        "未检测到可用的 LLM Key，请在 .env.local 中配置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。"
      );
      return;
    }
    setLoading(true);
    setError("");
    setOutput("");
    setPlan("");
    setIntent(null);
    setResearch([]);
    setSuggestions(null);
    setStages(ALL_STAGES_PENDING());
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      if (mode === "quick") {
        setStages((s) => ({
          ...s,
          analyze: "skip",
          search: "skip",
          plan: "skip",
          polish: "skip",
          suggest: "skip",
          draft: "running",
        }));
        const acc = await runStage(
          () => quickMessages(trimmed, opts),
          (a) => {
            setOutput(a);
            scroll();
          },
          abort.signal
        );
        setStages((s) => ({ ...s, draft: acc.trim() ? "done" : "error" }));
        if (!acc.trim()) throw new Error("生成失败，请重试。");
        saveHistory(acc);
        return;
      }

      const researchText = await runAnalyze(abort.signal, trimmed);

      setStages((s) => ({ ...s, plan: "running", polish: polishOn ? "pending" : "skip" }));
      const planAcc = await runStage(
        () => planMessages(trimmed, opts, researchText),
        (a) => setPlan(a),
        abort.signal
      );
      setStages((s) => ({ ...s, plan: planAcc.trim() ? "done" : "error" }));

      setStages((s) => ({ ...s, draft: "running" }));
      const outAcc = await runStage(
        () => draftMessages(planAcc, trimmed, opts, researchText),
        (a) => {
          setOutput(a);
          scroll();
        },
        abort.signal
      );
      setStages((s) => ({ ...s, draft: outAcc.trim() ? "done" : "error" }));
      if (!outAcc.trim()) throw new Error("初稿生成失败，请重试。");

      let finalText = outAcc;
      if (polishOn) {
        setStages((s) => ({ ...s, polish: "running" }));
        const polished = await runStage(
          () => polishMessages(outAcc, opts),
          (a) => {
            setOutput(a);
            scroll();
          },
          abort.signal
        );
        setStages((s) => ({ ...s, polish: polished.trim() ? "done" : "skip" }));
        if (polished.trim()) finalText = polished;
        else setOutput(outAcc); // 润色为空则回退初稿
      }
      if (finalText.trim()) saveHistory(finalText);
      await runSuggest(abort.signal, finalText);
    } catch (err) {
      if (abort.signal.aborted) return;
      setError(err instanceof Error ? err.message : "生成失败，请重试。");
      setStages((s) => {
        const next = { ...s };
        for (const key of STAGE_ORDER) {
          if (next[key] === "running") next[key] = "error";
        }
        return next;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [
    draft,
    loading,
    provider,
    mode,
    polishOn,
    opts,
    runStage,
    runAnalyze,
    runSuggest,
    saveHistory,
  ]);

  // 中→英一键翻译：把当前成稿译作自然英文
  const runTranslate = useCallback(async () => {
    if (!output.trim() || loading) return;
    if (!provider) {
      setError("未检测到可用的 LLM Key，无法翻译。");
      return;
    }
    setLoading(true);
    setError("");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const translated = await runStage(
        () => [
          {
            role: "system",
            content:
              "You are a professional translator. Translate the following Chinese text into natural, fluent English. Output only the translation, without any explanations, notes, or quotation marks.",
          },
          { role: "user", content: output },
        ],
        (a) => {
          setOutput(a);
          scroll();
        },
        abort.signal
      );
      if (!translated.trim()) throw new Error("翻译失败，请重试。");
      saveHistory(translated);
    } catch (err) {
      if (abort.signal.aborted) return;
      setError(err instanceof Error ? err.message : "翻译失败，请重试。");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [output, loading, provider, runStage, saveHistory]);

  // 选中改写：只替换选区，流式回填
  const runRewrite = useCallback(
    async (instruction: string) => {
      if (!selection.text.trim() || rewriting || loading) return;
      setRewriting(true);
      setError("");
      const abort = new AbortController();
      abortRef.current = abort;
      const before = output.slice(0, selection.start);
      const after = output.slice(selection.end);
      try {
        await streamStage(
          rewriteMessages(selection.text, instruction, before.slice(-200), after.slice(0, 200), opts),
          (acc) => {
            setOutput(before + acc + after);
            scroll();
          },
          abort.signal
        );
          saveHistory(output);
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "改写失败，请重试。");
      } finally {
        setRewriting(false);
        setSelection({ start: 0, end: 0, text: "" });
        abortRef.current = null;
      }
    },
    [selection, rewriting, loading, output, opts, streamStage, saveHistory]
  );

  const handleStop = () => abortRef.current?.abort();

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      /* clipboard unavailable */
    }
  };

  const downloadOutput = () => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type || "写作"}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadHistory = (item: HistoryItem) => {
    setOutput(item.content);
    setPlan("");
  };

  const stageDot = (status: StageStatus) =>
    status === "done"
      ? "bg-ok"
      : status === "running"
      ? "bg-accent animate-pulse"
      : status === "error"
      ? "bg-danger"
      : "bg-line-strong";

  const trackSelection = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    if (selectionStart === null || selectionEnd === null) return;
    if (selectionStart === selectionEnd) {
      if (selection.text) setSelection({ start: 0, end: 0, text: "" });
      return;
    }
    setSelection({
      start: selectionStart,
      end: selectionEnd,
      text: el.value.slice(selectionStart, selectionEnd),
    });
  };

  return (
    <>
      <div
        className="no-print flex h-screen flex-col font-sans text-ink"
        style={{
          background:
            "radial-gradient(1100px 520px at 8% -10%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%), var(--bg)",
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1
              className="text-lg font-bold tracking-tight"
              style={{
                background:
                  "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 40%, #22d3ee))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              AI 写作工作台
            </h1>
            <span className="truncate text-xs text-faint">说一段话 → 查资料 → 透明成稿</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <nav className="flex items-center gap-0.5 card-2 p-0.5">
              <Link
                href="/"
                className="rounded-[0.55rem] px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink-2"
              >
                总览
              </Link>
              <Link
                href="/agent"
                className="rounded-[0.55rem] px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink-2"
              >
                语音 Agent
              </Link>
              <Link
                href="/trade"
                className="rounded-[0.55rem] px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink-2"
              >
                外贸模式
              </Link>
              <span
                aria-current="page"
                className="rounded-[0.55rem] bg-raised px-2.5 py-1 text-xs font-medium text-ink shadow-sm"
              >
                写作工作台
              </span>
            </nav>
            {searchEnabled && (
              <span className="rounded-full bg-ok-soft px-3 py-1 text-xs text-ok">
                🔍 检索增强已启用
              </span>
            )}
            {providers.length === 0 ? (
              <span className="rounded-full bg-warn-soft px-3 py-1 text-xs text-warn">
                未配置 API Key
              </span>
            ) : (
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {p.model}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-line bg-surface/70 p-4 lg:w-72 lg:border-b-0 lg:border-r">
            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted">
                写作类型
                {intent && !touchedKeys.has("type") && (
                  <span className="rounded bg-accent-soft px-1.5 text-[10px] normal-case text-accent">
                    ✨ AI 识别
                  </span>
                )}
              </label>
              <select
                value={type}
                onChange={(e) => {
                  markTouched("type");
                  setType(e.target.value);
                }}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
              >
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  语气
                </label>
                <select
                  value={tone}
                  onChange={(e) => {
                    markTouched("tone");
                    setTone(e.target.value);
                  }}
                  className="w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm"
                >
                  {[...new Set([tone, ...TONES])].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  语言
                </label>
                <select
                  value={lang}
                  onChange={(e) => {
                    markTouched("lang");
                    setLang(e.target.value);
                  }}
                  className="w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm"
                >
                  {[...new Set([lang, ...LANGS])].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                篇幅
              </label>
              <select
                value={length}
                onChange={(e) => {
                  markTouched("length");
                  setLength(e.target.value);
                }}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
              >
                {[...new Set([length, ...LENGTHS])].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                模式
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("quick")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                    mode === "quick"
                      ? "border-accent bg-accent text-white"
                      : "border-line-strong bg-surface text-muted hover:bg-surface-2"
                  }`}
                >
                  快速生成
                </button>
                <button
                  onClick={() => setMode("agent")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                    mode === "agent"
                      ? "border-accent bg-accent text-white"
                      : "border-line-strong bg-surface text-muted hover:bg-surface-2"
                  }`}
                >
                  Agent 流水线
                </button>
              </div>
              {mode === "agent" && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={polishOn}
                    onChange={(e) => setPolishOn(e.target.checked)}
                  />
                  启用润色精修阶段
                </label>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
                  历史记录
                </h2>
                {cloudSynced && (
                  <span className="text-[10px] text-ok">☁ 云端已同步</span>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {history.length === 0 && (
                  <p className="text-xs text-faint">暂无历史，生成后自动保存。</p>
                )}
                {history.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadHistory(item)}
                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-2"
                    title={item.content}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <section className="flex flex-col">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wide text-muted">
                  草稿 / 口述内容
                </label>
                {engine === "aai" ? (
                  <span
                    className="text-xs text-ok"
                    title="AssemblyAI Realtime STT"
                  >
                    🎙 AssemblyAI 实时转写
                  </span>
                ) : speech.supported ? (
                  <span
                    className="text-xs text-faint"
                    title={aai.error ?? "未配置 ASSEMBLYAI_API_KEY，已降级为浏览器语音"}
                  >
                    🎙 浏览器语音转写（降级）
                  </span>
                ) : (
                  <span
                    className="text-xs text-warn"
                    title="请使用 Chrome / Edge 打开以使用语音输入"
                  >
                    🎙 当前浏览器不支持语音
                  </span>
                )}
              </div>
              {!draft && !speech.listening && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => setDraft(ex.text)}
                      className="rounded-full border border-dashed border-line-strong bg-surface px-3 py-1 text-xs text-accent transition hover:bg-accent-soft"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              )}
              {speech.listening && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-danger">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
                  聆听中…
                  {speech.interim && (
                    <span className="text-danger">{speech.interim}</span>
                  )}
                </div>
              )}
              <textarea
                value={speech.listening ? draft + speech.interim : draft}
                readOnly={speech.listening}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="直接说或写你的思路、要点…AI 会自动判断写什么、要不要查资料"
                className="min-h-28 resize-none rounded-xl border border-line-strong bg-surface p-4 text-sm leading-relaxed shadow-sm outline-none transition focus:border-accent"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {speech.listening ? (
                  <>
                    <button
                      onClick={handleVoiceStopAndRun}
                      className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
                    >
                      停止并生成
                    </button>
                    <button
                      onClick={handleVoiceStop}
                      className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2"
                    >
                      仅停止
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={run}
                      disabled={loading || !draft.trim()}
                      className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "生成中…" : "生成"}
                    </button>
                    <button
                      onClick={handleVoiceStart}
                      disabled={!speech.supported || loading}
                      className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      🎤 语音输入
                    </button>
                  </>
                )}
                {loading && (
                  <button
                    onClick={handleStop}
                    className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2"
                  >
                    停止
                  </button>
                )}
                <button
                  onClick={clearAll}
                  disabled={loading}
                  className="rounded-lg border border-line-strong px-4 py-2 text-sm text-muted hover:bg-surface-2 disabled:opacity-50"
                >
                  清空
                </button>
              </div>
            </section>

            {mode === "agent" && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-2 card/80 px-3 py-2.5">
                {STAGE_ORDER.map((key, i) => {
                  const status = stages[key];
                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stageDot(status)}`} />
                      <span
                        className={`text-xs ${
                          status === "pending"
                            ? "text-faint"
                            : status === "skip"
                            ? "text-faint line-through decoration-line-strong"
                            : "text-ink-2"
                        }`}
                      >
                        {STAGE_LABELS[key]}
                      </span>
                      {i < STAGE_ORDER.length - 1 && (
                        <span className="mx-1 h-px w-4 bg-surface-2" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {mode === "agent" && (intent || research.length > 0) && (
              <section className="flex shrink-0 flex-col gap-1.5 rounded-xl border border-accent/35 bg-accent-soft/70 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-accent">✨ 意图识别</span>
                  {intent ? (
                    <>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-2">
                        {intent.type}
                      </span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-2">
                        {intent.tone}
                      </span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-2">
                        {intent.length}
                      </span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-2">
                        {intent.lang}
                      </span>
                      {intent.summary && (
                        <span className="text-xs text-accent">{intent.summary}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-faint">识别不可用，已使用手动参数</span>
                  )}
                </div>
                {research.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-ok">
                      🔍 检索到 {research.length} 条资料
                    </span>
                    {research.slice(0, 5).map((r, i) => (
                      <a
                        key={r.url}
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        title={r.title}
                        className="max-w-44 truncate rounded-full bg-surface px-2 py-0.5 text-xs text-ok hover:underline"
                      >
                        [{i + 1}] {r.title}
                      </a>
                    ))}
                  </div>
                )}
                {intent?.needSearch && research.length === 0 && searchEnabled && (
                  <span className="text-xs text-faint">
                    已尝试检索「{intent.searchQuery}」，未获取到资料
                  </span>
                )}
              </section>
            )}

            {error && (
              <p className="shrink-0 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            {mode === "agent" && plan && (
              <section className="flex shrink-0 flex-col">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted">
                    大纲（可直接编辑）
                  </label>
                  <button
                    onClick={() => rerunFromDraft(plan, draft.trim(), "")}
                    disabled={loading || rewriting || !draft.trim()}
                    className="rounded-md border border-accent/35 bg-accent-soft px-2.5 py-1 text-xs text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ↻ 按新大纲重新成稿
                  </button>
                </div>
                <textarea
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="max-h-32 min-h-16 overflow-y-auto whitespace-pre-wrap card p-3 text-sm leading-relaxed text-ink-2 shadow-sm outline-none focus:border-accent"
                />
              </section>
            )}

            <section className="flex min-h-72 flex-1 flex-col">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted">
                  成稿
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={copyOutput}
                    disabled={!output}
                    className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                  >
                    复制
                  </button>
                  <button
                    onClick={downloadOutput}
                    disabled={!output}
                    className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                  >
                    下载 .md
                  </button>
                  <button
                    onClick={runTranslate}
                    disabled={!output || loading}
                    className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                    title="把当前成稿译作英文"
                  >
                    🌐 译英文
                  </button>
                  <button
                    onClick={() => window.print()}
                    disabled={!output}
                    className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                    title="打印或导出为 PDF"
                  >
                    🖨 打印 / PDF
                  </button>
                </div>
              </div>
              {selection.text && !rewriting && (
                <div className="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-accent/35 bg-accent-soft px-3 py-1.5">
                  <span className="text-xs text-accent">
                    ✂️ 已选 {selection.text.length} 字
                  </span>
                  {REWRITE_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => runRewrite(a.instruction)}
                      className="rounded-md bg-surface px-2 py-0.5 text-xs text-accent shadow-sm hover:bg-accent-soft"
                    >
                      {a.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setSelection({ start: 0, end: 0, text: "" })}
                    className="text-xs text-faint hover:text-muted"
                  >
                    取消
                  </button>
                </div>
              )}
              {rewriting && (
                <div className="mb-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-xs text-accent">
                  ✏️ 正在改写选中片段…
                </div>
              )}
              <textarea
                ref={outputRef}
                value={output}
                readOnly
                onSelect={(e) => trackSelection(e.currentTarget)}
                placeholder="生成的成稿会实时显示在这里。选中任意文字可重写、扩写、缩短、换语气…"
                className="min-h-40 flex-1 resize-none card p-4 text-sm leading-relaxed shadow-sm outline-none"
              />
            </section>

            {suggestions && (suggestions.titles.length || suggestions.tags.length || suggestions.tips.length) > 0 && (
              <section className="flex shrink-0 flex-col gap-2 rounded-xl border border-warn-line bg-warn-soft/70 p-3">
                <span className="text-xs font-medium text-warn">💡 智能建议</span>
                {suggestions.titles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">标题候选</span>
                    {suggestions.titles.map((t) => (
                      <button
                        key={t}
                        onClick={() => navigator.clipboard.writeText(t).catch(() => {})}
                        title="点击复制"
                        className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-ink-2 shadow-sm hover:bg-warn-soft"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {suggestions.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">标签</span>
                    {suggestions.tags.map((t) => (
                      <button
                        key={t}
                        onClick={() => navigator.clipboard.writeText(t).catch(() => {})}
                        title="点击复制"
                        className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-accent shadow-sm hover:bg-warn-soft"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {suggestions.tips.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-muted">
                    {suggestions.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </main>
        </div>
      </div>
      <div className="print-area" aria-hidden="true">
        <pre>{output}</pre>
      </div>
    </>
  );
}
