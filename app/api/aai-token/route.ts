export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AssemblyAI 临时 Token 签发（路线 B：Realtime STT）。
 *
 * 为什么需要这一层：Vercel Serverless 撑不住长连 WebSocket，
 * 所以后端只负责"签发"，浏览器拿 token 直连 AAI —— API Key 不落前端。
 *
 * ⚠️ 这是 streaming 那套端点，和 Voice Agent API 完全不同（混用直接 401）：
 *    Realtime STT  : GET https://streaming.assemblyai.com/v3/token   Header: Authorization: <KEY>（无 Bearer）
 *    Voice Agent   : GET https://agents.assemblyai.com/v1/token      Header: Authorization: Bearer <KEY>
 *
 * ⚠️ 实测（2026-09-28，用假 key 探过）：这个端点用**两种写法都返回同样的
 * `404 {"detail":"Invalid API key"}`**，所以「带不带 Bearer」无法从错误响应区分。
 * 官方文档写的是不带 Bearer，但为了不让这一处写法差异变成上线时的拦路虎，
 * 这里按顺序两种都试 —— 谁签发成功就用谁。
 */
const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

/** 两种鉴权写法，按官方文档的顺序 */
const AUTH_FORMS: { label: string; value: (key: string) => string }[] = [
  { label: "raw", value: (key) => key },
  { label: "bearer", value: (key) => `Bearer ${key}` },
];

/**
 * 兑换窗口：客户端必须在此秒数内建立 WebSocket 连接（官方允许 1–600）。
 * 默认 60 偏紧 —— 浏览器要先弹麦克风授权，用户手慢就会"token 刚拿到就失效"。
 */
const EXPIRES_IN_SECONDS = 300;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY ?? "";

  // ?check=1 只做可用性探测，不签发 token（首屏用它决定用 AAI 还是降级）
  const checkOnly = new URL(request.url).searchParams.get("check") === "1";

  if (!apiKey) {
    return json(
      { available: false, error: "未配置 ASSEMBLYAI_API_KEY（见 .env.example）" },
      503
    );
  }
  if (checkOnly) return json({ available: true });

  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(EXPIRES_IN_SECONDS));

  let lastStatus = 0;
  let lastDetail = "";

  for (const form of AUTH_FORMS) {
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        headers: { Authorization: form.value(apiKey) },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      return json(
        {
          available: true,
          error: `连接 AssemblyAI 失败：${err instanceof Error ? err.message : "未知错误"}`,
        },
        502
      );
    }

    if (!upstream.ok) {
      lastStatus = upstream.status;
      lastDetail = await upstream.text().catch(() => "");
      continue; // 换下一种鉴权写法
    }

    const data = (await upstream.json()) as { token?: unknown };
    if (typeof data.token === "string" && data.token) {
      return json({
        token: data.token,
        expiresInSeconds: EXPIRES_IN_SECONDS,
        authForm: form.label,
      });
    }
    lastStatus = 502;
    lastDetail = "上游返回 200 但没有 token 字段";
  }

  return json(
    {
      available: true,
      error: `AssemblyAI token 签发失败 (${lastStatus})`,
      detail: lastDetail.slice(0, 300),
    },
    502
  );
}
