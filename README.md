# Voice Agent Studio

Submission for the **AssemblyAI Voice Agent Hackathon 2026**.

> **Placeholder README.** The product direction is not locked yet, so this file
> deliberately makes no product claims. It will be rewritten — problem statement,
> architecture diagram, demo links, and the exact step where AssemblyAI is used —
> once the direction is finalised.

## Status

| Area | State |
|---|---|
| Voice input → agent pipeline → export workbench | Working |
| AssemblyAI streaming STT (`lib/useAssemblyAIStream.ts`) | Not written yet |
| AssemblyAI token endpoint (`app/api/aai-token/route.ts`) | Not written yet |
| TTS read-back | Not written yet |

## Live demo

<https://assemblyai-voice-agent-phi.vercel.app>

Deployed on Vercel as a **dedicated project for this hackathon** — it shares
nothing with any other submission.

> Without `ASSEMBLYAI_API_KEY` configured, voice input falls back to the
> browser's built-in Web Speech API. The demo stays usable, but the AssemblyAI
> path is inactive (the UI shows "浏览器语音转写（降级）").

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

The app runs without any API key: the agent pipeline falls back to local
deterministic behaviour so the demo never goes dark.

## Scripts

```bash
npm test        # vitest
npm run lint    # eslint
npm run build   # next build
```

## Environment

Copy `.env.example` to `.env.local`. `.env.local` is git-ignored and must never
be committed.
