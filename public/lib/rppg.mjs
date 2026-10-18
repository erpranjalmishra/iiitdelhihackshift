/**
 * Camera capture for rPPG. Each video frame is downscaled to 160×120; inside
 * the face oval, pixels are classified as skin in YCbCr space (robust across
 * skin tones because it ignores brightness), clipped pixels are dropped, and
 * the mean skin RGB becomes one sample. Nothing leaves the device.
 */
import { analyzeRppg, liveEstimate } from './rppg-core.mjs';

const W = 160, H = 120;
// Oval in analysis coordinates — matches the overlay drawn on the preview.
export const OVAL = { cx: 0.5, cy: 0.47, rx: 0.2, ry: 0.36 };

function isSkin(r, g, b) {
  if (r > 250 || g > 250 || b > 250) return false; // clipped highlights carry no pulse
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 35) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cr >= 133 && cr <= 175 && cb >= 75 && cb <= 130;
}

export class FaceScanner {
  constructor({ video, xray = null, onStatus = () => {}, onLive = () => {}, onProgress = () => {} }) {
    this.video = video;
    this.xray = xray;
    this.onStatus = onStatus;
    this.onLive = onLive;
    this.onProgress = onProgress;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.frames = [];
    this.running = false;
    this.showXray = false;
    this.mode = 'skin';
    this.mask = this.buildMask(1, 1);
    this.innerMask = this.buildMask(0.7, 0.72);
  }

  buildMask(sx, sy) {
    const m = [];
    const cx = OVAL.cx * W, cy = OVAL.cy * H, rx = OVAL.rx * W * sx, ry = OVAL.ry * H * sy;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) m.push(y * W + x);
    return Int32Array.from(m);
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async open() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, min: 15 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    await this.video.play();
  }

  /** Start sampling. Resolves with the analysis once `seconds` of usable signal are collected. */
  start(seconds = 60) {
    this.frames = [];
    this.running = true;
    this.goodSeconds = 0;
    this.lastT = null;
    this.prevCentroid = null;
    this.motion = 0;
    this.lowSkinFrames = 0;
    this.mode = 'skin';
    this.clock = null; this.lastClock = null; this.stalled = 0;
    this.t0 = performance.now();
    return new Promise((resolve) => {
      this.finish = resolve;
      this.target = seconds;
      this.loop();
      this.liveTimer = setInterval(() => this.live(), 500);
    });
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback((now, meta) => { this.sample(this.frameTime(now, meta)); this.loop(); });
    } else {
      requestAnimationFrame(() => {
        if (v.currentTime !== this.lastMediaTime) { this.lastMediaTime = v.currentTime; this.sample(performance.now() / 1000); }
        this.loop();
      });
    }
  }

  /**
   * One clock per scan — mixing clocks would corrupt beat timing. Prefer the camera's capture
   * timestamp, then media time, then the presentation clock. Some browsers report a media time
   * that never advances for live streams; if the chosen clock stalls, restart on the
   * presentation clock instead of letting the scan hang forever.
   */
  frameTime(now, meta) {
    if (!this.clock) this.clock = meta && typeof meta.captureTime === 'number' ? 'capture' : meta && meta.mediaTime > 0 ? 'media' : 'now';
    let t = null;
    if (this.clock === 'capture' && meta && typeof meta.captureTime === 'number') t = meta.captureTime / 1000;
    else if (this.clock === 'media' && meta && meta.mediaTime > 0) t = meta.mediaTime;
    else if (this.clock === 'now') t = now / 1000;
    if (t == null) return null; // the chosen clock is missing on this frame: skip it
    this.stalled = this.lastClock != null && t <= this.lastClock ? (this.stalled || 0) + 1 : 0;
    this.lastClock = t;
    if (this.stalled > 15 && this.clock !== 'now') {
      this.clock = 'now';
      this.frames = []; this.goodSeconds = 0; this.lastT = null; this.lastClock = null; this.stalled = 0;
      return null;
    }
    return t;
  }

  sample(t) {
    if (t == null || !this.running || this.video.readyState < 2) return;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    const data = this.ctx.getImageData(0, 0, W, H).data;
    const mask = this.mode === 'skin' ? this.mask : this.innerMask;
    let r = 0, g = 0, b = 0, n = 0, sx = 0, sy = 0, lum = 0;
    const xr = this.showXray && this.xray ? new Uint8ClampedArray(W * H * 4) : null;
    for (let k = 0; k < mask.length; k++) {
      const p = mask[k], i = p * 4;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const use = this.mode === 'skin' ? isSkin(R, G, B) : R < 250 && G < 250 && B < 250;
      if (!use) continue;
      r += R; g += G; b += B; n++;
      sx += p % W; sy += (p / W) | 0;
      lum += 0.299 * R + 0.587 * G + 0.114 * B;
      if (xr) { xr[i] = 40; xr[i + 1] = 200; xr[i + 2] = 255; xr[i + 3] = 150; }
    }
    if (xr) {
      const xc = this.xray.getContext('2d');
      if (this.xray.width !== W) { this.xray.width = W; this.xray.height = H; }
      xc.putImageData(new ImageData(xr, W, H), 0, 0);
    }
    const coverage = n / this.mask.length;
    // Fall back to the inner face region if skin detection keeps failing (unusual lighting).
    if (this.mode === 'skin') {
      this.lowSkinFrames = coverage < 0.08 ? this.lowSkinFrames + 1 : 0;
      if (this.lowSkinFrames > 75) { this.mode = 'roi'; this.onStatus({ key: 'roi' }); }
    }
    const dt = this.lastT == null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (!n) { this.onStatus({ key: 'no_face' }); return; }
    const cx = sx / n, cy = sy / n;
    if (this.prevCentroid) {
      const d = Math.hypot(cx - this.prevCentroid[0], cy - this.prevCentroid[1]);
      this.motion = 0.85 * this.motion + 0.15 * d;
    }
    this.prevCentroid = [cx, cy];
    const luma = lum / n;
    const faceOk = this.mode === 'roi' ? true : coverage >= 0.12;
    const status = !faceOk ? 'no_face' : luma < 40 ? 'too_dark' : luma > 225 ? 'too_bright' : this.motion > 1.6 ? 'moving' : 'ok';
    this.onStatus({ key: status, coverage, luma, motion: this.motion, mode: this.mode });
    if (!faceOk) return;
    this.frames.push({ t, r: r / n, g: g / n, b: b / n, skin: this.mode === 'roi' ? 0.3 : coverage, motion: this.motion });
    // Progress whenever a face is in view: lighting/motion warnings stay on screen, and the
    // signal-quality score reports their effect honestly instead of the scan stalling in a dim room.
    this.goodSeconds += dt;
    this.onProgress(Math.min(1, this.goodSeconds / this.target), this.goodSeconds);
    if (this.goodSeconds >= this.target) this.complete();
  }

  live() {
    if (!this.running || this.frames.length < 60) return;
    try {
      const est = liveEstimate(this.frames, { windowS: 10 });
      if (est) this.onLive(est);
    } catch { /* transient — next tick will retry */ }
  }

  complete() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.liveTimer);
    let result;
    try { result = analyzeRppg(this.frames); } catch (e) { result = { ok: false, reason: 'error', message: String(e.message || e) }; }
    result.mode = this.mode;
    this.finish(result);
  }

  /** Finish early with what has been collected so far (needs ≥ 20 s for a useful result). */
  finishNow() {
    if (this.running) this.complete();
  }

  close() {
    this.running = false;
    clearInterval(this.liveTimer);
    if (this.stream) for (const tr of this.stream.getTracks()) tr.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
