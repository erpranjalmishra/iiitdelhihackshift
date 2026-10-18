import { h, icon, fmt, toast, deltaLine, mount } from '../lib/ui.mjs';
import { api, saveReading } from '../lib/api.mjs';
import { t, getLang } from '../lib/i18n.mjs';
import { drawWave, drawSpectrum } from '../lib/charts.mjs';
import { FaceScanner, OVAL } from '../lib/rppg.mjs';
import { VoiceRecorder } from '../lib/voice.mjs';
import { VOICE_NORMS } from '../lib/voice-core.mjs';

const CONTEXTS = [
  ['resting', 'Resting', 'आराम में'], ['post_exercise', 'After exercise', 'व्यायाम के बाद'], ['after_caffeine', 'After tea/coffee', 'चाय/कॉफ़ी के बाद'],
  ['unwell', 'Feeling unwell', 'तबीयत ठीक नहीं'], ['poor_sleep', 'Slept poorly', 'नींद ठीक नहीं'], ['stressed', 'Stressed', 'तनाव में'],
];
const snrToQuality = (snr) => Math.round(100 * Math.max(0, Math.min(1, (snr + 9) / 12)));

export async function render() {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  let twin = null;
  api('/api/twin?days=30').then((r) => { twin = r; }).catch(() => {});

  const state = { duration: 60, context: new Set(['resting']), face: null, voice: null, manual: {} };
  let scanner = null, recorder = null, liveSeen = false;

  /* ---------- camera stage ---------- */
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const xray = h('canvas', { class: 'xray hide' });
  const ovalSvg = (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 160 120');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('class', 'oval hide'); // shown once the camera is live
    const cx = OVAL.cx * 160, cy = OVAL.cy * 120, rx = OVAL.rx * 160, ry = OVAL.ry * 120;
    svg.innerHTML = `<defs><mask id="ovalmask"><rect width="160" height="120" fill="white"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="black"/></mask></defs>
      <rect width="160" height="120" fill="rgba(11,11,11,0.45)" mask="url(#ovalmask)"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.8"/>
      <path id="ring" d="M ${cx} ${cy - ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy + ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy - ry}" fill="none" stroke="#3987e5" stroke-width="1.8" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>`;
    // (an arc path starting at the top: rotating an ellipse would swap its axes)
    return svg;
  })();
  const ring = ovalSvg.querySelector('#ring');
  const statusText = h('span', null, t('align_face'));
  const statusBar = h('div', { class: 'status hide' }, icon('info', 16), statusText);
  const phIcon = h('span', { style: { display: 'inline-flex' } }, icon('camera', 40));
  const phMsg = h('div', null, L('Camera preview appears here', 'कैमरा प्रीव्यू यहाँ दिखेगा'));
  const phTip = h('div', { class: 'tiny' }, L('Sit still in even, front-facing light. Remove glasses if there is glare.', 'सामने से समान रोशनी में स्थिर बैठें।'));
  const placeholder = h('div', { class: 'placeholder' }, h('div', { class: 'stack', style: { justifyItems: 'center' } }, phIcon, phMsg, phTip));
  const camera = h('div', { class: 'camera' }, video, xray, ovalSvg, placeholder, statusBar);

  const startBtn = h('button', { class: 'btn primary lg', type: 'button', onclick: () => startFace() }, icon('scan', 20), L('Start scan', 'स्कैन शुरू करें'));
  const stopBtn = h('button', { class: 'btn hide', type: 'button', onclick: () => {
    if (scanner && scanner.goodSeconds >= 20) scanner.finishNow();
    else { cancelFace(); toast(L('Scan cancelled — at least 20 seconds are needed.', 'स्कैन रद्द — कम से कम 20 सेकंड चाहिए।')); }
  } }, L('Finish now', 'अभी समाप्त करें'));
  const xrayToggle = h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => {
    xray.classList.toggle('hide', !e.target.checked);
    if (scanner) scanner.showXray = e.target.checked;
  } }), L('Show detected skin pixels', 'पहचानी गई त्वचा दिखाएँ'));
  const durSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Scan length' }, [30, 45, 60].map((d) =>
    h('button', { type: 'button', 'aria-pressed': String(d === state.duration), onclick: (e) => {
      state.duration = d;
      for (const b of durSeg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
    } }, `${d}s`)));
  const ctxChips = h('div', { class: 'chips' }, CONTEXTS.map(([id, en, hi]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.context.has(id)), onclick: (e) => {
    if (state.context.has(id)) state.context.delete(id); else state.context.add(id);
    e.currentTarget.setAttribute('aria-pressed', String(state.context.has(id)));
  } }, lang === 'hi' ? hi : en)));

  /* ---------- live panel ---------- */
  const liveHr = h('span', { class: 'value' }, '--');
  const heart = h('span', { style: { color: 'var(--critical)', display: 'inline-flex' } }, icon('heart', 28));
  const progressBar = h('i', { style: { width: '0%' } });
  const progressText = h('span', { class: 'muted small' }, '0s');
  const qualityBar = h('i', { style: { width: '0%' } });
  const qualityMeter = h('div', { class: 'meter' }, qualityBar);
  const qualityText = h('span', { class: 'muted small' }, '—');
  const waveCanvas = h('canvas', { class: 'live', style: { height: '110px' }, 'aria-label': 'Live pulse waveform' });
  const specCanvas = h('canvas', { class: 'live', style: { height: '92px' }, 'aria-label': 'Live frequency spectrum' });
  const steps = (lang === 'hi'
    ? ['कैमरा', 'त्वचा पिक्सेल', 'RGB संकेत', 'POS प्रक्षेपण', 'बैंड-पास 42–210 bpm', 'FFT', 'हृदय गति']
    : ['Camera', 'Skin pixels', 'RGB trace', 'POS projection', 'Band-pass 42–210 bpm', 'FFT', 'Heart rate']).map((s) => h('span', { class: 'step' }, s));
  const pipeline = h('div', { class: 'pipeline', 'aria-label': 'Signal pipeline' }, steps.flatMap((s, i) => (i ? [h('span', { class: 'arr' }, '→'), s] : [s])));
  const lightSteps = (n) => steps.forEach((s, i) => s.classList.toggle('on', i < n));
  const modeNote = h('div', { class: 'notice info small hide' }, icon('info', 16), L('Skin detection is weak in this light, so Nadi is reading the central face region instead.', 'इस रोशनी में त्वचा पहचान कमज़ोर है — चेहरे का मध्य भाग पढ़ा जा रहा है।'));

  const livePanel = h('div', { class: 'card stack-lg' },
    h('div', { class: 'row between' },
      h('div', { class: 'live-hr' }, heart, liveHr, h('span', { class: 'muted' }, 'bpm')),
      h('div', { class: 'stack', style: { minWidth: '140px' } }, h('div', { class: 'row between small' }, h('span', null, L('Progress', 'प्रगति')), progressText), h('div', { class: 'meter' }, progressBar))),
    h('div', { class: 'stack' }, h('div', { class: 'row between small' }, h('strong', null, L('Pulse waveform', 'नाड़ी तरंग')), h('span', { class: 'muted tiny' }, L('each peak = one heartbeat', 'हर शिखर = एक धड़कन'))), waveCanvas),
    h('div', { class: 'stack' }, h('div', { class: 'row between small' }, h('strong', null, L('Frequency spectrum', 'आवृत्ति स्पेक्ट्रम')), h('span', { class: 'muted tiny' }, L('the tallest peak is your heart rate', 'सबसे ऊँचा शिखर = हृदय गति'))), specCanvas),
    h('div', { class: 'stack' }, h('div', { class: 'row between small' }, h('strong', null, L('Signal quality', 'सिग्नल गुणवत्ता')), qualityText), qualityMeter),
    modeNote,
    h('div', { class: 'stack' }, h('strong', { class: 'small' }, L('How it works', 'यह कैसे काम करता है')), pipeline,
      h('p', { class: 'muted tiny' }, L('Each heartbeat pushes blood into facial capillaries, shifting skin colour by ~0.2%. The POS algorithm (Wang et al., IEEE TBME 2017) separates that pulse from lighting and motion; an FFT finds its frequency.', 'हर धड़कन से त्वचा का रंग ~0.2% बदलता है। POS एल्गोरिदम इस नाड़ी को रोशनी और हलचल से अलग करता है; FFT इसकी आवृत्ति ढूँढता है।'))));

  const resultsHost = h('div', { class: 'stack-lg' });
  const stageGrid = h('div', { class: 'scan-stage' },
    h('div', { class: 'stack-lg' }, camera,
      h('div', { class: 'card stack' },
        h('div', { class: 'row between' }, h('div', { class: 'row' }, startBtn, stopBtn), durSeg),
        h('div', { class: 'stack' }, h('span', { class: 'small', style: { fontWeight: 600 } }, L('Right now I am…', 'अभी मैं…')), ctxChips),
        xrayToggle,
        h('p', { class: 'disclaimer' }, t('privacy_line')))),
    livePanel);

  const secureNote = !window.isSecureContext
    ? h('div', { class: 'notice warn' }, icon('lock', 18), h('div', null, h('strong', null, L('Camera needs a secure connection. ', 'कैमरे को सुरक्षित कनेक्शन चाहिए। ')),
        L('Open Nadi via http://localhost on this computer, or the https:// address on a phone (run "npm run certs" once).', 'इस कंप्यूटर पर http://localhost खोलें, या फ़ोन पर https:// पता।')))
    : null;

  /* ---------- face scan flow ---------- */
  const STATUS = { ok: 'hold_still', no_face: 'no_face', too_dark: 'too_dark', too_bright: 'too_bright', moving: 'moving' };
  async function startFace() {
    if (!FaceScanner.supported() || !window.isSecureContext) { toast(L('Camera is not available here — enter vitals manually below.', 'कैमरा उपलब्ध नहीं — नीचे मैन्युअल दर्ज करें।'), { bad: true }); showResults(null); return; }
    startBtn.disabled = true;
    liveSeen = false;
    mount(resultsHost);
    scanner = new FaceScanner({
      video, xray,
      onStatus: (s) => {
        if (s.key === 'roi') { modeNote.classList.remove('hide'); return; }
        statusText.textContent = t(STATUS[s.key] || 'hold_still');
        statusBar.style.background = s.key === 'ok' ? 'rgba(11,11,11,0.62)' : 'rgba(176,120,0,0.85)';
        lightSteps(s.key === 'no_face' ? 1 : liveSeen ? 7 : 3);
      },
      onProgress: (p, secs) => {
        ring.setAttribute('stroke-dasharray', `${(p * 100).toFixed(1)} 100`);
        progressBar.style.width = `${(p * 100).toFixed(0)}%`;
        progressText.textContent = `${Math.floor(secs)} / ${state.duration}s`;
        if (secs >= 20) stopBtn.textContent = L('Finish now', 'अभी समाप्त करें');
      },
      onLive: (est) => {
        liveSeen = true;
        lightSteps(7);
        liveHr.textContent = String(est.hr);
        heart.firstChild.classList.add('beat');
        heart.firstChild.style.animationDuration = `${(60 / Math.max(40, est.hr)).toFixed(2)}s`;
        drawWave(waveCanvas, est.wave);
        drawSpectrum(specCanvas, est.spectrum, { peakBpm: est.hr });
        const q = snrToQuality(est.snr);
        qualityBar.style.width = `${q}%`;
        qualityMeter.className = `meter ${q < 40 ? 'bad' : q < 65 ? 'warn' : ''}`;
        qualityText.textContent = `${q}/100 · ${q >= 65 ? L('good', 'अच्छा') : q >= 40 ? L('fair', 'ठीक') : L('weak — hold still, more light', 'कमज़ोर — स्थिर रहें')}`;
      },
    });
    scanner.showXray = !xray.classList.contains('hide');
    try {
      await scanner.open();
    } catch (e) {
      startBtn.disabled = false;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      toast(denied ? L('Camera permission was denied. Allow it in the browser address bar and try again.', 'कैमरा अनुमति नहीं मिली।') : L('Could not start the camera: ', 'कैमरा शुरू नहीं हुआ: ') + (e.message || e), { bad: true });
      return;
    }
    placeholder.classList.add('hide');
    ovalSvg.classList.remove('hide');
    statusBar.classList.remove('hide');
    stopBtn.classList.remove('hide');
    stopBtn.textContent = L('Cancel', 'रद्द करें');
    lightSteps(2);
    const result = await scanner.start(state.duration);
    scanner.close();
    stopBtn.classList.add('hide');
    statusBar.classList.add('hide');
    ovalSvg.classList.add('hide');
    mount(phIcon, icon(result.ok ? 'ok' : 'alert', 40));
    phMsg.textContent = result.ok ? L('Scan complete — your results are below', 'स्कैन पूरा — परिणाम नीचे हैं') : L('No reliable pulse — try again', 'विश्वसनीय नाड़ी नहीं — फिर कोशिश करें');
    phTip.textContent = L('The camera is now off.', 'कैमरा अब बंद है।');
    placeholder.classList.remove('hide');
    startBtn.disabled = false;
    mount(startBtn, icon('refresh', 18), L('Scan again', 'फिर से स्कैन करें'));
    heart.firstChild.classList.remove('beat');
    state.face = result;
    showResults(result);
  }

  function cancelFace() {
    if (scanner) scanner.close();
    scanner = null;
    startBtn.disabled = false;
    stopBtn.classList.add('hide');
    statusBar.classList.add('hide');
    mount(phIcon, icon('camera', 40));
    phMsg.textContent = L('Camera preview appears here', 'कैमरा प्रीव्यू यहाँ दिखेगा');
    placeholder.classList.remove('hide');
    ovalSvg.classList.add('hide');
    ring.setAttribute('stroke-dasharray', '0 100');
  }

  /* ---------- results ---------- */
  function resultTile(ic, label, value, unit, extra) {
    return h('div', { class: 'card tight stat' }, h('div', { class: 'label' }, icon(ic, 16), label), h('div', { class: 'value' }, value, unit ? h('small', null, unit) : null), extra || null);
  }

  function showResults(r) {
    const base = twin ? twin.baseline : {};
    const parts = [];
    if (r && !r.ok) {
      parts.push(h('div', { class: 'notice bad' }, icon('alert', 20), h('div', null, h('strong', null, L('No reliable pulse found. ', 'विश्वसनीय नाड़ी नहीं मिली। ')), r.message || '', ' ', L('Try brighter, even light on your face and keep very still.', 'चेहरे पर अधिक रोशनी रखें और स्थिर रहें।'))));
    } else if (r) {
      const conf = { high: L('High confidence', 'उच्च विश्वसनीयता'), medium: L('Medium confidence', 'मध्यम विश्वसनीयता'), low: L('Low confidence — consider re-scanning', 'कम विश्वसनीयता — फिर से स्कैन करें') }[r.confidence];
      const hrvValue = r.hrv ? fmt(r.hrv.rmssd) : '—';
      const hrvExtra = r.hrv
        ? h('div', { class: 'delta' }, h('span', { class: 'tag' }, r.hrv.reliability === 'good' ? L('reliable', 'विश्वसनीय') : L('approximate', 'अनुमानित')), ` ${L('noise-corrected', 'शोर-सुधारित')}`)
        : h('div', { class: 'delta' }, r.hrvWithheld ? L(`Withheld: your beat-to-beat variation is within the camera's timing noise (±${r.hrvWithheld.timingNoiseMs} ms), so it can't be measured reliably`, `रोका गया: धड़कनों का अंतर कैमरे की समय-त्रुटि के भीतर है`) : L('Not enough clean beats', 'पर्याप्त साफ़ धड़कनें नहीं'));
      const wave = h('canvas', { class: 'live', style: { height: '110px' } });
      const spec = h('canvas', { class: 'live', style: { height: '92px' } });
      requestAnimationFrame(() => { drawWave(wave, r.waveform, { beats: r.beats, fs: r.waveformFs }); drawSpectrum(spec, r.spectrum, { peakBpm: r.hr }); });
      parts.push(
        h('div', { class: 'card stack' },
          h('div', { class: 'row between' }, h('h2', null, L('Your vitals', 'आपके वाइटल्स')), h('span', { class: 'tag brand' }, `${L('Quality', 'गुणवत्ता')} ${r.quality}/100 · ${conf}`)),
          h('div', { class: 'grid-4' },
            resultTile('heart', t('resting_hr'), fmt(r.hr), 'bpm', deltaLine(r.hr, base.hr, { unit: 'bpm', lang })),
            resultTile('wave', t('hrv'), hrvValue, r.hrv ? 'ms' : '', r.hrv ? h('div', null, deltaLine(r.hrv.rmssd, base.rmssd, { unit: 'ms', higherIsWorse: false, lang }), hrvExtra) : hrvExtra),
            resultTile('lungs', t('breathing'), fmt(r.rr, 1), '/min', deltaLine(r.rr, base.rr, { unit: '/min', decimals: 1, lang })),
            resultTile('brain', t('stress'), r.stress != null ? fmt(r.stress) : '—', r.stress != null ? '/100' : '', r.stress != null ? deltaLine(r.stress, base.stress, { lang }) : h('div', { class: 'delta' }, L('Needs a reliable HRV', 'विश्वसनीय HRV चाहिए')))),
          h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, h('strong', { class: 'small' }, L('Your pulse (last 10 s) — ticks mark detected beats', 'आपकी नाड़ी (अंतिम 10 सेकंड)')), wave), h('div', { class: 'stack' }, h('strong', { class: 'small' }, L('Spectrum', 'स्पेक्ट्रम')), spec)),
          h('details', null, h('summary', { class: 'small', style: { cursor: 'pointer', fontWeight: 600 } }, L('Signal details', 'सिग्नल विवरण')),
            h('dl', { class: 'kv', style: { marginTop: '8px' } },
              h('dt', null, 'SNR'), h('dd', null, `${fmt(r.snr, 1)} dB`),
              h('dt', null, L('Beats detected', 'धड़कनें')), h('dd', null, String(r.beatsDetected ?? '—')),
              h('dt', null, L('HR from beats', 'धड़कनों से HR')), h('dd', null, `${fmt(r.hrBeats, 1)} bpm`),
              h('dt', null, L('Breathing sources', 'सांस स्रोत')), h('dd', null, r.rrDetail ? `${r.rrDetail.sources.map((s) => `${s.name.toUpperCase()} ${s.brpm}`).join(', ')}${r.rrDetail.agree ? L(' (agree)', ' (सहमत)') : ''}` : '—'),
              h('dt', null, L('Duration · frame rate', 'अवधि · फ़्रेम दर')), h('dd', null, `${fmt(r.durationS, 0)} s · ${fmt(r.fsActual, 0)} fps`),
              h('dt', null, L('Skin coverage · motion', 'त्वचा · हलचल')), h('dd', null, `${Math.round((r.skin || 0) * 100)}% · ${fmt(r.motion, 2)} px/frame${r.mode === 'roi' ? L(' (face-region mode)', ' (चेहरा-क्षेत्र मोड)') : ''}`))),
        ));
    }
    parts.push(voiceCard(), manualCard(), saveCard(r && r.ok ? r : null));
    mount(resultsHost, ...parts);
    resultsHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- voice ---------- */
  function voiceCard() {
    const level = h('i', { style: { width: '0%' } });
    const info = h('div', { class: 'row between small' }, h('span', { class: 'muted' }, L('Ready', 'तैयार')), h('span', null, ''));
    const out = h('div', { class: 'stack' });
    const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!VoiceRecorder.supported() || !window.isSecureContext) { toast(L('Microphone not available here.', 'माइक्रोफ़ोन उपलब्ध नहीं।'), { bad: true }); return; }
      btn.disabled = true;
      recorder = new VoiceRecorder();
      try {
        info.firstChild.textContent = L('Say "aaaah" now…', 'अब "आआआ" बोलें…');
        const res = await recorder.start({ maxSeconds: 15, onLevel: (lv) => {
          level.style.width = `${Math.min(100, Math.round(lv.rms * 600))}%`;
          info.lastChild.textContent = `${lv.voiced ? `${Math.round(lv.f0)} Hz · ` : ''}${lv.voicedS.toFixed(1)}s`;
        } });
        state.voice = res.ok ? res : null;
        level.style.width = '0%';
        info.firstChild.textContent = res.ok ? L('Done', 'हो गया') : L('Try again', 'फिर से');
        mount(out, res.ok ? voiceResults(res) : h('div', { class: 'notice warn' }, icon('info', 18), res.message || 'No voice detected'));
      } catch (e) {
        toast(e && e.name === 'NotAllowedError' ? L('Microphone permission was denied.', 'माइक्रोफ़ोन अनुमति नहीं मिली।') : String(e.message || e), { bad: true });
      }
      btn.disabled = false;
      mount(btn, icon('mic', 18), L('Record again', 'फिर से रिकॉर्ड करें'));
    } }, icon('mic', 18), L('Record voice', 'आवाज़ रिकॉर्ड करें'));
    return h('div', { class: 'card stack' },
      h('div', { class: 'card-head', style: { marginBottom: 0 } }, h('div', null, h('h2', null, t('voice_title')), h('p', { class: 'muted small' }, t('voice_sub'))), btn),
      h('div', { class: 'level-bar' }, level), info, out);
  }

  function voiceResults(v) {
    const row = (label, val, unit, norm, okFn) => {
      const ok = okFn(val);
      return h('tr', null, h('td', null, label), h('td', null, h('strong', null, `${fmt(val, 2)} ${unit}`)), h('td', { class: 'muted' }, norm),
        h('td', null, h('span', { class: `sev ${ok ? 'self_care' : 'soon'}` }, h('span', { class: 'swatch' }), ok ? L('Typical', 'सामान्य') : L('Outside typical', 'सामान्य से बाहर'))));
    };
    return h('div', { class: 'stack' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, L('Measure', 'माप')), h('th', null, L('You', 'आप')), h('th', null, L('Typical', 'सामान्य')), h('th', null, ''))),
        h('tbody', null,
          row(L('Pitch (F0)', 'पिच (F0)'), v.f0, 'Hz', '85–255 Hz', (x) => x >= 70 && x <= 300),
          row('Jitter', v.jitter, '%', `< ${VOICE_NORMS.jitter}%`, (x) => x == null || x <= VOICE_NORMS.jitter),
          row('Shimmer', v.shimmer, '%', `< ${VOICE_NORMS.shimmer}%`, (x) => x == null || x <= VOICE_NORMS.shimmer),
          row('HNR', v.hnr, 'dB', '> 15–20 dB', (x) => x >= 15),
          row(L('Max phonation time', 'अधिकतम स्वर समय'), v.mpt, 's', `≥ ${VOICE_NORMS.mpt} s`, (x) => x >= VOICE_NORMS.mpt)))),
      h('p', { class: 'muted tiny' }, L(`Voice stability ${v.stability}/100 from ${v.cycles} vocal cycles. Short phonation or unstable voice can reflect breathlessness, a sore throat or fatigue. Laptop microphones lower HNR slightly.`, `${v.cycles} स्वर चक्रों से आवाज़ स्थिरता ${v.stability}/100।`)));
  }

  /* ---------- manual vitals ---------- */
  function manualCard() {
    const num = (key, ph, step = 'any') => h('input', { class: 'input', type: 'number', step, placeholder: ph, oninput: (e) => { state.manual[key] = e.target.value; } });
    const tempUnit = h('select', { class: 'select', style: { maxWidth: '84px' }, onchange: (e) => { state.manual.tempUnit = e.target.value; } }, h('option', { value: 'F' }, '°F'), h('option', { value: 'C' }, '°C'));
    state.manual.tempUnit = 'F';
    return h('details', { class: 'card' }, h('summary', { style: { cursor: 'pointer', fontWeight: 650 } }, L('Add readings from a thermometer, oximeter or BP machine (optional)', 'थर्मामीटर, ऑक्सीमीटर या BP मशीन की रीडिंग जोड़ें (वैकल्पिक)')),
      h('div', { class: 'grid-4', style: { marginTop: '14px' } },
        h('label', { class: 'field' }, h('span', null, t('temperature')), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, num('temp', '98.6'), tempUnit)),
        h('label', { class: 'field' }, h('span', null, 'SpO₂ (%)'), num('spo2', '98', '1')),
        h('label', { class: 'field' }, h('span', null, L('BP (sys / dia)', 'BP (ऊपर / नीचे)')), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, num('bp_sys', '120', '1'), num('bp_dia', '80', '1'))),
        h('label', { class: 'field' }, h('span', null, L('Blood sugar (mg/dL)', 'शुगर (mg/dL)')), num('glucose', '110', '1'))));
  }

  /* ---------- save ---------- */
  function saveCard(face) {
    const btn = h('button', { class: 'btn primary lg', type: 'button', onclick: async () => {
      const m = state.manual;
      let temp_c = m.temp ? +m.temp : null;
      if (temp_c != null && m.tempUnit === 'F') temp_c = Math.round(((temp_c - 32) * 5) / 9 * 10) / 10;
      const body = {
        source: face ? 'camera' : 'manual',
        hr: face ? face.hr : null, rmssd: face && face.hrv ? face.hrv.rmssd : null, sdnn: face && face.hrv ? face.hrv.sdnn : null,
        rr: face ? face.rr : null, stress: face ? face.stress : null, quality: face ? face.quality : null, snr: face ? face.snr : null, confidence: face ? face.confidence : null,
        temp_c, spo2: m.spo2 || null, bp_sys: m.bp_sys || null, bp_dia: m.bp_dia || null, glucose: m.glucose || null,
        context: [...state.context], voice: state.voice,
        detail: face ? { waveform: face.waveform, waveformFs: face.waveformFs, beats: face.beats, spectrum: face.spectrum, snr: face.snr, durationS: face.durationS, fsActual: face.fsActual, skin: face.skin, motion: face.motion, hrBeats: face.hrBeats, hrvReliability: face.hrv ? face.hrv.reliability : null, hrvWithheld: face.hrvWithheld, rrDetail: face.rrDetail } : null,
      };
      if (!face && !temp_c && !m.spo2 && !m.bp_sys && !m.glucose) { toast(L('Nothing to save yet — run a scan or enter a reading.', 'सहेजने को कुछ नहीं।'), { bad: true }); return; }
      btn.disabled = true;
      try {
        const r = await saveReading(body);
        if (r.queued) toast(L('Saved on this device — will sync when back online.', 'इस डिवाइस पर सहेजा गया — ऑनलाइन होने पर सिंक होगा।'));
        else toast(L('Saved to your Baseline Twin.', 'आपके बेसलाइन ट्विन में सहेजा गया।'));
        mount(btn, icon('ok', 18), L('Saved', 'सहेजा गया'));
        after.classList.remove('hide');
      } catch (e) { btn.disabled = false; toast(e.message, { bad: true }); }
    } }, icon('ok', 18), L('Save to my Twin', 'ट्विन में सहेजें'));
    const after = h('div', { class: 'row hide' },
      h('a', { class: 'btn', href: '#/check' }, icon('check', 18), L('Check symptoms with these vitals', 'इन वाइटल्स के साथ लक्षण जाँचें')),
      h('a', { class: 'btn ghost', href: '#/twin' }, icon('twin', 18), L('See my trends', 'मेरे ट्रेंड देखें')));
    return h('div', { class: 'card stack' }, h('div', { class: 'row' }, btn), after,
      h('p', { class: 'disclaimer' }, L('Camera vitals are wellness estimates, not medical-grade measurements.', 'कैमरा वाइटल्स अनुमान हैं, चिकित्सा-स्तर के माप नहीं।')));
  }

  const manualOnly = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => showResults(null) }, icon('edit', 16), L('No camera? Enter vitals manually', 'कैमरा नहीं? मैन्युअल दर्ज करें'));

  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('scan_title')), h('p', null, t('scan_sub'))), manualOnly),
    secureNote, stageGrid, resultsHost);
  requestAnimationFrame(() => { drawWave(waveCanvas, []); drawSpectrum(specCanvas, []); });
  el._dispose = () => { if (scanner) scanner.close(); if (recorder) recorder.close(); };
  return el;
}
