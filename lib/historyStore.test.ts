import { describe, expect, it } from "vitest";
import { mergeHistories, type HistoryItem } from "./historyStore";

const mk = (id: string, createdAt: string, content = "c"): HistoryItem => ({
  id,
  title: id,
  content,
  createdAt,
});

describe("mergeHistories", () => {
  it("按 id 去重并保留最新在前（云端覆盖本地）", () => {
    const local = [mk("a", "2024-01-01T00:00:00Z"), mk("b", "2024-01-02T00:00:00Z")];
    const server = [mk("b", "2024-01-03T00:00:00Z", "updated")];
    const merged = mergeHistories(local, server);
    expect(merged.map((i) => i.id)).toEqual(["b", "a"]);
    expect(merged.find((i) => i.id === "b")?.content).toBe("updated");
  });

  it("空数据返回空数组", () => {
    expect(mergeHistories([], [])).toEqual([]);
  });

  it("最多保留 50 条", () => {
    const local = Array.from({ length: 60 }, (_, i) =>
      mk(`id${i}`, `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`)
    );
    expect(mergeHistories(local, []).length).toBe(50);
  });
});
