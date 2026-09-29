import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoiceQuote — 语音询盘转英文报价单",
  description:
    "AssemblyAI Voice Agent Hackathon 2026 — speak a cross-border trade inquiry, " +
    "get a landed-cost quotation spoken back and a client-ready English document.",
  openGraph: {
    title: "VoiceQuote — 语音询盘转英文报价单",
    description:
      "说一句询盘，拿到一份能直接发客户的英文报价单。语音链路全部跑在 AssemblyAI Voice Agent API 上。",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
