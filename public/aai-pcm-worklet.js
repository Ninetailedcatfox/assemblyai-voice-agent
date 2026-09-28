// AssemblyAI Realtime STT 要的是 mono 16-bit PCM，而麦克风拿到的是 Float32。
// 放在 AudioWorklet 里转换 = 在音频线程上做，不占主线程、不卡 UI。
class Pcm16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    // 转移所有权，避免拷贝
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("aai-pcm16", Pcm16Processor);
