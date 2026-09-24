import { streamChat, getProviders, getProvider, type ChatMessage } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const providers = getProviders().map((p) => ({
    id: p.id,
    label: p.label,
    model: p.model,
  }));
  let active: string | null = null;
  try {
    active = getProvider().id;
  } catch {
    active = null;
  }
  return Response.json({ providers, active });
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: {
    messages?: ChatMessage[];
    provider?: string;
    model?: string;
    temperature?: number;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求体必须是 JSON。");
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return badRequest("messages 不能为空。");
  }
  for (const m of messages) {
    if (!m || typeof m.content !== "string" || m.content.length === 0) {
      return badRequest("每条消息都需要非空 content。");
    }
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await streamChat(messages, {
      provider: body.provider,
      model: body.model,
      temperature: body.temperature,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return Response.json({ error: message }, { status: 500 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}