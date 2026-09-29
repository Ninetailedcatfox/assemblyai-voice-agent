"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 全站外壳：品牌条 + 导航 + 页面容器。
 *
 * 之前三个页面各自手搓 header，链接还不一致（/agent 叫"文字模式"、
 * /trade 叫"语音 Agent"，且都看不出当前在哪一页）。统一到这里之后，
 * 导航只有一处定义，当前页高亮由 pathname 推导。
 */

const NAV: { href: string; label: string; hint: string }[] = [
  { href: "/", label: "总览", hint: "这个项目是什么、AssemblyAI 用在哪" },
  { href: "/agent", label: "语音 Agent", hint: "语音到语音，说话即报价" },
  { href: "/trade", label: "外贸模式", hint: "文字输入，同样一条报价链路" },
  { href: "/studio", label: "写作工作台", hint: "通用写作流水线（与本项目无关的附带模块）" },
];

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
      style={{
        background:
          "linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, #22d3ee) 100%)",
        boxShadow: "0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent)",
      }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#fff" strokeWidth="2">
        <path d="M12 3v10" strokeLinecap="round" />
        <path d="M7 8v5M17 8v5" strokeLinecap="round" opacity="0.75" />
        <path d="M5 13a7 7 0 0 0 14 0" strokeLinecap="round" />
        <path d="M12 20v1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function AppShell({
  title,
  subtitle,
  status,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  /** 右上角的状态区（连接状态、引擎标识等） */
  status?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div
          className={`mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 ${
            wide ? "max-w-[1600px]" : "max-w-7xl"
          }`}
        >
          <Link href="/" className="flex items-center gap-2">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight text-ink">
              Voice Agent Studio
            </span>
          </Link>

          <nav className="flex items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5">
            {NAV.map((item) => {
              const on = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.hint}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-[0.55rem] px-2.5 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "bg-raised text-ink shadow-sm"
                      : "text-muted hover:text-ink-2"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">{status}</div>
        </div>
      </header>

      <div
        className={`mx-auto w-full flex-1 px-5 py-4 ${wide ? "max-w-[1600px]" : "max-w-7xl"}`}
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>}
          </div>
          <span className="chip chip-accent" title="AssemblyAI Voice Agent Hackathon 2026">
            AssemblyAI Voice Agent Hackathon
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
