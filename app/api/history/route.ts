import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { HistoryItem } from "@/lib/historyStore";

export const runtime = "nodejs";

// Vercel 等 serverless 平台只有 /tmp 可写；本地保持项目目录持久化
const FILE = process.env.VERCEL
  ? "/tmp/history.json"
  : path.join(process.cwd(), ".data", "history.json");
const LIMIT = 200;

async function readAll(): Promise<HistoryItem[]> {
  try {
    const raw = await readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: HistoryItem[]): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(items.slice(0, LIMIT), null, 2), "utf-8");
}

export async function GET() {
  return NextResponse.json({ items: await readAll() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const item = body as Partial<HistoryItem>;
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.content !== "string" ||
    !item.content.trim()
  ) {
    return NextResponse.json({ error: "invalid item" }, { status: 400 });
  }
  const next = [
    item as HistoryItem,
    ...(await readAll()).filter((i) => i.id !== item.id),
  ].slice(0, LIMIT);
  await writeAll(next);
  return NextResponse.json({ items: next });
}
