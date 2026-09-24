"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 浏览器语音识别（Web Speech API）封装。
 * - lang 默认中文 zh-CN
 * - 实时返回已确认文本(transcript) 与临时文本(interim)
 * - 不支持的浏览器 supported=false
 */
function detectSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function useSpeechRecognition(lang = "zh-CN") {
  const supported = useSyncExternalStore(
    () => () => {},
    detectSupported,
    () => false
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const Ctor = getCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText) setTranscript((prev) => prev + finalText);
      setInterim(interimText);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };

    recRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* 忽略重复 stop */
      }
    };
  }, [lang]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec || listening) return;
    setTranscript("");
    setInterim("");
    try {
      rec.start();
      setListening(true);
    } catch {
      /* 部分浏览器在连续 start 时会抛错，忽略 */
    }
  }, [listening]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* 忽略 */
    }
    setListening(false);
    setInterim("");
  }, []);

  return { supported, listening, transcript, interim, start, stop };
}
