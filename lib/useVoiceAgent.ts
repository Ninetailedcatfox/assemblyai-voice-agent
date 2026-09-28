"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AGENT_FRAME_SAMPLES, AGENT_SAMPLE_RATE } from "@/lib/agentAudio";

/**
 * AssemblyAI Voice Agent API 的浏览器客户端。
 *
 * 与 `useAssemblyAIStream`（Realtime STT，只负责"听"）不同，这一条是**完整的
 * 语音到语音**：AAI 负责听（STT）、想（托管 LLM）、说（TTS），我们只负责
 * 音频搬运 + 执行工具。
 *
 * 协议要点（官方 events reference）：
 * - 上行：`input.audio`（base64 PCM16 24kHz），**必须等 `session.ready` 之后**才发
 * - 下行：`reply.audio`（base64 PCM16 24kHz）= agent 的语音
 * - 工具：`tool.call` → 执行 → **等 `reply.done` 到了再发 `tool.result`**
 *   （官方时序图明确要求；工具调用那一轮的 `reply_id` 是 `fc-<call_id>`）
 * - 收尾：先发 `session.end` 再关 socket。裸 `ws.close()` 会让会话停在
 *   30 秒 `session.resume` 宽限期里，**那段是计费的**
 *
 * ⚠️ 回声消除必须开（`echoCancellation: true`）：否则麦克风会把 agent 自己的
 * 声音收回去，agent 打断自己，每次回答都被截断成 `interrupted`。
 * 降噪反而要关 —— 服务端已经做过，再叠一层会伤转写准确率。
 */

const WS_URL = "wss://agents.assemblyai.com/v1/ws";
const WORKLET_URL = "/agent-pcm-worklet.js";
const CONNECT_TIMEOUT_MS = 15000;
/** session.update 发出后等 session.ready 的上限 */
const READY_TIMEOUT_MS = 15000;

export interface AgentTurn {
  role: "user" | "agent";
  text: string;
  at: number;
}

export interface ToolLogEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  summary?: string;
  at: number;
}

export interface VoiceAgentAnalysis {
  intent: Record<string, unknown>;
  flags: string[];
  targetGapUsd: number | null;
  lines: { nameZh: string; landedUnit: number; fobUnit: number; moq: number }[];
}

export interface VoiceAgent {
  supported: boolean;
  /** WebSocket 已建、会话进行中 */
  active: boolean;
  /** 已收到 session.ready */
  ready: boolean;
  /** agent 正在说话 */
  speaking: boolean;
  status: string;
  error: string | null;
  turns: AgentTurn[];
  userInterim: string;
  agentStream: string;
  toolLog: ToolLogEntry[];
  quote: string;
  quoteSource: string;
  analysis: VoiceAgentAnalysis | null;
  start: () => void;
  stop: () => void;
}

function detectSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebSocket !== "undefined"
  );
}

/** PCM16 ArrayBuffer → base64（分块，避免 String.fromCharCode 爆栈） */
function pcm16ToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** base64 → Float32（赋给 Int16Array 会自动按补码回绕成有符号，无需手动符号扩展） */
function base64ToFloat32(b64: string): Float32Array {
  const raw = atob(b64);
  const n = raw.length >> 1;
  const i16 = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    i16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
  }
  const f32 = new Float32Array(n);
  for (let i = 0; i < n; i++) f32[i] = i16[i] / 32768;
  return f32;
}

export function useVoiceAgent(): VoiceAgent {
  const supported = useSyncExternalStore(
    () => () => {},
    detectSupported,
    () => false
  );

  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState("未连接");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [userInterim, setUserInterim] = useState("");
  const [agentStream, setAgentStream] = useState("");
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const [quote, setQuote] = useState("");
  const [quoteSource, setQuoteSource] = useState("");
  const [analysis, setAnalysis] = useState<VoiceAgentAnalysis | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readyRef = useRef(false);
  /** 播放调度游标：每个 reply.audio 排在上一段之后 */
  const playCursorRef = useRef(0);

  const teardown = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          // 先 session.end 再关：裸 close 会停在 30s 计费宽限期里
          ws.send(JSON.stringify({ type: "session.end" }));
        }
      } catch {
        /* 已断，忽略 */
      }
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
      }, 300);
    }

    nodeRef.current?.disconnect();
    nodeRef.current = null;
    srcRef.current?.disconnect();
    srcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) void ctx.close().catch(() => {});

    readyRef.current = false;
    setActive(false);
    setReady(false);
    setSpeaking(false);
    setUserInterim("");
    setAgentStream("");
    setStatus("已结束");
  }, []);

  // 关页/切走：同步发 session.end（异步的 await 来不及跑完）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => teardown();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  /** 执行客户端工具：调自己的报价 API，把结果喂回 agent */
  const runTool = useCallback(
    async (callId: string, name: string, args: Record<string, unknown>) => {
      const entryId = `${callId}-${Date.now()}`;
      setToolLog((prev) => [
        ...prev,
        { id: entryId, name, args, status: "running", at: Date.now() },
      ]);
      const patch = (p: Partial<ToolLogEntry>) =>
        setToolLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...p } : e)));

      try {
        if (name === "analyze_inquiry") {
          const inquiry = String(args.inquiry ?? "");
          const res = await fetch("/api/quote/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft: inquiry }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "询盘分析失败");
          setAnalysis({
            intent: data.intent,
            flags: data.flags ?? [],
            targetGapUsd: data.targetGapUsd ?? null,
            lines: (data.lines ?? []).map(
              (l: {
                nameZh: string;
                landedUnit: number;
                fobUnit: number;
                moq: number;
              }) => ({
                nameZh: l.nameZh,
                landedUnit: l.landedUnit,
                fobUnit: l.fobUnit,
                moq: l.moq,
              })
            ),
          });
          patch({ status: "ok", summary: `匹配 ${data.lines?.length ?? 0} 款，${(data.flags ?? []).length} 条风险` });
          // 给 agent 的数据要精简：8 KiB 上限之外，语音模型也不需要整张表
          return JSON.stringify({
            intent: data.intent,
            targetGapUsd: data.targetGapUsd,
            flags: data.flags,
            lines: (data.lines ?? []).map(
              (l: { nameZh: string; landedUnit: number; fobUnit: number; moq: number }) => ({
                item: l.nameZh,
                fob: l.fobUnit,
                landed: l.landedUnit,
                moq: l.moq,
              })
            ),
          });
        }

        if (name === "generate_quotation") {
          const inquiry = String(args.inquiry ?? "");
          const revision = args.revision_instruction ? String(args.revision_instruction) : "";
          const res = await fetch("/api/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              revision
                ? { draft: inquiry, currentQuote: quote || undefined, instruction: revision }
                : { draft: inquiry }
            ),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error ?? "报价单生成失败");
          }
          const src = res.headers.get("X-Quote-Source") ?? "";
          const text = await res.text();
          setQuote(text);
          setQuoteSource(src);
          patch({ status: "ok", summary: revision ? `改价：${revision}` : `报价单 ${text.length} 字符` });
          return JSON.stringify({
            ok: true,
            source: src,
            note: revision ? `已按"${revision}"重新出单` : "报价单已生成并显示在屏幕上",
            summary: `共 ${text.length} 字符，含明细表、MOQ、交期、体积重说明、关税提示、IP 条款`,
          });
        }

        patch({ status: "error", summary: `未知工具 ${name}` });
        return JSON.stringify({ error: `unknown tool: ${name}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "工具执行失败";
        patch({ status: "error", summary: msg });
        return JSON.stringify({ error: msg });
      }
    },
    [quote]
  );

  const start = useCallback(() => {
    if (active || wsRef.current) return;
    setError(null);
    setTurns([]);
    setUserInterim("");
    setAgentStream("");
    setToolLog([]);
    setQuote("");
    setQuoteSource("");
    setAnalysis(null);
    setActive(true);
    setStatus("正在连接…");

    void (async () => {
      try {
        // 1) 麦克风：回声消除必须开，降噪必须关
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false },
        });
        streamRef.current = media;

        // 2) 服务端签一次性 token + 拿 agent_id
        const res = await fetch("/api/voice-agent", { cache: "no-store" });
        const data = (await res.json()) as {
          token?: string;
          agentId?: string;
          error?: string;
        };
        if (!res.ok || !data.token || !data.agentId) {
          throw new Error(data.error ?? "获取 Voice Agent token 失败");
        }

        // 3) 音频图：默认采样率 + worklet 内重采样到 24kHz
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume();
        await ctx.audioWorklet.addModule(WORKLET_URL);

        const url = new URL(WS_URL);
        url.searchParams.set("token", data.token);
        const ws = new WebSocket(url.toString());
        wsRef.current = ws;

        // 工具调用的时序：结果先算好放队列，等该轮的 reply.done 到了再发
        const readyResults: { call_id: string; result: string; is_error: boolean }[] = [];
        let flushDue = 0;
        const tryFlush = () => {
          while (flushDue > 0 && readyResults.length > 0) {
            flushDue -= 1;
            const r = readyResults.shift()!;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "tool.result", ...r }));
            }
          }
        };

        let settled = false;
        let rejectConnect: ((e: Error) => void) | null = null;
        let resolveReady: (() => void) | null = null;
        const readyPromise = new Promise<void>((r) => {
          resolveReady = r;
        });
        const failConnect = (msg: string) => {
          if (settled) return;
          settled = true;
          rejectConnect?.(new Error(msg));
        };

        ws.onmessage = (ev: MessageEvent) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = String(msg.type ?? "");

          switch (type) {
            case "session.ready":
              readyRef.current = true;
              setReady(true);
              setStatus("已连接，请说话");
              resolveReady?.();
              break;

            case "session.updated":
              break;

            case "input.speech.started":
              setStatus("听到你在说…");
              break;

            case "input.speech.stopped":
              setStatus("处理中…");
              break;

            case "transcript.user.delta":
              // text 是"到目前为止的完整文本"，直接替换而不是拼接
              setUserInterim(String(msg.text ?? ""));
              break;

            case "transcript.user": {
              const text = String(msg.text ?? "").trim();
              setUserInterim("");
              if (text) {
                setTurns((prev) => [...prev, { role: "user", text, at: Date.now() }]);
              }
              break;
            }

            case "reply.started":
              setSpeaking(true);
              setAgentStream("");
              setStatus("报价助手在说…");
              break;

            case "reply.audio": {
              const ctx2 = ctxRef.current;
              const b64 = String(msg.data ?? "");
              if (!ctx2 || !b64) break;
              const f32 = base64ToFloat32(b64);
              const buf = ctx2.createBuffer(1, f32.length, AGENT_SAMPLE_RATE);
              buf.getChannelData(0).set(f32);
              const node = ctx2.createBufferSource();
              node.buffer = buf;
              node.connect(ctx2.destination);
              const now = ctx2.currentTime;
              const startAt = Math.max(playCursorRef.current, now);
              node.start(startAt);
              playCursorRef.current = startAt + buf.duration;
              break;
            }

            case "transcript.agent.delta":
              setAgentStream((prev) => prev + String(msg.delta ?? ""));
              break;

            case "transcript.agent": {
              const text = String(msg.text ?? "").trim();
              setAgentStream("");
              if (text) {
                setTurns((prev) => [...prev, { role: "agent", text, at: Date.now() }]);
              }
              break;
            }

            case "reply.done": {
              setSpeaking(false);
              const replyId = String(msg.reply_id ?? "");
              // 打断：丢掉还没播的音频，别让过期语音继续放
              if (msg.status === "interrupted") {
                const ctx2 = ctxRef.current;
                playCursorRef.current = ctx2 ? ctx2.currentTime : 0;
              }
              // 工具调用那一轮的 reply_id 是 fc-<call_id>，此时才轮到发 tool.result
              if (replyId.startsWith("fc-")) {
                flushDue += 1;
                tryFlush();
              }
              setStatus("已连接，请说话");
              break;
            }

            case "tool.call": {
              const callId = String(msg.call_id ?? "");
              const name = String(msg.name ?? "");
              const args = (msg.arguments ?? {}) as Record<string, unknown>;
              void runTool(callId, name, args).then((result) => {
                readyResults.push({
                  call_id: callId,
                  result,
                  is_error: result.includes('"error"'),
                });
                tryFlush();
              });
              break;
            }

            case "session.ended":
              readyRef.current = false;
              setStatus("会话已结束");
              teardown();
              break;

            case "session.error":
            case "error": {
              const m = String(msg.message ?? "Voice Agent 错误");
              const code = String(msg.code ?? "");
              setError(code ? `${m}（${code}）` : m);
              failConnect(m);
              break;
            }

            default:
              break;
          }
        };

        ws.onerror = () => failConnect("连接 Voice Agent 失败");

        ws.onclose = (ev: CloseEvent) => {
          wsRef.current = null;
          resolveReady?.();
          if (!readyRef.current) {
            failConnect(
              `Voice Agent 在会话开始前断开（code ${ev.code}${
                ev.reason ? ` ${String(ev.reason).slice(0, 80)}` : ""
              }）`
            );
          }
          setActive(false);
          setReady(false);
          setSpeaking(false);
          setUserInterim("");
          setStatus("已断开");
        };

        await new Promise<void>((resolve, reject) => {
          rejectConnect = reject;
          const t = setTimeout(() => reject(new Error("连接 Voice Agent 超时")), CONNECT_TIMEOUT_MS);
          ws.onopen = () => {
            clearTimeout(t);
            // 绑定已发布的 agent（提示词/音色/工具都在服务端）
            ws.send(
              JSON.stringify({ type: "session.update", session: { agent_id: data.agentId } })
            );
            resolve();
          };
        });
        settled = true;

        // 握手成功 ≠ 鉴权通过：必须等到 session.ready
        await Promise.race([
          readyPromise,
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error("Voice Agent 未返回 session.ready（token 可能无效或已过期）")),
              READY_TIMEOUT_MS
            )
          ),
        ]);
        if (!readyRef.current) throw new Error("Voice Agent 会话未就绪");

        // 4) ready 之后才接音频图并开始上行
        const source = ctx.createMediaStreamSource(media);
        srcRef.current = source;
        const node = new AudioWorkletNode(ctx, "agent-pcm16", {
          processorOptions: {
            inputSampleRate: ctx.sampleRate,
            targetSampleRate: AGENT_SAMPLE_RATE,
            frameSamples: AGENT_FRAME_SAMPLES,
          },
        });
        nodeRef.current = node;
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (readyRef.current && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input.audio", audio: pcm16ToBase64(e.data) }));
          }
        };
        source.connect(node);
        // 不接 destination：否则会把麦克风原声回放出来
      } catch (err) {
        setError(err instanceof Error ? err.message : "Voice Agent 启动失败");
        teardown();
      }
    })();
  }, [active, runTool, teardown]);

  const stop = useCallback(() => {
    teardown();
  }, [teardown]);

  return {
    supported,
    active,
    ready,
    speaking,
    status,
    error,
    turns,
    userInterim,
    agentStream,
    toolLog,
    quote,
    quoteSource,
    analysis,
    start,
    stop,
  };
}
