export interface HistoryItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

/**
 * Union local + server history by id (server wins on conflict), newest first, capped.
 */
export function mergeHistories(
  local: HistoryItem[],
  server: HistoryItem[]
): HistoryItem[] {
  const map = new Map<string, HistoryItem>();
  for (const item of local) {
    if (item && typeof item.id === "string")
      map.set(item.id, item);
  }
  for (const item of server) {
    if (item && typeof item.id === "string")
      map.set(item.id, item);
  }
  return [...map.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
}
