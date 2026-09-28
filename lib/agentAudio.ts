/**
 * Voice Agent 音频常量。
 *
 * 单独成模块是为了让浏览器端（`lib/useVoiceAgent.ts`）也能引用采样率，
 * 而不用把整个 `lib/voiceAgent.ts`（含系统提示词、工具定义、process.env 读取）
 * 拖进客户端包。
 */

/** Voice Agent API 的 PCM16 约定采样率：上下行都是 24kHz */
export const AGENT_SAMPLE_RATE = 24000;

/** 上行打包帧长：40ms @ 24kHz。太短会让 WebSocket 消息过密，太长会增加延迟 */
export const AGENT_FRAME_SAMPLES = 960;
