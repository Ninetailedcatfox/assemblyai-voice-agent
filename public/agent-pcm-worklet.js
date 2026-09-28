/**
 * Voice Agent 上行采集 worklet：麦克风 Float32 → 24kHz PCM16，按帧打包。
 *
 * 为什么要重采样而不是直接 `new AudioContext({ sampleRate: 24000 })`：
 * 官方文档明确说那个快捷方式只在 Chromium 上可靠 ——
 * - Firefox：非默认采样率的 AudioContext 跑在独立音频图里，**回声消除拿不到
 *   agent 的播放信号**，于是麦克风把 agent 自己的声音收回去，agent 会打断自己，
 *   每次回答都被截断成 `status: "interrupted"`；
 * - Safari：直接忽略该选项，仍按 48kHz 跑，按 24kHz 发出去就是"花栗鼠音"。
 * 所以统一让 AudioContext 用它自己的默认采样率，在这里线性插值重采样到 24kHz。
 *
 * 打包成 ~40ms 一帧再发：不打包的话每个 128 样本块（48kHz 下 2.7ms）就是一条
 * WebSocket 消息，375 条/秒，白白烧带宽和 base64 开销。
 */
class AgentPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.inRate = o.inputSampleRate || sampleRate;
    this.outRate = o.targetSampleRate || 24000;
    this.ratio = this.inRate / this.outRate;
    /** 40ms @ 24kHz = 960 样本 */
    this.frame = o.frameSamples || 960;

    this.pending = new Float32Array(0); // 跨块残留的输入样本
    this.pos = 0; // pending 里的分数读取位置
    this.buf = new Int16Array(this.frame);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    // 把上一块没用完的尾巴和新输入接起来
    const prev = this.pending;
    const merged = new Float32Array(prev.length + ch.length);
    merged.set(prev, 0);
    merged.set(ch, prev.length);

    let pos = this.pos;
    const scratch = [];
    while (pos + 1 < merged.length) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      // 线性插值：语音够用，比官方示例的直接抽取（input[floor(i*ratio)]）干净得多
      const s = merged[i0] * (1 - frac) + merged[i0 + 1] * frac;
      scratch.push(Math.max(-32768, Math.min(32767, Math.round(s * 32767))));
      pos += this.ratio;
    }

    const consumed = Math.floor(pos);
    this.pending = merged.slice(consumed);
    this.pos = pos - consumed;

    for (let i = 0; i < scratch.length; i++) {
      this.buf[this.n++] = scratch[i];
      if (this.n === this.frame) {
        const out = this.buf;
        // 转移所有权（零拷贝），转移后原 buffer 被 detach，所以必须换一个新的
        this.port.postMessage(out.buffer, [out.buffer]);
        this.buf = new Int16Array(this.frame);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("agent-pcm16", AgentPcmProcessor);
