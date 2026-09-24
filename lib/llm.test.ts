import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractDeltas, getProvider, getProviders } from "./llm";

describe("extractDeltas", () => {
  it("提取单个 data 事件的 content", () => {
    const { deltas, rest } = extractDeltas(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n'
    );
    expect(deltas).toEqual(["你好"]);
    expect(rest).toBe("");
  });

  it("拼接多个事件并忽略 [DONE]", () => {
    const input = [
      'data: {"choices":[{"delta":{"content":"A"}}]}',
      'data: {"choices":[{"delta":{"content":"B"}}]}',
      "data: [DONE]",
    ].join("\n");
    const { deltas } = extractDeltas(input + "\n");
    expect(deltas).toEqual(["A", "B"]);
  });

  it("把未换行的半行留在 rest", () => {
    const { deltas, rest } = extractDeltas(
      'data: {"choices":[{"delta":{"content":"X"}}]}\ndata: {"ch'
    );
    expect(deltas).toEqual(["X"]);
    expect(rest).toBe('data: {"ch');
  });

  it("忽略注释/心跳行与脏数据", () => {
    const input =
      ': keep-alive\n\ndata: {"choices":[{"delta":{"content":"Y"}}]}\nbad json line\n';
    const { deltas } = extractDeltas(input);
    expect(deltas).toEqual(["Y"]);
  });

  it("跨多次调用拼接（模拟网络分片）", () => {
    const a = extractDeltas('data: {"choices":[{"delta":{"content":"hel');
    expect(a.deltas).toEqual([]);
    expect(a.rest).toBe('data: {"choices":[{"delta":{"content":"hel');
    const b = extractDeltas(a.rest + 'lo"}}]}\n');
    expect(b.deltas).toEqual(["hello"]);
  });
});

describe("provider 选择", () => {
  const KEYS = [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_PROVIDER",
  ];

  beforeEach(() => {
    for (const k of KEYS) vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("未配置任何 key 时抛错且列表为空", () => {
    expect(() => getProvider()).toThrow(/未配置任何 LLM/);
    expect(getProviders()).toEqual([]);
  });

  it("按 LLM_PROVIDER 选择", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    expect(getProvider().id).toBe("deepseek");
  });

  it("custom provider 读取 LLM_BASE_URL", () => {
    vi.stubEnv("LLM_BASE_URL", "https://x/v1");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_MODEL", "m");
    const p = getProvider();
    expect(p.id).toBe("custom");
    expect(p.baseURL).toBe("https://x/v1");
  });

  it("无 LLM_PROVIDER 时取第一个可用", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk");
    expect(getProvider().id).toBe("openai");
  });
});
