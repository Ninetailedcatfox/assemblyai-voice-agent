# Voice Agent Studio — 语音报价 Agent

Submission for the **AssemblyAI Voice Agent Hackathon 2026**.

A voice-first agent for cross-border trade: a Chinese export salesperson
**speaks** a buyer inquiry out loud, and the agent listens, decides which tools
to call, computes a landed-cost quotation, and **speaks the result back** — then
puts a client-ready English quotation on screen.

**Live demo:** <https://assemblyai-voice-agent-phi.vercel.app/agent>

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

Measured against the real HTTP routes on this machine (`next start`, one request
each, no LLM in the path):

| Route | Time | Result |
|---|---|---|
| `POST /api/quote/analyze` | **0.08 s** | 3 product lines matched, 2 risk flags, `source: "rules"` |
| `POST /api/quote` | **0.16 s** | a complete **3,924-character** quotation, zero Chinese characters in the client-facing part |
| `POST /api/quote` (revision) | **0.03 s** | **4,190 characters**, `-R1` + `REVISION NOTICE`, order quantity held at 5,000 while 500 is treated as a sample |

- **145 unit tests passing** (`npm test`) covering the quotation generator, the
  revision parser, the tool contracts, the token route and the publish route.
- `X-Quote-Source: generated` verified on the wire — the UI badge reads this
  header rather than assuming.
- The LLM path this engine replaced took **12.5 s** and returned a
  **356-character truncation** of a 3,924-character document.
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
