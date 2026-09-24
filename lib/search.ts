export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProviderId = "tavily" | "bocha";

/** 检索默认关闭：配置 TAVILY_API_KEY 或 BOCHA_API_KEY 后自动启用 */
export function getSearchProviderId(): SearchProviderId | null {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BOCHA_API_KEY) return "bocha";
  return null;
}

interface RawItem {
  title?: unknown;
  name?: unknown;
  url?: unknown;
  content?: unknown;
  snippet?: unknown;
  summary?: unknown;
}

/** Tavily 返回 results[]；博查返回 data.webPages.value[]，统一归一化 */
export function normalizeItems(items: unknown): SearchResult[] {
  if (!Array.isArray(items)) return [];
  const out: SearchResult[] = [];
  for (const raw of items) {
    const it = raw as RawItem;
    const title = typeof it.title === "string" ? it.title : typeof it.name === "string" ? it.name : "";
    const url = typeof it.url === "string" ? it.url : "";
    const snippet =
      typeof it.content === "string"
        ? it.content
        : typeof it.summary === "string"
        ? it.summary
        : typeof it.snippet === "string"
        ? it.snippet
        : "";
    if (title && url) out.push({ title, url, snippet: snippet.slice(0, 300) });
  }
  return out;
}

/** 检索失败一律返回空数组：检索是增强项，不能阻塞写作主流程 */
export async function searchWeb(query: string, count = 5): Promise<SearchResult[]> {
  const provider = getSearchProviderId();
  const q = query.trim();
  if (!provider || !q) return [];
  try {
    if (provider === "tavily") {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: q,
          max_results: count,
          search_depth: "basic",
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: unknown };
      return normalizeItems(data.results);
    }
    const res = await fetch("https://api.bochaai.com/v1/web-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BOCHA_API_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ query: q, count, summary: true }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { webPages?: { value?: unknown } } };
    return normalizeItems(data.data?.webPages?.value);
  } catch {
    return [];
  }
}

/** 把检索结果格式化为可注入 prompt 的编号资料块 */
export function formatResearch(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.snippet}\n    来源: ${r.url}`)
    .join("\n");
}
