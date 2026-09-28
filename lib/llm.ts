export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface Provider {
  id: "deepseek" | "openai" | "gemini" | "custom";
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

function buildProviders(): Provider[] {
  return [
    {
      id: "deepseek",
      label: "DeepSeek",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    },
    {
      id: "openai",
      label: "OpenAI",
      baseURL: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    },
    {
      id: "gemini",
      label: "Gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY ?? "",
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    },
    {
      id: "custom",
      label: "自定义代理",
      baseURL: process.env.LLM_BASE_URL ?? "",
      apiKey: process.env.LLM_API_KEY ?? "",
      model: process.env.LLM_MODEL ?? "",
    },
  ];
}

export function getProviders(): Provider[] {
  return buildProviders().filter((p) => p.apiKey.length > 0);
}

export function getProvider(id?: string): Provider {
  const available = getProviders();
  const active =
    available.find((p) => p.id === id) ??
    available.find((p) => p.id === process.env.LLM_PROVIDER) ??
    available[0];
  if (!active) {
    throw new Error(
      "未配置任何 LLM API Key。请复制 .env.example 为 .env.local 并填写。"
    );
  }
  return active;
}

export interface ChatOptions {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * 连接阶段（等首字节 TTFB）的超时，毫秒。
   * 默认 30s —— 实测该代理快模型 TTFB 中位数 ~7s，30s 足够，
   * 且必须显著小于 Vercel 函数上限（60s），否则超时表现是 504 而不是优雅降级。
   */
  timeoutMs?: number;
  /** 生成阶段的总时长上限，毫秒。默认 120s。 */
  totalMs?: number;
  /** 首次调用失败（抛错或返回空）时的总尝试次数。默认 2。 */
  attempts?: number;
}

/**
 * 从一段 SSE 文本中提取增量内容。
 * - 仅处理 `data:` 开头的行，忽略注释/心跳行
 * - 跳过 `[DONE]` 与无法解析的行
 * - 未换行的最后一行留在 `rest` 中，交由下一次调用拼接
 */
export function extractDeltas(input: string): {
  deltas: string[];
  rest: string;
} {
  const lines = input.split("\n");
  const rest = lines.pop() ?? "";
  const deltas: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const delta: unknown = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) deltas.push(delta);
    } catch {
      // 心跳或脏数据，忽略
    }
  }
  return { deltas, rest };
}

/**
 * 非流式单次调用：用于意图识别、建议卡等需要完整返回的场景。
 * 内部走 streamChat 流式通道（该代理对流式更友好，且能复用空闲超时保护），
 * 聚合为完整文本。
 *
 * **失败一律重试**：实测该代理约 1/6 的请求会快速返回 400（上游 geo 限制）
 * 或吐一段自言自语而不给 JSON。前者 1.7s 就失败，重试一次即可救回；
 * 不重试等于白送一次降级。最后一次仍失败才抛错，由调用方决定兜底策略。
 */
export async function chatOnce(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const call = async (): Promise<string> => {
    const stream = await streamChat(messages, {
      ...options,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 1024,
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out;
  };

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await call();
      if (out.trim()) return out;
      lastError = new Error("模型返回空内容");
    } catch (err) {
      lastError = err;
    }
    // 最后一次不必再等
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型调用失败");
}

export async function streamChat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const provider = getProvider(options.provider);
  const controller = new AbortController();
  // 实测该代理快模型 TTFB 中位数 ~7s（慢别名 gemini-3.7-flash 要 45s，已弃用）。
  // 连接 30s、空闲 30s、总时长 120s —— 三者都必须留在部署平台函数上限之内，
  // 否则上游还没超时，平台先把整个请求掐了，前端只会看到连接被重置。
  const CONNECT_MS = options.timeoutMs ?? 30000;
  const IDLE_MS = 30000;
  const TOTAL_MS = options.totalMs ?? 120000;
  let userAborted = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_MS);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_MS);
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      // 连接阶段单独给 CONNECT_MS，空闲计时从出流后才开始
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CONNECT_MS)]),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? provider.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      }),
    });
  } catch (err) {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (!userAborted && controller.signal.aborted) {
      throw new Error("连接上游超时：代理迟迟未响应，请重试或更换模型");
    }
    throw err;
  }
  resetIdle();

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${upstream.status}): ${detail.slice(0, 300)}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      const reader = upstream.body!.getReader();
      const flush = () => {
        const { deltas, rest } = extractDeltas(buffer);
        buffer = rest;
        for (const d of deltas) streamController.enqueue(encoder.encode(d));
      };
      let errored = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdle(); // 收到新块即重置空闲计时
          buffer += decoder.decode(value, { stream: true });
          flush();
        }
      } catch (err) {
        errored = true;
        if (userAborted) {
          streamController.error(err);
        } else if (controller.signal.aborted) {
          streamController.error(
            new Error("生成超时：上游连接空闲过久，请重试或更换模型")
          );
        } else {
          streamController.error(err);
        }
      } finally {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        flush(); // 处理末尾未换行的完整事件
        if (!errored) streamController.close();
      }
    },
    cancel() {
      userAborted = true;
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      controller.abort();
    },
  });
}
