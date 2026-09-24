import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prompt-to-World · AI 观场起卦",
  description: "用自然语言生成可交互的浏览器 3D 卦境，并探索场景对象的 AI 解读。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
