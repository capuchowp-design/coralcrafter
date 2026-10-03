/* Coralcrafter – motor de áudio
 * Sintetizador formântico de vozes corais (soprano, contralto, tenor, baixo),
 * agendador de reprodução e renderização offline (WAV).
 * Somente Web Audio API, sem dependências externas.
 */
(function (global) {
  'use strict';
  const CC = (global.CC = global.CC || {});

  /* ───────────────────────── Vozes e vogais ───────────────────────── */

  const VOICE_ORDER = ['S', 'A', 'T', 'B'];
  const VOICES = {
    S: { key: 'S', name: 'Soprano',   lo: 60, hi: 84, color: '#ff7a90', pan:  0.30 },
    A: { key: 'A', name: 'Contralto', lo: 55, hi: 77, color: '#ffb347', pan:  0.12 },
    T: { key: 'T', name: 'Tenor',     lo: 48, hi: 69, color: '#45d6a8', pan: -0.12 },
    B: { key: 'B', name: 'Baixo',     lo: 40, hi: 64, color: '#6ea8ff', pan: -0.30 },
  };
  const VOWELS = {
    A: { label: 'Ah' },
    E: { label: 'Eh' },
    I: { label: 'Ee' },
    O: { label: 'Oh' },
    U: { label: 'Oo' },
  };

  /* Formantes (Hz), amplitudes (dB) e larguras de banda (Hz) – 5 formantes por vogal.
   * Tabelas clássicas de síntese de canto (soprano, contralto, tenor, baixo). */
  const FORMANTS = {
    S: {
      A: [[800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]],
      E: [[350, 2000, 2800, 3600, 4950], [0, -20, -15, -40, -56], [60, 100, 120, 150, 200]],
      I: [[270, 2140, 2950, 3900, 4950], [0, -12, -26, -26, -44], [60, 90, 100, 120, 120]],
      O: [[450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]],
      U: [[325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200]],
    },
    A: {
      A: [[800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]],
      E: [[400, 1600, 2700, 3300, 4950], [0, -24, -30, -35, -60], [60, 80, 120, 150, 200]],
      I: [[350, 1700, 2700, 3700, 4950], [0, -20, -30, -36, -60], [50, 100, 120, 150, 200]],
      O: [[450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]],
      U: [[325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]],
    },
    T: {
      A: [[650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]],
      E: [[400, 1700, 2600, 3200, 3580], [0, -14, -12, -14, -20], [70, 80, 100, 120, 120]],
      I: [[290, 1870, 2800, 3250, 3540], [0, -15, -18, -20, -30], [40, 90, 100, 120, 120]],
      O: [[400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]],
      U: [[350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 80, 100, 120, 120]],
    },
    B: {
      A: [[600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]],
      E: [[400, 1620, 2400, 2800, 3100], [0, -12, -9, -12, -18], [40, 80, 100, 120, 120]],
      I: [[250, 1750, 2600, 3050, 3340], [0, -30, -16, -22, -28], [60, 90, 100, 120, 120]],
      O: [[400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]],
      U: [[350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]],
    },
  };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const dbToLin = (db) => Math.pow(10, db / 20);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Fonte glotal: série harmônica com queda de ~-13 dB/oitava (voz "soprosa" suave). */
  const NUM_HARMONICS = 96;
  const SOURCE_SLOPE = 1.4;
  function harmonicAmp(n) { return 1 / Math.pow(n, SOURCE_SLOPE); }

  /* Resposta complexa de um filtro passa-banda (RBJ) em f. */
  function bandpassResponse(f, fc, bw) {
    const q = fc / bw;
    const x = f / fc;
    // H(jx) = (jx/Q) / (1 - x² + jx/Q)
    const reN = 0, imN = x / q;
    const reD = 1 - x * x, imD = x / q;
    const d = reD * reD + imD * imD;
    return [(reN * reD + imN * imD) / d, (imN * reD - reN * imD) / d];
  }

  /* Ganho de compensação: mantém a sonoridade (RMS) parecida entre vozes,
   * vogais e alturas. Calculado analiticamente a partir do espectro. */
  const compCache = new Map();
  const TARGET_RMS = 0.085;
  // equilíbrio entre as vozes (medido em renderização offline): sopranos e contraltos
  // precisam de mais ganho para soar tão "cheios" quanto tenores e baixos.
  const VOICE_TRIM = { S: 2.3, A: 1.9, T: 1.6, B: 1.45 };
  function loudnessComp(voice, vowel, midi) {
    const key = voice + vowel + midi;
    let c = compCache.get(key);
    if (c) return c;
    const [fr, db, bw] = FORMANTS[voice][vowel];
    const f0 = mtof(midi);
    let sum = 0;
    for (let n = 1; n <= NUM_HARMONICS; n++) {
      const f = f0 * n;
      if (f > 9000) break;
      let re = 0, im = 0;
      for (let i = 0; i < 5; i++) {
        const [r, m] = bandpassResponse(f, fr[i], bw[i]);
        const g = dbToLin(db[i]);
        re += r * g; im += m * g;
      }
      const a = harmonicAmp(n) * Math.hypot(re, im);
      sum += (a * a) / 2;
    }
    const rms = Math.sqrt(sum) || 1e-6;
    c = Math.min((TARGET_RMS * VOICE_TRIM[voice]) / rms, 60);
    compCache.set(key, c);
    return c;
  }

  /* ───────────────────────── Amostras de coro (vozes humanas reais) ─────────────────────────
   * Banco "FluidR3_GM" (Choir Aahs e Voice Oohs), uma amostra por semitom (Dó2–Dó6).
   * Cada amostra é preparada para sustentar: o trecho final recebe crossfade com o
   * trecho anterior ao ponto de loop, e a notas longas ficam contínuas, sem "pulos".
   */
  const SAMPLE_PACK = 'coral-voices.bin'; // pacote único: 98 MP3 (Aahs e Oohs, Dó2–Dó6)
  const SAMPLE_MIN = 36, SAMPLE_MAX = 84;
  const VOWEL_INSTR = { A: 'ah', E: 'ah', I: 'oh', O: 'oh', U: 'oh' };
  // moldagem leve de vogal sobre as amostras: [tipo, freq, ganho dB, Q]
  const VOWEL_EQ = {
    A: [],
    E: [['peaking', 750, -4, 1.0], ['peaking', 1900, 5, 1.0]],
    I: [['peaking', 2300, 7, 1.2], ['peaking', 550, -3, 1.0]],
    O: [],
    U: [['lowpass', 1800, 0, 0.7]],
  };
  // equilíbrio entre as vozes no modo amostras (baixos e tenores soam mais densos)
  const SAMPLE_TRIM = { S: 1.0, A: 0.9, T: 0.78, B: 0.85 };
  const LOOP_START = 0.9, LOOP_END = 3.0, XFADE = 0.5, SAMPLE_TARGET_RMS = 0.095;

  function prepareSample(buf) {
    const sr = buf.sampleRate;
    const A = Math.floor(LOOP_START * sr);
    const E = Math.min(buf.length - 1, Math.floor(LOOP_END * sr));
    const X = Math.floor(XFADE * sr);
    const out = new (global.AudioBuffer || global.webkitAudioBuffer)({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
    let sum = 0, cnt = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = out.getChannelData(c);
      dst.set(src);
      for (let i = 0; i < X; i++) {
        const t = i / X;
        dst[E - X + i] = src[E - X + i] * Math.cos(t * Math.PI / 2) + src[A - X + i] * Math.sin(t * Math.PI / 2);
      }
      for (let i = A; i < E; i++) { sum += dst[i] * dst[i]; cnt++; }
    }
    const rms = Math.sqrt(sum / Math.max(1, cnt)) || 1e-4;
    return { buffer: out, loopStart: A / sr, loopEnd: E / sr, gain: Math.min(SAMPLE_TARGET_RMS / rms, 12) };
  }

  const Samples = {
    banks: { ah: {}, oh: {} },
    state: 'idle',      // idle | loading | ready | error
    progress: 0,
    listeners: [],
    _promise: null,
    on(fn) { this.listeners.push(fn); },
    _emit() { this.listeners.forEach((f) => { try { f(this.state, this.progress); } catch (e) { /* ignore */ } }); },
    get(inst, midi) {
      const m = Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, midi));
      return this.banks[inst][m] || null;
    },
    /** Carrega e prepara todas as amostras (uma vez). */
    load() {
      if (this._promise) return this._promise;
      this.state = 'loading'; this.progress = 0; this._emit();
      const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      const dctx = new OAC(1, 1, 44100);
      let done = 0, failed = 0, total = 1;
      const run = async (inst, m, bytes) => {
        try {
          const decoded = await dctx.decodeAudioData(bytes);
          this.banks[inst][m] = prepareSample(decoded);
        } catch (e) { failed++; }
        done++; this.progress = done / total;
        if (done % 8 === 0) this._emit();
      };
      this._promise = (async () => {
        let jobs = [];
        try {
          const res = await fetch(SAMPLE_PACK);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const ab = await res.arrayBuffer();
          const dv = new DataView(ab);
          if (dv.getUint32(0, false) !== 0x43435631) throw new Error('pacote inválido'); // "CCV1"
          const hl = dv.getUint32(4, true);
          const index = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, hl)));
          const base = 8 + hl;
          jobs = index.map((e) => [e.i, e.m, ab.slice(base + e.o, base + e.o + e.l)]);
        } catch (e) { jobs = []; }
        total = Math.max(1, jobs.length);
        let idx = 0;
        const workers = Array.from({ length: 4 }, async () => { while (idx < jobs.length) await run(...jobs[idx++]); });
        await Promise.all(workers);
        this.state = jobs.length && failed <= jobs.length * 0.3 ? 'ready' : 'error';
        if (this.state === 'error') this._promise = null; // permite tentar de novo
        this._emit();
        return this.state;
      })();
      return this._promise;
    },
  };

  /* ───────────────────────── Engine ───────────────────────── */

  function makeImpulse(ctx, seconds, decay, rand) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const n = rand() * 2 - 1;
        lp += (n - lp) * 0.38; // escurece a cauda, como uma igreja de pedra
        d[i] = lp * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  class Engine {
    /**
     * @param {BaseAudioContext} ctx
     * @param {{master?:number, reverb?:number, seed?:number}} opts
     */
    constructor(ctx, opts) {
      opts = opts || {};
      this.ctx = ctx;
      this.rand = mulberry32(opts.seed || 20261003);
      this.active = new Set();
      this.timbre = opts.timbre || 'coral'; // 'coral' (amostras) | 'synth' (formantes)

      this.master = ctx.createGain();
      this.master.gain.value = opts.master == null ? 0.8 : opts.master;

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.knee.value = 18;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.012;
      this.comp.release.value = 0.3;

      // limitador de segurança (evita estouro com muitas vozes)
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -4;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;

      this.bus = ctx.createGain();
      this.dry = ctx.createGain();
      this.wet = ctx.createGain();
      this.reverbNode = ctx.createConvolver();
      this.reverbNode.buffer = makeImpulse(ctx, 2.8, 2.4, this.rand);

      this.bus.connect(this.dry);
      this.dry.connect(this.comp);
      this.bus.connect(this.reverbNode);
      this.reverbNode.connect(this.wet);
      this.wet.connect(this.comp);
      this.comp.connect(this.limiter);
      this.limiter.connect(this.master);
      this.master.connect(ctx.destination);
      this.setReverb(opts.reverb == null ? 0.35 : opts.reverb);

      this.voiceBus = {};
      VOICE_ORDER.forEach((k) => {
        const g = ctx.createGain();
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (p) { p.pan.value = VOICES[k].pan; g.connect(p); p.connect(this.bus); }
        else g.connect(this.bus);
        this.voiceBus[k] = g;
      });

      // Fonte glotal (PeriodicWave sem normalização, para a compensação ser exata)
      const real = new Float32Array(NUM_HARMONICS + 1);
      const imag = new Float32Array(NUM_HARMONICS + 1);
      for (let n = 1; n <= NUM_HARMONICS; n++) imag[n] = harmonicAmp(n);
      this.wave = ctx.createPeriodicWave(real, imag, { disableNormalization: true });

      // Ruído de respiração
      const nlen = Math.floor(ctx.sampleRate * 2);
      this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = this.rand() * 2 - 1;
    }

    setMaster(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

    setReverb(v) {
      const t = this.ctx.currentTime;
      this.wet.gain.setTargetAtTime(v * 1.1, t, 0.03);
      this.dry.gain.setTargetAtTime(1 - v * 0.3, t, 0.03);
    }

    setVoiceLevel(key, level) {
      this.voiceBus[key].gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    }

    setTimbre(t) { this.timbre = t === 'synth' ? 'synth' : 'coral'; }

    /** Agenda uma nota vocal. t em segundos do relógio do contexto. */
    noteOn(o) {
      if (this.timbre === 'coral') {
        const h = this.noteOnSample(o);
        if (h) return h;
      }
      return this.noteOnSynth(o);
    }

    /** Nota cantada por amostra real de coro, com loop para sustentar. */
    noteOnSample(o) {
      const ctx = this.ctx;
      const vowel = VOWEL_INSTR[o.vowel] ? o.vowel : 'A';
      const smp = Samples.get(VOWEL_INSTR[vowel], o.midi);
      if (!smp) return null;
      const t = Math.max(o.t, ctx.currentTime);
      const dur = Math.max(0.08, o.dur);
      const vel = o.vel == null ? 0.9 : o.vel;
      const rnd = this.rand;
      const end = t + dur;
      const nodes = [];

      const out = ctx.createGain();
      out.gain.value = 0;
      let head = out;
      // vogal: filtros opcionais entre as camadas e a saída
      const eq = VOWEL_EQ[vowel] || [];
      let tail = out;
      for (let i = eq.length - 1; i >= 0; i--) {
        const [type, f, g, q] = eq[i];
        const bq = ctx.createBiquadFilter();
        bq.type = type; bq.frequency.value = f; bq.gain.value = g; bq.Q.value = q;
        bq.connect(tail); tail = bq;
      }
      head = tail;

      // duas camadas levemente desafinadas = mais "gente cantando junto"
      [[-5, 1.0], [6, 0.7]].forEach(([cents, lv], k) => {
        const src = ctx.createBufferSource();
        src.buffer = smp.buffer;
        src.loop = true; src.loopStart = smp.loopStart; src.loopEnd = smp.loopEnd;
        src.detune.value = cents + (rnd() - 0.5) * 6;
        const g = ctx.createGain(); g.gain.value = lv;
        src.connect(g); g.connect(head);
        src.start(t, k ? rnd() * 0.04 : 0);
        src.stop(end + 1.0);
        nodes.push(src);
      });
      out.connect(this.voiceBus[o.voice] || this.voiceBus.S);

      const peak = vel * smp.gain * 0.62 * (SAMPLE_TRIM[o.voice] || 1);
      const att = Math.min(0.14, dur * 0.5);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(peak, t + att);
      out.gain.setValueAtTime(peak, end);
      out.gain.setTargetAtTime(0, end, 0.12);

      const h = { out, nodes, end: end + 1.0 };
      this.active.add(h);
      nodes[0].onended = () => this.active.delete(h);
      return h;
    }

    noteOnSynth(o) {
      const ctx = this.ctx;
      const voice = FORMANTS[o.voice] ? o.voice : 'S';
      const vowel = FORMANTS[voice][o.vowel] ? o.vowel : 'A';
      const t = Math.max(o.t, ctx.currentTime);
      const dur = Math.max(0.05, o.dur);
      const vel = o.vel == null ? 0.9 : o.vel;
      const midi = o.midi;
      const f0 = mtof(midi);
      const rnd = this.rand;
      const [fr, db, bw] = FORMANTS[voice][vowel];

      const out = ctx.createGain();
      out.gain.value = 0;
      const pre = ctx.createGain();
      const nodes = [];

      // Vibrato com entrada gradual
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.0 + rnd() * 0.9;
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, t);
      lfoGain.gain.setValueAtTime(0, t + 0.25);
      lfoGain.gain.linearRampToValueAtTime(13, t + 0.9);
      lfo.connect(lfoGain);
      nodes.push(lfo);

      // Três osciladores levemente desafinados = efeito de coro (ensemble)
      const drift = (rnd() - 0.5) * 8;
      [-11, 0, 11].forEach((c) => {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(this.wave);
        osc.frequency.value = f0;
        osc.detune.value = c + drift;
        lfoGain.connect(osc.detune);
        const g = ctx.createGain();
        g.gain.value = 1 / 3;
        osc.connect(g);
        g.connect(pre);
        nodes.push(osc);
      });

      // Respiração
      const nz = ctx.createBufferSource();
      nz.buffer = this.noiseBuf;
      nz.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = 0.05;
      nz.connect(ng);
      ng.connect(pre);
      nodes.push(nz);

      // Banco de formantes em paralelo
      for (let i = 0; i < 5; i++) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fr[i];
        bp.Q.value = fr[i] / bw[i];
        const g = ctx.createGain();
        g.gain.value = dbToLin(db[i]);
        pre.connect(bp);
        bp.connect(g);
        g.connect(out);
      }
      out.connect(this.voiceBus[voice]);

      // Envelope: ataque suave, sustentação, saída em fade
      const peak = vel * loudnessComp(voice, vowel, midi);
      const att = Math.min(0.1, dur * 0.5);
      const end = t + dur;
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(peak, t + att);
      out.gain.setValueAtTime(peak, end);
      out.gain.setTargetAtTime(0, end, 0.08);
      const stopAt = end + 0.8;

      const rndOffset = rnd() * 1.5;
      nodes.forEach((n) => {
        if (n === nz) n.start(t, rndOffset);
        else n.start(t);
        n.stop(stopAt);
      });

      const h = { out, nodes, end: stopAt };
      this.active.add(h);
      nodes[1].onended = () => this.active.delete(h);
      return h;
    }

    /** Silencia tudo rapidamente (Stop / Pause). */
    stopAll() {
      const now = this.ctx.currentTime;
      this.active.forEach((h) => {
        try {
          h.out.gain.cancelScheduledValues(now);
          h.out.gain.setTargetAtTime(0, now, 0.025);
          h.nodes.forEach((n) => { try { n.stop(now + 0.15); } catch (e) { /* já parado */ } });
        } catch (e) { /* ignore */ }
      });
      this.active.clear();
    }

    preview(midi, voice, vowel, dur) {
      this.noteOn({ t: this.ctx.currentTime + 0.01, dur: dur || 0.7, midi, voice, vowel, vel: 0.9 });
    }
  }

  /* ───────────────────────── Utilidades de mixagem ───────────────────────── */

  function audibleLevel(voices, key) {
    const anySolo = VOICE_ORDER.some((k) => voices[k] && voices[k].solo);
    const v = voices[key];
    if (!v) return 0;
    if (v.mute) return 0;
    if (anySolo && !v.solo) return 0;
    return v.vol;
  }

  function applyVoiceLevels(engine, voices) {
    VOICE_ORDER.forEach((k) => engine.setVoiceLevel(k, audibleLevel(voices, k)));
  }

  /* ───────────────────────── Transporte (Play/Pause/Stop) ─────────────────────────
   * Agendador "lookahead": a cada 25 ms agenda as notas dos próximos ~150 ms.
   * Assim dá para editar, mudar o BPM e ligar/desligar o loop durante a reprodução.
   * Posições são medidas em "steps" (semicolcheias = 1/4 de tempo).
   */
  class Transport {
    constructor(host) {
      this.host = host; // { getLive, getNotes, getLength, getBpm, getLoop, getVowel, getVelocity, onEnd }
      this.state = 'stopped';
      this.pos = 0;
      this.timer = null;
    }

    sps() { return 60 / this.host.getBpm() / 4; }

    unwrapped() {
      if (this.state !== 'playing') return this.pos;
      const live = this.host.getLive();
      return Math.max(this.p0, this.p0 + (live.ctx.currentTime - this.t0) / this.sps());
    }

    position() {
      const L = this.host.getLength();
      if (this.state !== 'playing') return this.pos;
      let u = this.unwrapped();
      if (this.finishing) return Math.min(u, this.endStep);
      return L > 0 ? u % L : 0;
    }

    play() {
      if (this.state === 'playing') return;
      const live = this.host.getLive();
      const L = this.host.getLength();
      if (this.pos >= L) this.pos = 0;
      this.p0 = this.pos;
      this.sp = this.pos;
      this.t0 = live.ctx.currentTime + 0.06;
      this.finishing = false;
      this.state = 'playing';
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
    }

    pause() {
      if (this.state !== 'playing') return;
      this.pos = this.position();
      this.halt();
      this.state = 'paused';
    }

    stop() {
      if (this.state === 'stopped' && this.pos === 0) return;
      this.halt();
      this.state = 'stopped';
      this.pos = 0;
    }

    halt() {
      clearInterval(this.timer);
      this.timer = null;
      const live = this.host.getLive();
      live.engine.stopAll();
    }

    seek(step) {
      if (this.state === 'playing') {
        const live = this.host.getLive();
        live.engine.stopAll();
        this.p0 = step;
        this.sp = step;
        this.t0 = live.ctx.currentTime + 0.04;
        this.finishing = false;
      } else {
        this.pos = step;
        if (this.state === 'paused' || this.state === 'stopped') this.state = step > 0 ? 'paused' : 'stopped';
      }
    }

    /** Reancora o relógio (mudou o BPM ou o comprimento da peça durante o play). */
    rebase(wrapToLength) {
      if (this.state !== 'playing') return;
      const live = this.host.getLive();
      const now = live.ctx.currentTime;
      const uOld = this.unwrapped();
      const lead = Math.max(0, this.sp - uOld);
      this.p0 = wrapToLength ? uOld % Math.max(1, this.host.getLength()) : uOld;
      this.t0 = now;
      this.sp = this.p0 + lead;
    }

    tick() {
      if (this.state !== 'playing') return;
      const live = this.host.getLive();
      const ctx = live.ctx, engine = live.engine;
      const now = ctx.currentTime;
      const sps = this.sps();
      const L = this.host.getLength();
      const loop = this.host.getLoop();

      if (this.finishing) {
        if (now >= this.t0 + (this.endStep - this.p0) * sps + 0.35) {
          this.state = 'stopped';
          this.halt();
          this.pos = 0;
          this.host.onEnd();
        }
        return;
      }

      const target = this.p0 + (now + 0.15 - this.t0) / sps;
      let guard = 0;
      while (this.sp < target - 1e-9 && guard++ < 8) {
        const k = Math.floor(this.sp / L + 1e-9);
        const base = k * L;
        if (!loop && k >= 1 && this.sp - base < 1e-9) { this.finishing = true; this.endStep = base; break; }
        const lo = this.sp - base;
        const hiAbs = Math.min(target, base + L);
        const hi = hiAbs - base;
        const notes = this.host.getNotes();
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (n.s >= lo - 1e-9 && n.s < hi - 1e-9) {
            if (this.host.isAudible && !this.host.isAudible(n)) continue;
            const time = this.t0 + (base + n.s - this.p0) * sps;
            engine.noteOn({
              t: time, dur: n.d * sps, midi: n.m, voice: n.v,
              vowel: this.host.getVowel(n), vel: this.host.getVelocity(n),
            });
          }
        }
        this.sp = hiAbs;
        if (!loop && hiAbs >= base + L - 1e-9) { this.finishing = true; this.endStep = base + L; break; }
      }
    }
  }

  /* ───────────────────────── Renderização offline → WAV ───────────────────────── */

  const SAMPLE_RATE = 44100;

  /**
   * @param {{notes:Array, voices:Object, bpm:number, from:number, to:number,
   *          master:number, reverb:number}} spec  from/to em steps
   */
  async function renderToBuffer(spec) {
    const sps = 60 / spec.bpm / 4;
    const from = spec.from, to = spec.to;
    const tail = 3.0;
    const seconds = Math.max(0.5, (to - from) * sps) + tail;
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    if (spec.timbre !== 'synth') await Samples.load();
    const engine = new Engine(ctx, { master: 1, reverb: spec.reverb, timbre: spec.timbre });
    applyVoiceLevels(engine, spec.voices);
    spec.notes.forEach((n) => {
      if (n.s < from || n.s >= to) return;
      if (audibleLevel(spec.voices, n.v) <= 0) return;
      const d = Math.min(n.d, to - n.s);
      engine.noteOn({
        t: (n.s - from) * sps, dur: d * sps, midi: n.m, voice: n.v,
        vowel: n.o || spec.voices[n.v].vowel, vel: 0.9,
      });
    });
    return ctx.startRendering();
  }

  /** AudioBuffer → Blob WAV 16 bits (normalizado para -1 dBFS e sem silêncio final longo). */
  function encodeWav(buffer) {
    const chs = buffer.numberOfChannels;
    const data = [];
    for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
    let len = buffer.length;
    // corta o silêncio final (mantém no mínimo o corpo da música)
    let last = len - 1;
    while (last > 0) {
      let loud = false;
      for (let c = 0; c < chs; c++) if (Math.abs(data[c][last]) > 0.0008) { loud = true; break; }
      if (loud) break;
      last -= 64;
    }
    len = Math.min(len, Math.max(1, last + Math.floor(buffer.sampleRate * 0.15)));
    let peak = 0;
    for (let c = 0; c < chs; c++) for (let i = 0; i < len; i++) { const a = Math.abs(data[c][i]); if (a > peak) peak = a; }
    const gain = peak > 0 ? 0.89 / peak : 1;

    const bytes = 44 + len * chs * 2;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, chs, true);
    dv.setUint32(24, buffer.sampleRate, true); dv.setUint32(28, buffer.sampleRate * chs * 2, true);
    dv.setUint16(32, chs * 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, len * chs * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < chs; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i] * gain));
        dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  Object.assign(CC, {
    VOICE_ORDER, VOICES, VOWELS, FORMANTS, mtof, Samples,
    Engine, Transport, audibleLevel, applyVoiceLevels, renderToBuffer, encodeWav,
  });
})(typeof window !== 'undefined' ? window : globalThis);
