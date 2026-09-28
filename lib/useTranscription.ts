"use client";

import { useEffect, useState } from "react";
import { useAssemblyAIStream, type AssemblyAIStream } from "./useAssemblyAIStream";
import { useSpeechRecognition } from "./useSpeechRecognition";

export type TranscriptionEngine = "aai" | "web";

/**
 * 两个 hook 的公共契约。`error` 只有 AAI 那条链会有（Web Speech 没有错误上报），
 * 所以这里放宽成可选 —— 调用方只依赖那 6 个同名字段，不用关心当前是哪个引擎。
 */
export type TranscriptionSpeech = Omit<AssemblyAIStream, "error"> & {
  error?: string | null;
};

/**
 * 统一的转写入口：优先 AssemblyAI Realtime STT，任一环节不可用则降级浏览器 Web Speech。
 *
 * 两个 hook 接口完全一致（多一个 `error`），所以下游调用方只认 `speech`，不用分叉。
 * 降级是**硬要求**：评委点开 Demo 时必须能用，哪怕没配 AAI key 或浏览器不支持。
 */
export function useTranscription(lang = "zh-CN") {
  const aai = useAssemblyAIStream();
  const web = useSpeechRecognition(lang);
  const [engine, setEngine] = useState<TranscriptionEngine>("web");

  useEffect(() => {
    let alive = true;
    fetch("/api/aai-token?check=1", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((d) => {
        if (alive && d.available && aai.supported) setEngine("aai");
      })
      .catch(() => {
        /* 探测失败 → 保持降级，Demo 不能开天窗 */
      });
    return () => {
      alive = false;
    };
  }, [aai.supported]);

  const speech: TranscriptionSpeech = engine === "aai" ? aai : web;

  return { engine, aai, speech };
}
