# Voice Agent Studio — 语音报价 Agent

Submission for the **AssemblyAI Voice Agent Hackathon 2026**.

A voice-first agent for cross-border trade: a Chinese export salesperson
**speaks** a buyer inquiry out loud, and the agent listens, decides which tools
to call, computes a landed-cost quotation, and **speaks the result back** — then
puts a client-ready English quotation on screen.

**Live demo:** <https://assemblyai-voice-agent-six.vercel.app>
— the landing page explains the project; the voice agent itself is at
<https://assemblyai-voice-agent-six.vercel.app/agent>.

**Video (3:59):** [`submission/VoiceQuote-demo.mp4`](submission/VoiceQuote-demo.mp4)
· **Slides:** [`submission/VoiceQuote-deck.pdf`](submission/VoiceQuote-deck.pdf)
· **Cover:** [`submission/VoiceQuote-cover.png`](submission/VoiceQuote-cover.png)

---

## The problem

A sourcing agent gets a WhatsApp voice message from an overseas buyer:

> "US Amazon private-label seller, 5,000 units of IMD-pattern cases for iPhone 16
> Pro Max, target price $1.10, needs it in a US warehouse within two weeks."

Producing an answer means matching the product line, converting a factory-gate
price into a landed cost (freight, volumetric weight, duty, MOQ breaks, sample
and production lead times, IP-authorisation exposure), and writing it up in
English. Today that is 20–40 minutes of spreadsheet work per inquiry, and the
numbers get re-derived by hand every time.

## What this does

Everything above, by voice, in one conversation.

| Step | Who does it |
|---|---|
| Hear the inquiry | **AssemblyAI Voice Agent API** (streaming STT) |
| Decide what to do | **AssemblyAI-managed LLM** + JSON-Schema tool calling |
| Compute the numbers | **Local deterministic engine** (no LLM) |
| Say the result back | **AssemblyAI Voice Agent API** (TTS) |
| Show the quotation | Next.js UI |

## Routes

| Path | What it is |
|---|---|
| `/` | Landing page — what the project is, how AssemblyAI is used, the measured numbers |
| `/agent` | **The voice agent.** Mic in, spoken quotation out, document on screen |
| `/trade` | The same pricing pipeline without a microphone — type the inquiry instead |
| `/studio` | A general-purpose writing pipeline. Incidental to this submission; kept because the shell is shared |

## Submission artifacts

| File | |
|---|---|
| `submission/VoiceQuote-demo.mp4` | 3:59 demo — Chinese narration, burned-in subtitles, scene 4 is unedited session audio |
| `submission/VoiceQuote-deck.pdf` | 10-slide deck |
| `submission/VoiceQuote-cover.png` | 1920×1080 cover |
| `submission/sess_*.timeline.json` | The raw Voice Agent session timeline behind the video's numbers |
| `submission/lablab-submission.md` | The submission copy |

## How AssemblyAI is used

The whole voice loop runs over a **single WebSocket** to the
[Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api) —
`wss://agents.assemblyai.com/v1/ws`. One connection carries STT, LLM routing and
TTS, so there is no third-party glue between them.

- **`POST /v1/agents`** publishes the agent definition once: system prompt,
  voice, greeting, 26 domain keyterms (`FOB`, `CIF`, `DDP`, `MOQ`, `体积重`,
  `到岸成本`, `授权链`, `MagSafe`, `IMD`, …) and two JSON-Schema tools.
  `app/api/voice-agent/publish/route.ts`
- **`GET /api/voice-agent`** mints a single-use token (300 s redemption window,
  1200 s session cap) and returns the published `agent_id`.
  `app/api/voice-agent/route.ts`
- **Client → server:** `session.update`, `input.audio` (base64 PCM16 @ 24 kHz),
  `tool.result`, `session.end`. `lib/useVoiceAgent.ts`
- **Server → client:** `session.ready`, `transcript.user.delta`, `reply.audio`,
  `tool.call`, `reply.done`, `session.error`.

### Tool calling

Two client-executed tools are declared to the model (`lib/voiceAgent.ts`):

- `analyze_inquiry(inquiry)` — parse the inquiry, match the product catalogue,
  compute landed cost per unit
- `generate_quotation(inquiry, revision_instruction?)` — emit the English
  quotation, or re-price it from a spoken correction

The agent decides **when** to call them. The browser executes them and returns
the result on the same socket.

Protocol details that are easy to get wrong and are handled explicitly:

- `input.audio` may only be sent **after `session.ready`**.
- `tool.result` must be sent only once the matching `reply.done` has arrived —
  the tool-call turn carries `reply_id = "fc-<call_id>"`.
- Teardown sends `session.end` before closing. A bare `ws.close()` leaves the
  session in the 30-second `session.resume` grace window, **which is billable**.
- A token has a *redemption window* (`expires_in_seconds`) separate from the
  *session cap* (`max_session_duration_seconds`). Letting the former elapse
  yields `session.error` code `unauthorized` instead of `session.ready`.

## The design decision that matters

**Every number in the quotation comes from a pure function, never from a
language model.** The LLM is allowed to listen, decide and speak — it is not
allowed to invent a price.

This was not the starting point. The first version asked the LLM to write the
whole quotation and it failed in ways that would be unacceptable in a commercial
document: a 3,924-character quotation was silently truncated to 356 characters
mid-sentence, and numbers drifted between runs. The engine was rewritten so that:

- `lib/quoteDocument.ts` — deterministic quotation generator, pure function
- `lib/products.ts` — 16-SKU phone-accessory catalogue with real
  Huaqiangbei factory-gate / FOB / volumetric-weight / duty figures
- `lib/revision.ts` — structured parser for spoken repricing ("drop it to
  $1.00 and make it DDP"), including a sample-vs-order quantity guard
- `lib/quoteDocument.ts:assessQuoteText()` — a **self-check** that rejects its
  own output if it contains Chinese characters, is under 600 chars, has no `$`
  price, is missing the Incoterm, is missing key clauses, or ends mid-sentence

The LLM is still available, but only as an opt-in wording polish
(`?polish=true`), and the response carries `X-Quote-Source: ai | generated` so the
UI can never misrepresent which path produced a document.

## Architecture

```
  🎙 browser mic
      │  AudioWorklet, resampled to PCM16 24 kHz, 960-sample frames
      ▼
  wss://agents.assemblyai.com/v1/ws          ← single connection
      │   ├── STT        (Universal-3 Pro)
      │   ├── LLM        (managed)  ── tool.call ──┐
      │   └── TTS        (24 kHz PCM16 down)       │
      ▼                                            ▼
  🔊 playback bus                        POST /api/quote/analyze
     (AnalyserNode → real spectrum)      POST /api/quote
                                                 │
                                          deterministic engine
                                          (products · landed cost · doc)
```

Audio visualisation is **measured, not decorative**: the orb scale and the
32-band spectrum come from `AnalyserNode` time-domain + FFT data on both the
microphone and the playback bus. Levels are written to a ref rather than React
state so 60 fps updates cause zero re-renders.

Cross-browser audio notes: `new AudioContext({ sampleRate: 24000 })` is
Chromium-only. It breaks echo cancellation on Firefox (the mic re-captures the
agent's own voice, so the agent interrupts itself) and is ignored on Safari
(24 kHz sent as 48 kHz = garbled). The implementation therefore runs at the
default sample rate and resamples by linear interpolation **inside the worklet**,
with `echoCancellation: true` and `noiseSuppression: false` (the server already
denoises).

## Evidence

Everything below was measured, not estimated. The scripts that produced it are in
the project workspace (`_bench_live.py`, `_e2e_prod.py`, `_verify_live_fix.py`),
and the raw session timeline is checked in under `submission/`.

### The pricing engine, against the live deployment

Three requests each to the deployed routes, `POST` body `{draft: "<spoken inquiry>"}`:

| Route | Median | Result |
|---|---|---|
| `POST /api/quote/analyze` | **981 ms** | 3 product lines matched, 3 risk flags, `category: "IMD 图案壳"` |
| `POST /api/quote` | **1,130 ms** | a **4,488-character** quotation; **4,241** of those are client-facing and contain **0 Chinese characters** |

The deterministic core itself is far below those numbers — the 1-second floor is
Vercel serverless overhead, not the engine.

### One real voice session, end to end, in production

Session `sess_f7a9f0d689ec4c9d87d38d6bbedd2806` — this is the take used in the
demo video, and its timeline is checked in at
`submission/sess_f7a9f0d689ec4c9d87d38d6bbedd2806.timeline.json`.

| | |
|---|---|
| `session.ready` | **0.58 s** |
| Greeting time-to-first-audio | **336 ms** |
| STT segments for one spoken inquiry | **6** (all six landed in a single turn) |
| Tool calls | **2 / 2 succeeded**, no timeouts — `analyze_inquiry` 1,392 ms, `generate_quotation` 1,281 ms |
| Engine output | **4,488 characters**, `X-Quote-Source: generated` |
| Session duration | **53.6 s** |

The agent's spoken summary named the right product *and* all three risks:
*"iPhone 16 Pro Max 的图案壳到岸成本是 1 块 4 9 9。要提醒客户目标价差了大概 4 毛钱，
而且图案产品必须要有授权链，另外运费是按体积重算的"*.

### The quotation document

First data row — the SKU the buyer actually asked for, ranked first:

```
| IMD Printed Case for iPhone 16 Pro Max | iPhone 16 Pro Max | 5,000 pcs | $1.050 | $5250.00 |
```

The document carries `## 6. Note on Your Target Price` (states the $0.399/pc gap
rather than pretending to discount), `## 7. IP & Artwork Clearance`, the
volumetric-weight basis (`1 cbm ≈ 167 kg`) and the duty rate — and ends with an
`## Internal Notes — do not forward` section that is the only place Chinese is
allowed to appear.

### Tests

**176 unit tests across 16 files**, covering the quotation generator, the
revision parser, Chinese-numeral parsing, the tool contracts, and the token and
publish routes. `npx vitest run` → 16 passed / 176 passed.

### What the numbers replaced

The first version asked the LLM to write the whole quotation. It took **12.5 s**
and returned a **356-character truncation** of a 3,924-character document, with
numbers that drifted between runs. That is why the engine is deterministic and
the model is confined to listening, routing and speaking.

### Known limitation, stated plainly

The hosted model emits a stray clarifying question ("请告诉我具体的机型、数量和产品要求。")
*alongside* the `analyze_inquiry` tool call, even when the user has just stated
everything. This survived five configurations — four prompt rewrites and
`turn_detection.min_silence` raised from 1800 ms to 3000 ms — so it is a
model-level behaviour, not something a prompt can fix. The final prompt stops
fighting it and permits one neutral filler line instead; the take in the video is
unedited, so you can see it happen.

- Screenshots in [`docs/screenshots/`](docs/screenshots/).

## Run it

```bash
npm install
cp .env.example .env.local     # add ASSEMBLYAI_API_KEY
npm run dev                    # http://localhost:3000/agent
```

Publish the agent definition once (creates it if needed, updates if it exists):

```bash
curl -X POST https://<your-deployment>/api/voice-agent/publish \
  -H 'content-type: application/json' -d '{}'
```

| Variable | Purpose |
|---|---|
| `ASSEMBLYAI_API_KEY` | Required for the voice loop. Without it the API routes return 503 and the UI says so explicitly. |
| `ASSEMBLYAI_AGENT_ID` | Optional. Set it to reuse an already-published agent instead of creating one per cold start. |
| `VOICE_AGENT_VOICE_ID` | Optional, defaults to `alba`. |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 ·
Vitest · Vercel.

## Licence

MIT — see [LICENSE](LICENSE).
