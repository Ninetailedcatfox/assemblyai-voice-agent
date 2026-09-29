# lablab.ai 提交文案 — AssemblyAI Voice Agent Hackathon

> 截止：**2026-09-30 15:00 UTC = 北京时间 23:00**（官网写的是 Sep 30 7:00 PM Gulf Standard Time，UTC+4）。
> 提交页字段：Project title / Short description / Long description / Technology & category tags /
> Cover image / Video presentation / Slide presentation / Public GitHub repository /
> Demo application platform / Application URL。
> 评分四项：Application of Technology、Presentation、Business Value、Originality。
> 规则里写明「Submissions must be original and MIT-compliant」—— 仓库已是 MIT。

下面「填表值」直接复制粘贴即可。字符数已用脚本核对。

---

## 1. Project title

**填表值（47 字符，上限 50）：**

```
VoiceQuote — Voice Inquiry to Landed-Cost Quote
```

备选（若被拒或想换）：
- `VoiceQuote: Speak the Inquiry, Ship the Quote`（45 字符）
- `VoiceQuote — Spoken Inquiry to Export Quotation`（46 字符）

> 中文对照：语音询盘 → 到岸成本报价单

---

## 2. Short description

**填表值（242 字符，上限 255）：**

```
Speak a cross-border buyer inquiry in Chinese. AssemblyAI's Voice Agent API listens, routes JSON-Schema tools, and a deterministic engine computes landed cost — then the agent speaks the risks back and writes a client-ready English quotation.
```

> 中文对照：面向跨境贸易的语音优先 Agent。用中文口述一段买家询盘，AssemblyAI Voice Agent API 负责听、决定调什么工具，本地确定性引擎算出到岸成本；Agent 把风险口播回来，同时屏幕上落一份可以直接转发给海外买家的英文报价单。

---

## 3. Long description

**填表值（英文，451 词 / 2,959 字符；下限是 100 词）：**

```
## The problem

A cross-border sourcing agent gets a WhatsApp voice message from an overseas buyer: "US Amazon private-label seller, 5,000 units of IMD-pattern cases for iPhone 16 Pro Max, target price $1.10, needs it in a US warehouse within two weeks."

Answering it means matching the product line, converting a factory-gate price into a landed cost — freight, volumetric weight, duty, MOQ breaks, sampling and production lead times, IP-authorisation exposure — and writing it up in English. Today that is 20 to 40 minutes of spreadsheet work per inquiry, and the numbers get re-derived by hand every time.

## What we built

VoiceQuote turns that into one conversation. A salesperson speaks the inquiry in Chinese. The agent listens, decides which tools to call, computes the quotation, speaks the result back — including the risks — and puts a client-ready English quotation on screen.

## How AssemblyAI is used

The whole voice loop runs over a single WebSocket to the Voice Agent API at wss://agents.assemblyai.com/v1/ws. One connection carries streaming STT (Universal-3 Pro), LLM routing, and TTS, so there is no third-party glue between them.

We publish an agent object once via POST /v1/agents: system prompt, voice, greeting, 26 domain keyterms (FOB, CIF, DDP, MOQ, volumetric weight, landed cost, authorisation chain, MagSafe, IMD), and two JSON-Schema tools. The model decides when to call analyze_inquiry and generate_quotation; the browser executes them and returns results on the same socket. We also read GET /v1/sessions/{id} to pull the per-turn timeline — time_to_first_audio_ms and each tool call's duration — which is where the numbers in our video come from.

## The design decision that matters

Every number in the quotation comes from a pure function, never from a language model. The model may listen, decide and speak; it may not invent a price.

This was not our starting point. The first version asked the LLM to write the whole quotation and it failed in ways that would be unacceptable in a commercial document: a 3,924-character quotation was silently truncated to 356 characters mid-sentence, and numbers drifted between runs. We rewrote the engine so the document is generated deterministically, then self-checked: the generator rejects its own output if the client-facing part contains Chinese, is under 600 characters, has no price, omits the Incoterm, misses key clauses, or ends mid-sentence.

## Measured, not claimed

Against the live deployment: session.ready in 0.58 s, 336 ms time-to-first-audio on the greeting, 2/2 tool calls succeeded with no timeouts, and the engine emitted a 4,241-character client-facing quotation containing zero Chinese characters. 176 unit tests pass across 16 files.

## Who it is for

Any exporter whose sales desk quotes from spoken inquiries: phone accessories, consumer electronics, apparel, hardware. The catalogue is a plug-in — the voice loop and the pricing engine are generic.
```

> 中文对照见本文件末尾「中文摘要」。

---

## 4. Technology tags

```
AssemblyAI Voice Agent API
AssemblyAI Universal-3 Pro (streaming STT)
WebSocket
JSON-Schema tool calling
Next.js
React
TypeScript
Tailwind CSS
Vercel
```

## 5. Category tags

```
Voice AI
Audio & Speech
Business Tools
E-commerce
Productivity
```

> lablab.ai 的 tag 是下拉选择，上面是优先项；页面上没有的项就选最接近的
> （例如没有 "E-commerce" 就选 "Business"）。**务必至少选中 "AssemblyAI" 与 "Voice Agent" 相关的官方 tag**，否则技术分容易被判为不相关。

---

## 6. Cover image

`submission/VoiceQuote-cover.png` — 1920×1080（16:9），已在仓库内。

## 7. Video presentation

`submission/VoiceQuote-demo.mp4` — 239 秒（3 分 59 秒），10.6 MB。
限制是 **<5 分钟且 <300 MB**，两条都满足。
全程中文旁白 + 烧录字幕；第 4 幕是**未经剪辑的真实会话原声**。

## 8. Slide presentation

`submission/VoiceQuote-deck.pdf` — 10 页，1440×810，327 KB。

---

## 9. Public GitHub repository

```
https://github.com/Ninetailedcatfox/assemblyai-voice-agent
```

## 10. Demo application platform

```
Vercel
```

## 11. Application URL

```
https://assemblyai-voice-agent-six.vercel.app
```

> 落地页会介绍项目并给出进入按钮；语音 Demo 的直达地址是
> `https://assemblyai-voice-agent-six.vercel.app/agent`。
> 需要在浏览器里授予麦克风权限；页面检测不到 `ASSEMBLYAI_API_KEY` 时会明确提示，不会假装在跑。

---

## 中文摘要（给自己核对用）

**一句话**：外贸业务员对着麦克风说一段中文询盘，Agent 听完自己决定调哪些工具，
用本地确定性引擎算出到岸成本，把结论和风险用语音讲回来，同时在屏幕上落一份
可以直接转发给海外买家的英文报价单。

**为什么值得做**：一单询盘现在要 20–40 分钟手工算价成稿，而且每次都要重算；
算错的代价是直接亏钱（体积重计费、关税、目标价够不够、IP 授权链）。

**技术上的关键取舍**：报价单里每个数字都来自纯函数，语言模型不允许编价格。
这是踩坑之后改的 —— 第一版让模型直接写报价单，3,924 字符的文档被静默截断成 356 字符，
两次运行数字还会漂移。

**用了 AssemblyAI 的什么**：Voice Agent API 一条 WebSocket 跑完 STT + LLM 路由 + TTS；
`POST /v1/agents` 发布 agent 定义（system prompt、音色、greeting、26 个行业 keyterm、
两个 JSON-Schema 工具）；`GET /v1/sessions/{id}` 拉逐轮 timeline 取证。

**实测数字**：session.ready 0.58 s / greeting 首字延迟 336 ms / 工具调用 2 发 2 中无超时 /
线上引擎输出 4,241 字符客户可见报价单且 0 个中文字符 / 176 个单元测试全绿。
