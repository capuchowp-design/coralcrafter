/* Coralcrafter – projeto, armazenamento local e exportações (JSON, MIDI, TXT, PNG) */
(function (global) {
  'use strict';
  const CC = (global.CC = global.CC || {});
  const { VOICES, VOICE_ORDER, VOWELS } = CC;

  /* ───────────────────────── Notas musicais ───────────────────────── */

  const NAMES_ABC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NAMES_DO = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const isBlack = (m) => [1, 3, 6, 8, 10].indexOf(((m % 12) + 12) % 12) >= 0;

  function noteName(midi, style) {
    const t = style === 'do' ? NAMES_DO : NAMES_ABC;
    return t[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  /** "C#4" → 61 */
  function parseNote(str) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(str);
    if (!m) throw new Error('Nota inválida: ' + str);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return (parseInt(m[3], 10) + 1) * 12 + base + acc;
  }

  /* ───────────────────────── Projeto ───────────────────────── */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const stepsPerMeasure = (p) => p.beats * 4;

  function defaultVoices() {
    const v = {};
    VOICE_ORDER.forEach((k) => { v[k] = { vol: 0.85, mute: false, solo: false, vowel: 'A' }; });
    return v;
  }

  function defaultProject() {
    return { v: 1, name: 'Novo projeto', bpm: 84, beats: 4, measures: 4, notes: [], voices: defaultVoices() };
  }

  /** Valida e normaliza qualquer objeto vindo de JSON/localStorage. */
  function sanitizeProject(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Arquivo de projeto inválido.');
    const p = defaultProject();
    p.name = String(raw.name || 'Sem título').slice(0, 80);
    p.bpm = clamp(Math.round(Number(raw.bpm) || 84), 30, 240);
    p.beats = clamp(Math.round(Number(raw.beats) || 4), 1, 12);
    p.measures = clamp(Math.round(Number(raw.measures) || 4), 1, 256);
    if (raw.voices && typeof raw.voices === 'object') {
      VOICE_ORDER.forEach((k) => {
        const s = raw.voices[k];
        if (!s) return;
        p.voices[k] = {
          vol: clamp(Number(s.vol) >= 0 ? Number(s.vol) : 0.85, 0, 1),
          mute: !!s.mute, solo: !!s.solo,
          vowel: VOWELS[s.vowel] ? s.vowel : 'A',
        };
      });
    }
    const list = Array.isArray(raw.notes) ? raw.notes : [];
    list.forEach((n) => {
      if (!n || typeof n !== 'object') return;
      const note = {
        v: VOICES[n.v] ? n.v : 'S',
        m: clamp(Math.round(Number(n.m)), 0, 127),
        s: Math.max(0, Math.round(Number(n.s))),
        d: Math.max(1, Math.round(Number(n.d) || 1)),
      };
      if (isNaN(note.m) || isNaN(note.s)) return;
      if (VOWELS[n.o]) note.o = n.o;
      p.notes.push(note);
    });
    const spm = stepsPerMeasure(p);
    let end = 0;
    p.notes.forEach((n) => { end = Math.max(end, n.s + n.d); });
    p.measures = clamp(Math.max(p.measures, Math.ceil(end / spm)), 1, 256);
    return p;
  }

  /* ───────────────────────── Armazenamento local ───────────────────────── */

  const LS = {
    get(key, fallback) {
      try { const s = global.localStorage.getItem(key); return s == null ? fallback : JSON.parse(s); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { global.localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove(key) { try { global.localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  const KEY_LIB = 'coralcrafter:library';
  const KEY_DRAFT = 'coralcrafter:draft';
  const KEY_SETTINGS = 'coralcrafter:settings';

  const library = {
    all() { const l = LS.get(KEY_LIB, {}); return l && typeof l === 'object' ? l : {}; },
    list() { return Object.values(library.all()).sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
    get(id) { return library.all()[id] || null; },
    put(entry) { const l = library.all(); l[entry.id] = entry; return LS.set(KEY_LIB, l); },
    remove(id) { const l = library.all(); delete l[id]; return LS.set(KEY_LIB, l); },
  };

  /* ───────────────────────── Download ───────────────────────── */

  function slug(name) {
    return (String(name || 'coralcrafter').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'coralcrafter');
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ───────────────────────── Exportar MIDI ───────────────────────── */

  const PPQ = 480;
  const TICKS_PER_STEP = PPQ / 4;

  function vlq(n) {
    const out = [n & 0x7f];
    while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
    return out;
  }
  const strBytes = (s) => Array.from(unescape(encodeURIComponent(s))).map((c) => c.charCodeAt(0));
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const be16 = (n) => [(n >> 8) & 255, n & 255];

  function chunk(type, bytes) {
    return [].concat(strBytes(type), be32(bytes.length), bytes);
  }

  /** range: {from, to} em steps. Exporta apenas vozes audíveis (mute/solo). */
  function toMidi(project, range) {
    const from = range.from, to = range.to;
    const tracks = [];

    const mpqn = Math.round(60000000 / project.bpm);
    let t0 = [];
    t0 = t0.concat([0x00, 0xff, 0x03], vlq(strBytes(project.name).length), strBytes(project.name));
    t0 = t0.concat([0x00, 0xff, 0x51, 0x03, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255]);
    t0 = t0.concat([0x00, 0xff, 0x58, 0x04, project.beats, 2, 24, 8]); // n/4
    t0 = t0.concat([0x00, 0xff, 0x2f, 0x00]);
    tracks.push(chunk('MTrk', t0));

    VOICE_ORDER.forEach((vk, idx) => {
      if (CC.audibleLevel(project.voices, vk) <= 0) return;
      const notes = project.notes.filter((n) => n.v === vk && n.s >= from && n.s < to);
      if (!notes.length) return;
      const vs = project.voices[vk];
      const ch = idx;
      const program = (vs.vowel === 'O' || vs.vowel === 'U') ? 53 /* Voice Oohs */ : 52 /* Choir Aahs */;
      const ev = [];
      notes.forEach((n) => {
        const d = Math.min(n.d, to - n.s);
        const vel = clamp(Math.round(40 + vs.vol * 70), 1, 127);
        ev.push({ t: (n.s - from) * TICKS_PER_STEP, order: 1, b: [0x90 | ch, n.m, vel] });
        ev.push({ t: (n.s - from + d) * TICKS_PER_STEP, order: 0, b: [0x80 | ch, n.m, 0] });
      });
      ev.sort((a, b) => a.t - b.t || a.order - b.order);
      const name = VOICES[vk].name;
      let tr = [0x00, 0xff, 0x03].concat(vlq(name.length), strBytes(name));
      tr = tr.concat([0x00, 0xc0 | ch, program]);
      let last = 0;
      ev.forEach((e) => { tr = tr.concat(vlq(e.t - last), e.b); last = e.t; });
      tr = tr.concat([0x00, 0xff, 0x2f, 0x00]);
      tracks.push(chunk('MTrk', tr));
    });

    const header = chunk('MThd', [].concat(be16(1), be16(tracks.length), be16(PPQ)));
    const all = header.concat.apply(header, tracks);
    return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
  }

  /* ───────────────────────── Exportar tablatura em texto ───────────────────────── */

  function toText(project, range, notation) {
    const spm = stepsPerMeasure(project);
    const from = range.from, to = range.to;
    const notes = project.notes.filter((n) => n.s >= from && n.s < to);
    let W = 3;
    notes.forEach((n) => { W = Math.max(W, noteName(n.m, notation).length); });
    const measuresTotal = Math.ceil((to - from) / spm);
    const perLine = Math.max(1, Math.floor(96 / (spm * W + 1)));
    const firstMeasure = Math.floor(from / spm) + 1;

    // distribui notas sobrepostas da mesma voz em "pistas" (S, S2, ...)
    const lanes = {};
    VOICE_ORDER.forEach((vk) => {
      lanes[vk] = [];
      notes.filter((n) => n.v === vk).sort((a, b) => a.s - b.s || a.m - b.m).forEach((n) => {
        let lane = lanes[vk].find((l) => l.end <= n.s);
        if (!lane) { lane = { end: 0, notes: [] }; lanes[vk].push(lane); }
        lane.notes.push(n);
        lane.end = n.s + n.d;
      });
      if (!lanes[vk].length) lanes[vk].push({ end: 0, notes: [] });
    });

    const L = [];
    L.push('CORALCRAFTER  ·  ' + project.name);
    L.push('Andamento: ♩ = ' + project.bpm + '   Compasso: ' + project.beats + '/4   Compassos: '
      + firstMeasure + '–' + (firstMeasure + measuresTotal - 1));
    L.push('Legenda: nome da nota marca o início; "-" prolonga; vazio = pausa; cada coluna = 1/16.');
    const vow = VOICE_ORDER.map((k) => k + '=' + VOWELS[project.voices[k].vowel].label).join('  ');
    L.push('Vogais: ' + vow);
    L.push('');

    for (let m0 = 0; m0 < measuresTotal; m0 += perLine) {
      const m1 = Math.min(measuresTotal, m0 + perLine);
      const labelW = 3;
      // régua de tempos
      let ruler = ' '.repeat(labelW) + ' ';
      for (let m = m0; m < m1; m++) {
        const cells = new Array(spm * W).fill(' ');
        const num = String(firstMeasure + m);
        for (let b = 0; b < project.beats; b++) {
          const label = b === 0 ? num : String(b + 1);
          for (let i = 0; i < label.length; i++) cells[b * 4 * W + i] = label[i];
        }
        ruler += cells.join('') + ' ';
      }
      L.push(ruler.replace(/\s+$/, ''));
      VOICE_ORDER.forEach((vk) => {
        lanes[vk].forEach((lane, li) => {
          const label = (vk + (li ? String(li + 1) : '')).padEnd(labelW) + '|';
          let line = label;
          for (let m = m0; m < m1; m++) {
            const cells = new Array(spm * W).fill(' ');
            lane.notes.forEach((n) => {
              const rel = n.s - from - m * spm;
              for (let k = 0; k < n.d; k++) {
                const col = rel + k;
                if (col < 0 || col >= spm) continue;
                const cell = k === 0 ? noteName(n.m, notation).padEnd(W, '-') : '-'.repeat(W);
                for (let i = 0; i < W; i++) cells[col * W + i] = cell[i];
              }
            });
            line += cells.join('') + '|';
          }
          L.push(line);
        });
      });
      L.push('');
    }
    return new Blob([L.join('\n')], { type: 'text/plain;charset=utf-8' });
  }

  /* ───────────────────────── Exportar imagem (PNG) ───────────────────────── */

  function toPng(project, range, notation) {
    const spm = stepsPerMeasure(project);
    const from = range.from, to = range.to;
    const notes = project.notes.filter((n) => n.s >= from && n.s < to);
    let lo = 60, hi = 72;
    notes.forEach((n) => { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); });
    lo -= 1; hi += 1;

    const stepW = 12, rowH = 15, keyW = 54, headH = 72, rulerH = 22, pad = 16;
    const steps = to - from;
    const rows = hi - lo + 1;
    const w1 = keyW + steps * stepW + pad * 2;
    const h1 = headH + rulerH + rows * rowH + pad * 2 + 22;
    const scale = Math.min(2, 12000 / w1);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w1 * scale);
    cv.height = Math.round(h1 * scale);
    const c = cv.getContext('2d');
    c.scale(scale, scale);

    const bg = '#0b0e17';
    c.fillStyle = bg; c.fillRect(0, 0, w1, h1);

    // título
    c.fillStyle = '#f2f4fb'; c.font = '700 20px system-ui, sans-serif'; c.textBaseline = 'alphabetic';
    c.fillText(project.name, pad, pad + 20);
    c.fillStyle = '#8b93ad'; c.font = '13px system-ui, sans-serif';
    const firstM = Math.floor(from / spm) + 1;
    const lastM = Math.ceil(to / spm);
    c.fillText('Coralcrafter  ·  ♩ = ' + project.bpm + '  ·  ' + project.beats + '/4  ·  compassos '
      + firstM + '–' + lastM, pad, pad + 40);
    // legenda de vozes
    let lx = pad;
    VOICE_ORDER.forEach((vk) => {
      c.fillStyle = VOICES[vk].color; c.fillRect(lx, pad + 50, 10, 10);
      c.fillStyle = '#cfd4e6'; c.font = '12px system-ui, sans-serif';
      const t = VOICES[vk].name + ' (' + VOWELS[project.voices[vk].vowel].label + ')';
      c.fillText(t, lx + 15, pad + 59);
      lx += 15 + c.measureText(t).width + 18;
    });

    const gx = pad + keyW, gy = pad + headH + rulerH;
    // linhas
    for (let r = 0; r < rows; r++) {
      const midi = hi - r;
      c.fillStyle = isBlack(midi) ? '#0e1220' : '#141a2b';
      c.fillRect(gx, gy + r * rowH, steps * stepW, rowH);
      c.fillStyle = isBlack(midi) ? '#0a0d17' : '#10151f';
      c.fillRect(pad, gy + r * rowH, keyW - 2, rowH - 1);
      if (!isBlack(midi)) {
        c.fillStyle = midi % 12 === 0 ? '#e7e9f3' : '#7d86a3';
        c.font = (midi % 12 === 0 ? '700 ' : '') + '10px system-ui, sans-serif';
        c.textBaseline = 'middle';
        c.fillText(noteName(midi, notation), pad + 6, gy + r * rowH + rowH / 2);
      }
      if (midi % 12 === 0) { c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(gx, gy + r * rowH + rowH - 1, steps * stepW, 1); }
    }
    // linhas verticais e régua
    c.textBaseline = 'alphabetic';
    for (let s = 0; s <= steps; s++) {
      const abs = from + s;
      const x = gx + s * stepW;
      const isM = abs % spm === 0, isB = abs % 4 === 0;
      if (!isB && stepW < 10) continue;
      c.fillStyle = isM ? 'rgba(255,255,255,.35)' : isB ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.05)';
      c.fillRect(x, gy - (isM ? rulerH : 0), 1, rows * rowH + (isM ? rulerH : 0));
      if (isM && s < steps) {
        c.fillStyle = '#cfd4e6'; c.font = '600 11px system-ui, sans-serif';
        c.fillText(String(abs / spm + 1), x + 4, gy - 7);
      }
    }
    // notas
    notes.forEach((n) => {
      const d = Math.min(n.d, to - n.s);
      const x = gx + (n.s - from) * stepW + 0.5;
      const y = gy + (hi - n.m) * rowH + 1;
      const w = d * stepW - 1;
      c.fillStyle = VOICES[n.v].color;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, rowH - 2, 3); else c.rect(x, y, w, rowH - 2);
      c.fill();
      c.fillStyle = 'rgba(8,10,18,.85)'; c.font = '700 9px system-ui, sans-serif'; c.textBaseline = 'middle';
      const vow = (n.o || project.voices[n.v].vowel);
      const label = w > 40 ? vow + ' ' + noteName(n.m, notation) : (w > 12 ? vow : '');
      if (label) c.fillText(label, x + 3, y + (rowH - 2) / 2 + 0.5);
    });
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#5b6483'; c.font = '10px system-ui, sans-serif';
    c.fillText('Criado com Coralcrafter', pad, h1 - 8);

    return new Promise((resolve, reject) => {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/png');
    });
  }

  function toJson(project) {
    const out = {
      v: 1, app: 'coralcrafter', name: project.name, bpm: project.bpm, beats: project.beats,
      measures: project.measures, voices: project.voices,
      notes: project.notes.map((n) => { const o = { v: n.v, m: n.m, s: n.s, d: n.d }; if (n.o) o.o = n.o; return o; }),
    };
    return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  }

  Object.assign(CC, {
    noteName, parseNote, isBlack, clamp, stepsPerMeasure,
    defaultProject, defaultVoices, sanitizeProject,
    LS, KEY_DRAFT, KEY_SETTINGS, library,
    slug, download, toMidi, toText, toPng, toJson,
  });
})(typeof window !== 'undefined' ? window : globalThis);
