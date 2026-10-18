/**
 * Microphone capture for the sustained-vowel test. Browser audio processing
 * (noise suppression, echo cancellation, auto-gain) is switched OFF because it
 * would distort jitter, shimmer and HNR. Audio never leaves the device.
 */
import { analyzeVoice, livePitch } from './voice-core.mjs';

export class VoiceRecorder {
  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  async start({ maxSeconds = 15, onLevel = () => {} } = {}) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // iOS Safari can create the context suspended once the tap's gesture is consumed by getUserMedia.
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch { /* proceed; level meter will show silence */ } }
    this.chunks = [];
    this.total = 0;
    const src = this.ctx.createMediaStreamSource(this.stream);
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // keep the graph running without playing the mic back
    sink.connect(this.ctx.destination);
    try {
      await this.ctx.audioWorklet.addModule('/lib/voice-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'nadi-capture');
      this.node.port.onmessage = (e) => this.push(e.data);
    } catch {
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (e) => this.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    src.connect(this.node);
    this.node.connect(sink);
    this.sampleRate = this.ctx.sampleRate;
    this.started = performance.now();
    this.voicedMs = 0;
    this.silentMs = 0;

    return new Promise((resolve) => {
      this.resolve = resolve;
      this.timer = setInterval(() => {
        const elapsed = (performance.now() - this.started) / 1000;
        const tail = this.tail(Math.round(this.sampleRate * 0.06));
        const lp = tail.length ? livePitch(tail, this.sampleRate) : { f0: 0, rms: 0 };
        const voiced = lp.f0 > 0 && lp.rms > 0.004;
        if (voiced) { this.voicedMs += 100; this.silentMs = 0; } else if (this.voicedMs > 0) this.silentMs += 100;
        onLevel({ rms: lp.rms, f0: lp.f0, voiced, elapsed, voicedS: this.voicedMs / 1000 });
        // Auto-stop: the person ran out of breath (≥1.5 s of voice then 1.2 s of silence) or the cap is reached.
        if ((this.voicedMs >= 1500 && this.silentMs >= 1200) || elapsed >= maxSeconds) this.stop();
      }, 100);
    });
  }

  push(chunk) {
    this.chunks.push(chunk);
    this.total += chunk.length;
  }

  tail(n) {
    const out = new Float32Array(Math.min(n, this.total));
    let k = out.length;
    for (let c = this.chunks.length - 1; c >= 0 && k > 0; c--) {
      const ch = this.chunks[c];
      const take = Math.min(k, ch.length);
      out.set(ch.subarray(ch.length - take), k - take);
      k -= take;
    }
    return out;
  }

  stop() {
    if (!this.resolve) return;
    clearInterval(this.timer);
    const all = new Float32Array(this.total);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    this.close();
    let result;
    try { result = analyzeVoice(all, this.sampleRate); } catch (e) { result = { ok: false, message: String(e.message || e) }; }
    const resolve = this.resolve;
    this.resolve = null;
    resolve(result);
  }

  close() {
    clearInterval(this.timer);
    try { this.node && this.node.disconnect(); } catch { /* ignore */ }
    if (this.stream) for (const tr of this.stream.getTracks()) tr.stop();
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
    this.stream = null;
  }
}
