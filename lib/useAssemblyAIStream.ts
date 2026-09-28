"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * AssemblyAI Realtime STT（WebSocket）封装。
 *
 * 接口与 `useSpeechRecognition` 完全一致（supported / listening / transcript /
 * interim / start / stop），另外多一个 `error` —— 这样页面可以整体替换，
 * 任一环节失败都能静默降级回浏览器内置 Web Speech，Demo 不会开天窗。
 *
 * 协议要点（官方 WebSocket API）：
 * - 端点 wss://streaming.assemblyai.com/v3/ws，参数走 query string
 * - 鉴权用临时 token 作 query 参数（token 由 /api/aai-token 签发，一次性）
 * - 客户端→服务端只有一种消息：{"type":"Terminate"}
 * - 服务端→客户端：Begin / Turn / Termination，以及可能的错误事件
 * - ⚠️ 计费按「连接时长」而非音频量 —— 未正常关闭的会话按满 3 小时计费，
 *   所以任何退出路径（手动停止 / 组件卸载 / pagehide）都必须 Terminate
 *
 * ⚠️ 实测（2026-09-28，用假 key 探过）：**token 无效时 WebSocket 握手照样返回
 * 101 Switching Protocols**，错误是在连接建立之后才以事件形式抛出来的。
 * 因此「握手成功」不等于「鉴权通过」：
 * - 必须等 `Begin` 事件才算真正连上，超时未收到就判定失败；
 * - 必须处理连接内的错误事件，否则 UI 会永远卡在「聆听中」；
 * - `onclose` 必须在 await 之前就挂上，否则握手后立即断开会被漏掉。
 */

const WORKLET_URL = "/aai-pcm-worklet.js";
const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const SPEECH_MODEL = "universal-3-5-pro";
const CONNECT_TIMEOUT_MS = 10000;
/** 握手成功后等 `Begin` 的上限；收不到基本就是 token 无效 */
const BEGIN_TIMEOUT_MS = 8000;
/** Terminate 之后留一点时间收尾包（官方提示：要留够时间收最后一个 final） */
const DRAIN_MS = 400;

interface TurnEvent {
  type: "Turn";
  turn_order: number;
  end_of_turn: boolean;
  transcript: string;
}

function detectSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined"
  );
}

export interface AssemblyAIStream {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useAssemblyAIStream(): AssemblyAIStream {
  const supported = useSyncExternalStore(
    () => () => {},
    detectSupported,
    () => false
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastTurnRef = useRef(-1);
  /** 会话是否已收到 Begin —— 用来判定「握手成功但鉴权失败」 */
  const beganRef = useRef(false);

  /** 拆掉整条链路。所有退出路径都收敛到这里，避免漏关导致按满时长计费。 */
  const teardown = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Terminate" }));
        }
      } catch {
        /* 连接已断，忽略 */
      }
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
      }, DRAIN_MS);
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

    setListening(false);
    setInterim("");
  }, []);

  // 用户关页 / 切走标签页也必须终止（用 pagehide，不用 beforeunload：移动端 Safari 后者不可靠）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => teardown();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [teardown]);

  // 组件卸载
  useEffect(() => teardown, [teardown]);

  const start = useCallback(() => {
    if (listening || wsRef.current) return;
    setError(null);
    setTranscript("");
    setInterim("");
    lastTurnRef.current = -1;
    beganRef.current = false;
    setListening(true);

    void (async () => {
      try {
        // 1) 先要麦克风权限 —— 可能弹窗、用户手慢，所以放在换 token 之前
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = media;

        // 2) 服务端持 Key 换一次性 token
        const res = await fetch("/api/aai-token", { cache: "no-store" });
        const data = (await res.json()) as { token?: string; error?: string };
        if (!res.ok || !data.token) {
          throw new Error(data.error ?? "获取 AssemblyAI token 失败");
        }

        // 3) 音频图：麦克风 → AudioWorklet(转 Int16) → WebSocket
        const ctx = new AudioContext({ sampleRate: 16000 });
        ctxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume();
        await ctx.audioWorklet.addModule(WORKLET_URL);

        const url = new URL(WS_BASE);
        url.searchParams.set("speech_model", SPEECH_MODEL);
        // 用实际采样率建连，避免重采样（浏览器可能不采纳请求的 16000）
        url.searchParams.set("sample_rate", String(ctx.sampleRate));
        url.searchParams.set("token", data.token);

        const ws = new WebSocket(url.toString());
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        /** 连接期失败只 reject 一次，避免 onerror + onclose 双触发 */
        let settled = false;
        let rejectConnect: ((e: Error) => void) | null = null;
        const failConnect = (msg: string) => {
          if (settled) return;
          settled = true;
          rejectConnect?.(new Error(msg));
        };

        /** Begin 到达即 resolve；连接提前关闭也 resolve（由调用方看 beganRef 判定） */
        let resolveBegin: (() => void) | null = null;
        const beginPromise = new Promise<void>((resolve) => {
          resolveBegin = resolve;
        });

        ws.onmessage = (ev: MessageEvent) => {
          let msg: { type?: string; error?: string; message?: string };
          try {
            msg = JSON.parse(String(ev.data)) as typeof msg;
          } catch {
            return; // 非 JSON 帧，忽略
          }
          const type = msg.type ?? "";

          if (type === "Begin") {
            beganRef.current = true;
            resolveBegin?.();
            return;
          }
          if (type === "Termination") {
            // 服务端主动结束会话：不要留在「聆听中」状态
            wsRef.current = null;
            setListening(false);
            setInterim("");
            return;
          }
          if (type === "Turn") {
            const turn = msg as unknown as TurnEvent;
            if (turn.end_of_turn) {
              // 同一轮可能重复推送，按 turn_order 去重
              if (turn.turn_order <= lastTurnRef.current) return;
              lastTurnRef.current = turn.turn_order;
              setTranscript((prev) => prev + turn.transcript);
              setInterim("");
            } else {
              setInterim(turn.transcript);
            }
            return;
          }
          // 其余一律按错误事件处理：握手成功不代表鉴权通过，错误是在连接内抛的
          const detail = msg.error ?? msg.message ?? type;
          if (detail) failConnect(`AssemblyAI 错误：${String(detail).slice(0, 120)}`);
        };

        ws.onerror = () => failConnect("连接 AssemblyAI 失败");

        // ⚠️ onclose 必须在 await 之前挂：握手后立即断开的话，晚挂就漏了
        ws.onclose = (ev: CloseEvent) => {
          wsRef.current = null;
          resolveBegin?.();
          if (!beganRef.current) {
            failConnect(
              `AssemblyAI 在会话开始前断开（code ${ev.code}${
                ev.reason ? ` ${ev.reason.slice(0, 80)}` : ""
              }）`
            );
            setListening(false);
            setInterim("");
            return;
          }
          setListening(false);
          setInterim("");
        };

        await new Promise<void>((resolve, reject) => {
          rejectConnect = reject;
          const timer = setTimeout(() => reject(new Error("连接 AssemblyAI 超时")), CONNECT_TIMEOUT_MS);
          ws.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        settled = true;

        // 握手成功 ≠ 鉴权通过：必须等到 Begin 才算真正连上
        await Promise.race([
          beginPromise,
          new Promise<void>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error("AssemblyAI 未返回 Begin（临时 token 可能无效或已过期）")),
              BEGIN_TIMEOUT_MS
            )
          ),
        ]).catch((err: unknown) => {
          throw err instanceof Error ? err : new Error("AssemblyAI 未开始会话");
        });
        if (!beganRef.current) {
          throw new Error("AssemblyAI 未返回 Begin（临时 token 可能无效或已过期）");
        }

        const source = ctx.createMediaStreamSource(media);
        srcRef.current = source;
        const node = new AudioWorkletNode(ctx, "aai-pcm16");
        nodeRef.current = node;
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        source.connect(node);
        // 刻意不接 destination：否则会把麦克风原声回放出来
      } catch (err) {
        setError(err instanceof Error ? err.message : "AssemblyAI 启动失败");
        teardown();
      }
    })();
  }, [listening, teardown]);

  const stop = useCallback(() => {
    teardown();
  }, [teardown]);

  return { supported, listening, transcript, interim, error, start, stop };
}
