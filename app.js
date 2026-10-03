/* Coralcrafter – editor (interface, interação e ligação com o motor de áudio) */
(function () {
  'use strict';
  const CC = window.CC;
  const { VOICES, VOICE_ORDER, VOWELS, noteName, clamp } = CC;

  /* ───────────────────────── Constantes e estado ───────────────────────── */

  const MIN_MIDI = 24;           // C1
  const MAX_MIDI = 84;           // C6
  const NROWS = MAX_MIDI - MIN_MIDI + 1;
  const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const ROW_H = COARSE ? 24 : 20;
  const KEY_W = 54;
  const RULER_H = 28;
  const ZOOMS = [8, 10, 12, 14, 17, 20, 24, 28, 34, 40, 48];
  const MAX_MEASURES = 256;

  const CHORDS = {
    maj: [0, 4, 7], min: [0, 3, 7], dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7],
  };

  const defaults = {
    zoom: COARSE ? 26 : 20, notation: 'do', master: 0.8, reverb: 0.35,
    loop: true, follow: true, snap: 2, dur: 4, voice: 'S', chord: 'maj', timbre: 'coral',
  };
  const settings = Object.assign({}, defaults, CC.LS.get(CC.KEY_SETTINGS, {}));
  settings.zoom = ZOOMS.indexOf(settings.zoom) >= 0 ? settings.zoom : defaults.zoom;
  if (!VOICES[settings.voice]) settings.voice = 'S';
  if (!CHORDS[settings.chord]) settings.chord = 'maj';
  const saveSettings = () => CC.LS.set(CC.KEY_SETTINGS, settings);

  let P = CC.defaultProject();
  let nextId = 1;
  let currentId = null;
  let dirty = false;
  let tool = 'note';
  let selection = new Set();
  let undoStack = [], redoStack = [];
  const noteEls = new Map();

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const spm = () => P.beats * 4;
  const totalSteps = () => P.measures * spm();
  const stepW = () => settings.zoom;

  /* ───────────────────────── Áudio ao vivo ───────────────────────── */

  let live = null;
  function getLive() {
    if (!live) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Este navegador não suporta Web Audio API.');
      const ctx = new AC({ latencyHint: 'interactive' });
      const engine = new CC.Engine(ctx, { master: settings.master, reverb: settings.reverb, timbre: settings.timbre });
      CC.applyVoiceLevels(engine, P.voices);
      live = { ctx, engine };
    }
    if (live.ctx.state === 'suspended') live.ctx.resume();
    return live;
  }
  const syncLevels = () => { if (live) CC.applyVoiceLevels(live.engine, P.voices); };

  function preview(notes) {
    try {
      const { engine } = getLive();
      (Array.isArray(notes) ? notes : [notes]).forEach((n) => {
        engine.preview(n.m, n.v, n.o || P.voices[n.v].vowel, 0.8);
      });
    } catch (e) { toast(e.message, true); }
  }

  const transport = new CC.Transport({
    getLive,
    getNotes: () => P.notes,
    getLength: totalSteps,
    getBpm: () => P.bpm,
    getLoop: () => settings.loop,
    getVowel: (n) => n.o || P.voices[n.v].vowel,
    getVelocity: () => 0.9,
    isAudible: (n) => CC.audibleLevel(P.voices, n.v) > 0,
    onEnd: () => { updatePlayButton(); updatePlayhead(0); },
  });

  /* ───────────────────────── Projeto: carregar / serializar ───────────────────────── */

  function serialize() {
    return {
      v: 1, name: P.name, bpm: P.bpm, beats: P.beats, measures: P.measures, voices: P.voices,
      notes: P.notes.map((n) => { const o = { v: n.v, m: n.m, s: n.s, d: n.d }; if (n.o) o.o = n.o; return o; }),
    };
  }

  function loadProject(raw, id) {
    transport.stop();
    P = CC.sanitizeProject(raw);
    P.notes.forEach((n) => { n.id = nextId++; });
    currentId = id || null;
    selection = new Set();
    undoStack = []; redoStack = [];
    dirty = false;
    syncProjectUI();
    syncLevels();
    scrollToMidi(avgPitch());
    scheduleDraft();
  }

  function avgPitch() {
    if (!P.notes.length) return 66;
    return Math.round(P.notes.reduce((a, n) => a + n.m, 0) / P.notes.length);
  }

  /* ───────────────────────── Histórico (desfazer / refazer) ───────────────────────── */

  const snapshot = () => JSON.stringify({ notes: P.notes, measures: P.measures });
  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  function restore(json) {
    const s = JSON.parse(json);
    P.notes = s.notes; P.measures = s.measures;
    selection = new Set(Array.from(selection).filter((id) => P.notes.some((n) => n.id === id)));
    applyLayout(); renderNotes(); updateSelectionUI(); changed(false);
    if (transport.state === 'playing') transport.rebase(true);
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); updateHistoryButtons(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); updateHistoryButtons(); }
  function updateHistoryButtons() {
    $('#btnUndo').disabled = !undoStack.length;
    $('#btnRedo').disabled = !redoStack.length;
    $('#btnUndo').style.opacity = undoStack.length ? 1 : .4;
    $('#btnRedo').style.opacity = redoStack.length ? 1 : .4;
  }

  /* ───────────────────────── Alterações, rascunho e status ───────────────────────── */

  let draftTimer = null;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => CC.LS.set(CC.KEY_DRAFT, { data: serialize(), id: currentId }), 350);
  }
  function flushDraft() { clearTimeout(draftTimer); CC.LS.set(CC.KEY_DRAFT, { data: serialize(), id: currentId }); }
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });
  function changed(markDirty) {
    if (markDirty !== false) { dirty = true; updateDirty(); }
    scheduleDraft();
  }
  function updateDirty() {
    const d = $('#saveDot');
    d.classList.toggle('saved', !dirty && !!currentId);
    d.title = dirty ? 'Alterações não salvas' : (currentId ? 'Salvo neste navegador' : 'Rascunho automático');
  }

  /* ───────────────────────── Toast ───────────────────────── */

  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 4200 : 2200);
  }

  /* ───────────────────────── Grade: construção ───────────────────────── */

  const roll = $('#roll');
  let gridEl, notesEl, vlinesEl, rulerEl, keysEl, playheadEl, capEl;
  const rowEls = [], keyEls = [];

  function buildRoll() {
    roll.innerHTML = '';
    const inner = document.createElement('div'); inner.className = 'roll-inner';
    const corner = document.createElement('div'); corner.className = 'corner';
    rulerEl = document.createElement('div'); rulerEl.className = 'ruler';
    keysEl = document.createElement('div'); keysEl.className = 'keys';
    gridEl = document.createElement('div'); gridEl.className = 'grid';
    vlinesEl = document.createElement('div'); vlinesEl.className = 'vlines';
    notesEl = document.createElement('div'); notesEl.className = 'notes';
    playheadEl = document.createElement('div'); playheadEl.className = 'playhead';
    capEl = document.createElement('div'); capEl.className = 'phead-cap';

    const rowsFrag = document.createDocumentFragment();
    const keysFrag = document.createDocumentFragment();
    for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi--) {
      const blk = CC.isBlack(midi), isC = midi % 12 === 0;
      const r = document.createElement('div');
      r.className = 'row' + (blk ? ' blk' : '') + (isC ? ' c' : '');
      r.dataset.m = midi;
      rowsFrag.appendChild(r); rowEls.push(r);
      const k = document.createElement('div');
      k.className = 'key' + (blk ? ' blk' : '') + (isC ? ' c' : '');
      k.dataset.m = midi;
      keyEls.push(k); keysFrag.appendChild(k);
    }
    gridEl.appendChild(rowsFrag);
    gridEl.appendChild(vlinesEl);
    gridEl.appendChild(notesEl);
    gridEl.appendChild(playheadEl);
    keysEl.appendChild(keysFrag);
    rulerEl.appendChild(capEl);
    inner.append(corner, rulerEl, keysEl, gridEl);
    roll.appendChild(inner);

    roll.style.setProperty('--row-h', ROW_H + 'px');
    roll.style.setProperty('--key-w', KEY_W + 'px');
    roll.style.setProperty('--ruler-h', RULER_H + 'px');
    document.documentElement.style.setProperty('--row-h', ROW_H + 'px');

    attachGridEvents();
    labelKeys();
  }

  function labelKeys() {
    keyEls.forEach((k) => {
      const m = +k.dataset.m;
      k.textContent = CC.isBlack(m) ? '' : noteName(m, settings.notation);
    });
  }

  function applyLayout() {
    const w = stepW(), sp = spm();
    roll.style.setProperty('--step-w', w + 'px');
    roll.style.setProperty('--beat-w', (4 * w) + 'px');
    roll.style.setProperty('--measure-w', (sp * w) + 'px');
    roll.style.setProperty('--grid-w', (totalSteps() * w) + 'px');
    roll.style.setProperty('--grid-h', (NROWS * ROW_H) + 'px');
    // números de compasso
    Array.from(rulerEl.querySelectorAll('.mnum')).forEach((e) => e.remove());
    const frag = document.createDocumentFragment();
    for (let m = 0; m < P.measures; m++) {
      const s = document.createElement('span');
      s.className = 'mnum'; s.textContent = m + 1; s.style.left = (m * sp * w) + 'px';
      frag.appendChild(s);
    }
    rulerEl.appendChild(frag);
    // alinhamento do cursor
    updatePlayhead(transport.position());
    $('#measCount').textContent = P.measures;
    // as linhas finas de semicolcheia somem quando o zoom é pequeno
    vlinesEl.style.backgroundSize = w < 11
      ? 'var(--measure-w) 100%, var(--beat-w) 100%, 0 0'
      : 'var(--measure-w) 100%, var(--beat-w) 100%, var(--step-w) 100%';
  }

  function updateRangeTint() {
    const v = VOICES[settings.voice];
    roll.style.setProperty('--vc', v.color);
    rowEls.forEach((r) => r.classList.toggle('rng', +r.dataset.m >= v.lo && +r.dataset.m <= v.hi));
    keyEls.forEach((k) => k.classList.toggle('rng', +k.dataset.m >= v.lo && +k.dataset.m <= v.hi));
  }

  function scrollToMidi(midi) {
    const y = (MAX_MIDI - midi) * ROW_H + RULER_H;
    roll.scrollTop = Math.max(0, y - roll.clientHeight / 2);
    roll.scrollLeft = 0;
  }

  /* ───────────────────────── Notas: renderização ───────────────────────── */

  function positionNote(el, n) {
    const w = stepW();
    el.style.left = (n.s * w) + 'px';
    el.style.top = ((MAX_MIDI - n.m) * ROW_H + 1) + 'px';
    el.style.width = Math.max(4, n.d * w - 1) + 'px';
    el.style.height = (ROW_H - 2) + 'px';
  }

  function labelNote(el, n) {
    const w = n.d * stepW();
    const vow = n.o || P.voices[n.v].vowel;
    el.textContent = w >= 46 ? VOWELS[vow].label + ' ' + noteName(n.m, settings.notation) : (w >= 22 ? VOWELS[vow].label : '');
    const v = VOICES[n.v];
    el.classList.toggle('out', n.m < v.lo || n.m > v.hi);
    el.title = v.name + ' · ' + noteName(n.m, settings.notation) + ' · ' + VOWELS[vow].label
      + (n.m < v.lo || n.m > v.hi ? ' (fora da tessitura confortável)' : '');
  }

  function makeNoteEl(n) {
    const el = document.createElement('div');
    el.className = 'note' + (selection.has(n.id) ? ' sel' : '');
    el.dataset.id = n.id;
    el.style.setProperty('--nc', VOICES[n.v].color);
    positionNote(el, n);
    labelNote(el, n);
    el.addEventListener('pointerdown', (e) => onNoteDown(e, n.id));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); pushHistory(); removeNotes([n.id]); });
    return el;
  }

  function renderNotes() {
    notesEl.textContent = '';
    noteEls.clear();
    const frag = document.createDocumentFragment();
    P.notes.forEach((n) => { const el = makeNoteEl(n); noteEls.set(n.id, el); frag.appendChild(el); });
    notesEl.appendChild(frag);
  }

  const byId = (id) => P.notes.find((n) => n.id === id);

  function refreshNote(n) {
    const el = noteEls.get(n.id);
    if (!el) return;
    el.style.setProperty('--nc', VOICES[n.v].color);
    positionNote(el, n); labelNote(el, n);
  }

  function removeNotes(ids) {
    const set = new Set(ids);
    P.notes = P.notes.filter((n) => !set.has(n.id));
    ids.forEach((id) => { const el = noteEls.get(id); if (el) el.remove(); noteEls.delete(id); selection.delete(id); });
    updateSelectionUI(); changed();
  }

  function ensureMeasures(endStep) {
    const need = Math.min(MAX_MEASURES, Math.ceil(endStep / spm()));
    if (need > P.measures) {
      P.measures = need; applyLayout();
      if (transport.state === 'playing') transport.rebase(true);
      return true;
    }
    return false;
  }

  /* ───────────────────────── Seleção ───────────────────────── */

  function updateSelectionUI() {
    noteEls.forEach((el, id) => el.classList.toggle('sel', selection.has(id)));
    const n = selection.size;
    $('#selbar').classList.toggle('hidden', n === 0);
    if (n) {
      $('#selCount').textContent = n + (n === 1 ? ' nota' : ' notas');
      const sel = Array.from(selection).map(byId).filter(Boolean);
      const vowels = new Set(sel.map((x) => x.o || ''));
      $('#selVowel').value = vowels.size === 1 ? Array.from(vowels)[0] : '';
    }
  }

  function selectOnly(ids) { selection = new Set(ids); updateSelectionUI(); }

  /* ───────────────────────── Interação com a grade ───────────────────────── */

  function cellAt(clientX, clientY) {
    const r = gridEl.getBoundingClientRect();
    const sn = settings.snap;
    const step = Math.floor((clientX - r.left) / stepW() / sn) * sn;
    const row = Math.floor((clientY - r.top) / ROW_H);
    return { step, midi: MAX_MIDI - row };
  }

  function addNote(v, midi, step, d) {
    const n = { id: nextId++, v, m: midi, s: step, d };
    P.notes.push(n);
    return n;
  }

  function attachGridEvents() {
    let tap = null;
    gridEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.note')) return;
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    });
    gridEl.addEventListener('pointermove', (e) => {
      if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
    });
    gridEl.addEventListener('pointercancel', () => { tap = null; });
    gridEl.addEventListener('pointerup', (e) => {
      if (!tap || tap.id !== e.pointerId) return;
      const t = tap; tap = null;
      onGridTap(e.clientX, e.clientY, t.shift);
    });

    rulerEl.addEventListener('pointerdown', (e) => {
      const r = rulerEl.getBoundingClientRect();
      const sn = Math.max(settings.snap, 1);
      const step = clamp(Math.floor((e.clientX - r.left) / stepW() / sn) * sn, 0, totalSteps() - 1);
      transport.seek(step);
      updatePlayhead(step);
    });

    keysEl.addEventListener('pointerdown', (e) => {
      const k = e.target.closest('.key');
      if (!k) return;
      preview({ m: +k.dataset.m, v: settings.voice });
    });

    roll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  function onGridTap(x, y, shift) {
    const c = cellAt(x, y);
    if (c.midi < MIN_MIDI || c.midi > MAX_MIDI || c.step < 0) return;
    if (tool === 'erase') return;
    if (c.step >= MAX_MEASURES * spm()) return;
    if (tool === 'chord') { stampChord(c.midi, c.step); return; }
    pushHistory();
    const d = Math.min(settings.dur, MAX_MEASURES * spm() - c.step);
    const n = addNote(settings.voice, c.midi, c.step, d);
    ensureMeasures(c.step + d);
    if (shift) selection.add(n.id); else selection = new Set([n.id]);
    const el = makeNoteEl(n); noteEls.set(n.id, el); notesEl.appendChild(el);
    updateSelectionUI(); changed();
    preview(n);
  }

  /* arrastar / redimensionar */
  let drag = null;
  function onNoteDown(e, id) {
    if (e.button === 2) return;
    e.stopPropagation(); e.preventDefault();
    const n = byId(id);
    if (!n) return;
    if (tool === 'erase') { pushHistory(); removeNotes([id]); return; }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) { selection.has(id) ? selection.delete(id) : selection.add(id); }
    else if (!selection.has(id)) selection = new Set([id]);
    updateSelectionUI();
    if (!selection.has(id)) return;

    const el = noteEls.get(id);
    const rect = el.getBoundingClientRect();
    const grab = e.pointerType === 'touch' ? 16 : 9;
    const nearEnd = rect.right - e.clientX <= Math.min(grab, rect.width * 0.45);
    const orig = new Map();
    selection.forEach((sid) => { const sn = byId(sid); if (sn) orig.set(sid, { s: sn.s, m: sn.m, d: sn.d }); });
    drag = {
      mode: nearEnd ? 'resize' : 'move', id, pid: e.pointerId, x0: e.clientX, y0: e.clientY,
      orig, moved: false, lastMidi: n.m, pushed: false, wasMulti: selection.size > 1 && !additive,
    };
    if (!nearEnd) preview(n);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dxPx = e.clientX - drag.x0, dyPx = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < 4) return;
    if (!drag.pushed) { pushHistory(); drag.pushed = true; }
    drag.moved = true;
    const sn = settings.snap;
    let ds = Math.round(dxPx / stepW() / sn) * sn;

    if (drag.mode === 'move') {
      let dm = -Math.round(dyPx / ROW_H);
      let minS = Infinity, minM = Infinity, maxM = -Infinity;
      drag.orig.forEach((o) => { minS = Math.min(minS, o.s); minM = Math.min(minM, o.m); maxM = Math.max(maxM, o.m); });
      ds = Math.max(ds, -minS);
      dm = clamp(dm, MIN_MIDI - minM, MAX_MIDI - maxM);
      let maxEnd = 0;
      drag.orig.forEach((o, sid) => {
        const nn = byId(sid); if (!nn) return;
        nn.s = o.s + ds; nn.m = o.m + dm;
        maxEnd = Math.max(maxEnd, nn.s + nn.d);
        refreshNote(nn);
      });
      ensureMeasures(maxEnd);
      const main = byId(drag.id);
      if (main && main.m !== drag.lastMidi) { drag.lastMidi = main.m; preview(main); }
    } else {
      let maxEnd = 0;
      drag.orig.forEach((o, sid) => {
        const nn = byId(sid); if (!nn) return;
        nn.d = clamp(o.d + ds, 1, MAX_MEASURES * spm() - nn.s);
        maxEnd = Math.max(maxEnd, nn.s + nn.d);
        refreshNote(nn);
      });
      ensureMeasures(maxEnd);
    }
  }

  function onDragEnd(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pid)) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    if (drag.moved) changed();
    else if (drag.wasMulti) selectOnly([drag.id]);
    drag = null;
  }

  /* ───────────────────────── Acorde coral (SATB automático) ───────────────────────── */

  function voiceChord(rootPc, intervals) {
    const pcs = intervals.map((i) => (rootPc + i) % 12);
    const pick = (lo, hi, pc, atLeast) => {
      for (let m = Math.max(lo, atLeast); m <= hi; m++) if (m % 12 === pc) return m;
      return null;
    };
    // baixo: fundamental mais próxima de C3 dentro da tessitura
    const B = VOICES.B;
    let bass = null, bestD = 1e9;
    for (let m = B.lo; m <= B.hi; m++) if (m % 12 === rootPc && Math.abs(m - 48) < bestD) { bass = m; bestD = Math.abs(m - 48); }
    if (bass == null) bass = B.lo;
    const result = { B: bass };
    let unused = pcs.length >= 4 ? pcs.slice(1) : pcs.slice(1).concat([pcs[0]]);
    let prev = bass;
    ['T', 'A', 'S'].forEach((vk) => {
      const V = VOICES[vk];
      const center = (V.lo + V.hi) / 2;
      const floor = Math.max(prev + 1, Math.round(center - 8));
      let best = null, bestPc = null;
      unused.forEach((pc) => {
        const m = pick(V.lo, V.hi, pc, floor);
        if (m != null && (best == null || m < best)) { best = m; bestPc = pc; }
      });
      if (best == null) { // fallback: o mais próximo do centro
        let bd = 1e9;
        unused.forEach((pc) => { for (let m = V.lo; m <= V.hi; m++) if (m % 12 === pc && Math.abs(m - center) < bd) { best = m; bestPc = pc; bd = Math.abs(m - center); } });
      }
      if (best == null) best = V.lo;
      result[vk] = best;
      unused.splice(unused.indexOf(bestPc), 1);
      prev = best;
    });
    return result;
  }

  function stampChord(midi, step) {
    const v = voiceChord(midi % 12, CHORDS[settings.chord]);
    pushHistory();
    const d = Math.min(settings.dur, MAX_MEASURES * spm() - step);
    const created = VOICE_ORDER.map((vk) => addNote(vk, v[vk], step, d));
    ensureMeasures(step + d);
    renderNotes();
    selectOnly(created.map((n) => n.id));
    changed();
    preview(created);
  }

  /* ───────────────────────── Edição da seleção ───────────────────────── */

  const selected = () => Array.from(selection).map(byId).filter(Boolean);

  function deleteSelection() {
    if (!selection.size) return;
    pushHistory(); removeNotes(Array.from(selection));
  }

  function transposeSelection(semi) {
    const sel = selected();
    if (!sel.length) return;
    if (sel.some((n) => n.m + semi < MIN_MIDI || n.m + semi > MAX_MIDI)) { toast('Fora da extensão da grade'); return; }
    pushHistory();
    sel.forEach((n) => { n.m += semi; refreshNote(n); });
    changed(); preview(sel.slice(0, 4));
  }

  function moveSelection(dsteps) {
    const sel = selected();
    if (!sel.length) return;
    const minS = Math.min.apply(null, sel.map((n) => n.s));
    dsteps = Math.max(dsteps, -minS);
    if (!dsteps) return;
    pushHistory();
    let maxEnd = 0;
    sel.forEach((n) => { n.s += dsteps; maxEnd = Math.max(maxEnd, n.s + n.d); refreshNote(n); });
    ensureMeasures(maxEnd); changed();
  }

  function duplicateSelection() {
    const sel = selected();
    if (!sel.length) return;
    const minS = Math.min.apply(null, sel.map((n) => n.s));
    const maxE = Math.max.apply(null, sel.map((n) => n.s + n.d));
    const off = maxE - minS;
    if (maxE + off > MAX_MEASURES * spm()) { toast('Limite de compassos atingido'); return; }
    pushHistory();
    const created = sel.map((n) => {
      const c = addNote(n.v, n.m, n.s + off, n.d);
      if (n.o) c.o = n.o;
      return c;
    });
    ensureMeasures(maxE + off);
    renderNotes();
    selectOnly(created.map((n) => n.id));
    changed();
  }

  function setSelectionVoice(vk) {
    const sel = selected();
    if (!sel.length) return;
    pushHistory();
    sel.forEach((n) => { n.v = vk; refreshNote(n); });
    changed(); preview(sel.slice(0, 4));
  }

  function setSelectionVowel(o) {
    const sel = selected();
    if (!sel.length) return;
    pushHistory();
    sel.forEach((n) => { if (o) n.o = o; else delete n.o; refreshNote(n); });
    changed(); preview(sel.slice(0, 4));
  }

  function setDuration(d) {
    settings.dur = d; saveSettings();
    $$('#durGroup .dur').forEach((b) => b.classList.toggle('on', +b.dataset.d === d));
    const sel = selected();
    if (sel.length) {
      pushHistory();
      let maxEnd = 0;
      sel.forEach((n) => { n.d = Math.min(d, MAX_MEASURES * spm() - n.s); maxEnd = Math.max(maxEnd, n.s + n.d); refreshNote(n); });
      ensureMeasures(maxEnd); changed();
    }
  }

  /* ───────────────────────── Ferramentas / zoom ───────────────────────── */

  function setTool(t) {
    tool = t;
    $$('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#selChord').classList.toggle('hidden', t !== 'chord');
    gridEl.classList.toggle('erasing', t === 'erase');
  }

  function zoom(dir) {
    const i = ZOOMS.indexOf(settings.zoom);
    const j = clamp(i + dir, 0, ZOOMS.length - 1);
    if (j === i) return;
    const frac = roll.scrollLeft / Math.max(1, roll.scrollWidth);
    settings.zoom = ZOOMS[j]; saveSettings();
    applyLayout(); renderNotes();
    roll.scrollLeft = frac * roll.scrollWidth;
  }

  function setActiveVoice(vk) {
    settings.voice = vk; saveSettings();
    $$('.voice').forEach((e) => e.classList.toggle('active', e.dataset.v === vk));
    updateRangeTint();
  }

  /* ───────────────────────── Painel de vozes ───────────────────────── */

  function buildVoicePanel() {
    const list = $('#voiceList');
    list.innerHTML = '';
    VOICE_ORDER.forEach((vk) => {
      const V = VOICES[vk];
      const el = document.createElement('div');
      el.className = 'voice'; el.dataset.v = vk; el.style.setProperty('--vc', V.color);
      el.innerHTML =
        '<span class="badge">' + vk + '</span>' +
        '<div><div class="vname">' + V.name + '</div><div class="vrange"></div></div>' +
        '<select aria-label="Vogal de ' + V.name + '">' +
        Object.keys(VOWELS).map((k) => '<option value="' + k + '">' + VOWELS[k].label + '</option>').join('') +
        '</select>' +
        '<div class="ms"><button class="m" aria-pressed="false" title="Mudo" aria-label="Mudo">M</button>' +
        '<button class="s" aria-pressed="false" title="Solo" aria-label="Solo">S</button></div>' +
        '<input class="vol" type="range" min="0" max="1" step="0.01" aria-label="Volume de ' + V.name + '">';
      list.appendChild(el);

      el.addEventListener('click', (e) => { if (!e.target.closest('select,button,input')) setActiveVoice(vk); });
      $('select', el).addEventListener('change', (e) => {
        P.voices[vk].vowel = e.target.value;
        renderNotes(); changed(); preview({ m: Math.round((V.lo + V.hi) / 2), v: vk });
      });
      $('.m', el).addEventListener('click', () => { P.voices[vk].mute = !P.voices[vk].mute; syncVoicePanel(); syncLevels(); changed(); });
      $('.s', el).addEventListener('click', () => { P.voices[vk].solo = !P.voices[vk].solo; syncVoicePanel(); syncLevels(); changed(); });
      $('.vol', el).addEventListener('input', (e) => { P.voices[vk].vol = +e.target.value; syncLevels(); changed(); });
    });

    const sv = $('#selVoices');
    sv.innerHTML = '';
    VOICE_ORDER.forEach((vk) => {
      const b = document.createElement('button');
      b.className = 'vbtn'; b.textContent = vk; b.style.setProperty('--vc', VOICES[vk].color);
      b.title = 'Passar para ' + VOICES[vk].name; b.setAttribute('aria-label', 'Passar para ' + VOICES[vk].name);
      b.addEventListener('click', () => setSelectionVoice(vk));
      sv.appendChild(b);
    });
  }

  function syncVoicePanel() {
    VOICE_ORDER.forEach((vk) => {
      const el = $('.voice[data-v="' + vk + '"]'), s = P.voices[vk], V = VOICES[vk];
      $('select', el).value = s.vowel;
      $('.m', el).setAttribute('aria-pressed', String(s.mute));
      $('.s', el).setAttribute('aria-pressed', String(s.solo));
      $('.vol', el).value = s.vol;
      $('.vrange', el).textContent = noteName(V.lo, settings.notation) + ' – ' + noteName(V.hi, settings.notation);
      el.classList.toggle('active', vk === settings.voice);
    });
  }

  /* ───────────────────────── Transporte: UI ───────────────────────── */

  function updatePlayButton() {
    const playing = transport.state === 'playing';
    $('#btnPlay').innerHTML = '<svg class="i"><use href="#i-' + (playing ? 'pause' : 'play') + '"/></svg>';
    $('#btnPlay').setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
    if (playing) startFrameLoop();
  }

  function updatePlayhead(pos) {
    if (!playheadEl) return;
    const x = pos * stepW();
    playheadEl.style.transform = 'translateX(' + x + 'px)';
    capEl.style.transform = 'translateX(' + x + 'px)';
    const sp = spm();
    $('#posLabel').textContent = (Math.floor(pos / sp) + 1) + ' · ' + (Math.floor((pos % sp) / 4) + 1);
  }

  const playingCache = new Map();
  let rafId = null;
  function startFrameLoop() {
    if (rafId) return;
    const frame = () => {
      const pos = transport.position();
      updatePlayhead(pos);
      if (settings.follow && transport.state === 'playing') {
        const x = pos * stepW();
        const vis0 = roll.scrollLeft, vis1 = roll.scrollLeft + roll.clientWidth - KEY_W;
        if (x > vis1 - 70 || x < vis0) roll.scrollLeft = Math.max(0, x - 60);
      }
      if (transport.state === 'playing') {
        for (let i = 0; i < P.notes.length; i++) {
          const n = P.notes[i], on = pos >= n.s && pos < n.s + n.d;
          if (playingCache.get(n.id) !== on) { playingCache.set(n.id, on); const el = noteEls.get(n.id); if (el) el.classList.toggle('playing', on); }
        }
      }
      if (transport.state === 'playing') rafId = requestAnimationFrame(frame);
      else {
        rafId = null;
        noteEls.forEach((el) => el.classList.remove('playing')); playingCache.clear();
        updatePlayhead(transport.position());
      }
    };
    rafId = requestAnimationFrame(frame);
  }

  function togglePlay() {
    try {
      getLive();
      if (transport.state === 'playing') transport.pause(); else transport.play();
    } catch (e) { toast(e.message, true); }
    updatePlayButton();
  }
  function stopPlay() { try { transport.stop(); } catch (e) { /* sem áudio ainda */ } updatePlayButton(); updatePlayhead(0); roll.scrollLeft = 0; }

  function setBpm(v) {
    v = clamp(Math.round(+v || P.bpm), 30, 240);
    if (v === P.bpm) { $('#bpmInput').value = v; return; }
    if (transport.state === 'playing') transport.rebase(false);
    P.bpm = v;
    $('#bpmInput').value = v;
    changed();
  }

  /* ───────────────────────── Sincronizar toda a interface ───────────────────────── */

  function syncProjectUI() {
    $('#projName').value = P.name;
    $('#bpmInput').value = P.bpm;
    $('#selBeats').value = String(P.beats);
    $('#selSnap').value = String(settings.snap);
    $('#selNotation').value = settings.notation;
    $('#rngReverb').value = settings.reverb;
    $('#selTimbre').value = settings.timbre;
    $('#rngMaster').value = settings.master;
    $('#selChord').value = settings.chord;
    $$('#durGroup .dur').forEach((b) => b.classList.toggle('on', +b.dataset.d === settings.dur));
    $('#btnLoop').setAttribute('aria-pressed', String(settings.loop));
    $('#btnFollow').setAttribute('aria-pressed', String(settings.follow));
    syncVoicePanel();
    updateRangeTint();
    applyLayout();
    renderNotes();
    updateSelectionUI();
    updateHistoryButtons();
    updateDirty();
    updatePlayButton();
    updatePlayhead(0);
  }

  /* ───────────────────────── Projetos: novo / salvar / biblioteca ───────────────────────── */

  function newProject() {
    if (dirty && P.notes.length && !confirm('Há alterações não salvas. Criar um novo projeto mesmo assim?')) return;
    loadProject(CC.defaultProject(), null);
    closeSidebar();
    toast('Novo projeto criado');
  }

  function saveProject() {
    const id = currentId || ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const ok = CC.library.put({ id, name: P.name, updated: Date.now(), data: serialize() });
    if (!ok) { toast('Não foi possível salvar (armazenamento cheio ou bloqueado). Use Exportar → JSON.', true); return; }
    currentId = id; dirty = false; updateDirty(); scheduleDraft();
    toast('Projeto salvo neste navegador');
  }

  function fmtDate(t) {
    try { return new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; }
  }

  function renderLibrary() {
    const box = $('#libList');
    const items = CC.library.list();
    box.innerHTML = '';
    if (!items.length) { box.innerHTML = '<div class="lib-empty">Nenhum projeto salvo ainda.<br>Use <b>Salvar</b> para guardar este aqui.</div>'; return; }
    items.forEach((it) => {
      const row = document.createElement('div'); row.className = 'lib-item';
      const count = it.data && Array.isArray(it.data.notes) ? it.data.notes.length : 0;
      const info = document.createElement('div'); info.className = 'info';
      const b = document.createElement('b'); b.textContent = it.name + (it.id === currentId ? '  (aberto)' : '');
      const sm = document.createElement('small'); sm.textContent = count + ' notas · ' + fmtDate(it.updated);
      info.append(b, sm);
      const open = document.createElement('button'); open.className = 'btn primary'; open.textContent = 'Abrir';
      open.addEventListener('click', () => {
        if (dirty && P.notes.length && it.id !== currentId && !confirm('Há alterações não salvas no projeto atual. Abrir outro mesmo assim?')) return;
        try { loadProject(it.data, it.id); $('#dlgLibrary').close(); toast('Projeto aberto'); } catch (e) { toast(e.message, true); }
      });
      const del = document.createElement('button'); del.className = 'btn danger'; del.setAttribute('aria-label', 'Excluir ' + it.name);
      del.innerHTML = '<svg class="i"><use href="#i-trash"/></svg>';
      del.addEventListener('click', () => {
        if (!confirm('Excluir "' + it.name + '" da biblioteca?')) return;
        CC.library.remove(it.id);
        if (it.id === currentId) { currentId = null; dirty = true; updateDirty(); }
        renderLibrary();
      });
      row.append(info, open, del);
      box.appendChild(row);
    });
  }

  function importFile(file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const raw = JSON.parse(rd.result);
        loadProject(raw, null);
        dirty = true; updateDirty();
        $('#dlgLibrary').close();
        toast('Projeto importado: ' + P.name);
      } catch (e) { toast('Arquivo inválido: ' + e.message, true); }
    };
    rd.onerror = () => toast('Não foi possível ler o arquivo.', true);
    rd.readAsText(file);
  }

  /* ───────────────────────── Exportação ───────────────────────── */

  function getExportRange() {
    const part = $('input[name="rng"]:checked').value === 'part';
    if (!part) return { from: 0, to: totalSteps() };
    let a = clamp(parseInt($('#expFrom').value, 10) || 1, 1, P.measures);
    let b = clamp(parseInt($('#expTo').value, 10) || P.measures, a, P.measures);
    return { from: (a - 1) * spm(), to: b * spm() };
  }

  async function doExport() {
    const fmt = $('input[name="fmt"]:checked').value;
    const range = getExportRange();
    const base = CC.slug(P.name);
    const btn = $('#btnDoExport');
    const label = btn.innerHTML;
    btn.disabled = true;
    try {
      const proj = serialize();
      if (fmt === 'json') { CC.download(CC.toJson(proj), base + '.coralcrafter.json'); }
      else if (fmt === 'txt') { CC.download(CC.toText(proj, range, settings.notation), base + '.txt'); }
      else if (fmt === 'mid') {
        const audible = VOICE_ORDER.some((k) => CC.audibleLevel(P.voices, k) > 0 && P.notes.some((n) => n.v === k && n.s >= range.from && n.s < range.to));
        if (!audible) throw new Error('Nenhuma nota audível neste trecho (verifique mudo/solo).');
        CC.download(CC.toMidi(proj, range), base + '.mid');
      }
      else if (fmt === 'png') { CC.download(await CC.toPng(proj, range, settings.notation), base + '.png'); }
      else if (fmt === 'wav') {
        if (!P.notes.some((n) => n.s >= range.from && n.s < range.to && CC.audibleLevel(P.voices, n.v) > 0)) throw new Error('Nenhuma nota audível neste trecho (verifique mudo/solo).');
        btn.textContent = 'Renderizando áudio…';
        await new Promise((r) => setTimeout(r, 30));
        const buf = await CC.renderToBuffer({
          notes: P.notes, voices: P.voices, bpm: P.bpm, from: range.from, to: range.to,
          master: 1, reverb: settings.reverb, timbre: settings.timbre,
        });
        CC.download(CC.encodeWav(buf), base + '.wav');
      }
      toast('Arquivo exportado');
      $('#dlgExport').close();
    } catch (e) {
      toast('Falha ao exportar: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  }

  function updateExportDialog() {
    const fmt = $('input[name="fmt"]:checked').value;
    $('#rangeBox').classList.toggle('disabled', fmt === 'json');
    $('#expHint').textContent = (fmt === 'wav' || fmt === 'mid')
      ? 'WAV e MIDI respeitam o mudo/solo das vozes: ative o solo numa voz para exportar uma faixa-guia de ensaio.'
      : (fmt === 'json' ? 'O JSON guarda o projeto inteiro e pode ser importado em "Abrir".' : 'Este formato mostra todas as vozes, independentemente de mudo/solo.');
    $('#expFrom').max = $('#expTo').max = P.measures;
  }

  /* ───────────────────────── Menu lateral (mobile) ───────────────────────── */

  const openSidebar = () => { $('#sidebar').classList.add('open'); $('#sideBackdrop').classList.add('show'); };
  const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#sideBackdrop').classList.remove('show'); };

  /* ───────────────────────── Ligações de eventos ───────────────────────── */

  function bindUI() {
    $('#btnPlay').addEventListener('click', togglePlay);
    $('#btnStop').addEventListener('click', stopPlay);
    $('#btnToStart').addEventListener('click', () => { transport.seek(0); updatePlayhead(0); roll.scrollLeft = 0; });
    $('#btnLoop').addEventListener('click', (e) => {
      settings.loop = !settings.loop; saveSettings();
      e.currentTarget.setAttribute('aria-pressed', String(settings.loop));
    });
    $('#btnFollow').addEventListener('click', (e) => {
      settings.follow = !settings.follow; saveSettings();
      e.currentTarget.setAttribute('aria-pressed', String(settings.follow));
    });
    $('#bpmMinus').addEventListener('click', () => setBpm(P.bpm - 2));
    $('#bpmPlus').addEventListener('click', () => setBpm(P.bpm + 2));
    $('#bpmInput').addEventListener('change', (e) => setBpm(e.target.value));
    $('#rngMaster').addEventListener('input', (e) => {
      settings.master = +e.target.value; saveSettings();
      if (live) live.engine.setMaster(settings.master);
    });
    $('#selTimbre').addEventListener('change', (e) => {
      settings.timbre = e.target.value; saveSettings();
      if (live) live.engine.setTimbre(settings.timbre);
      if (settings.timbre === 'coral') CC.Samples.load();
      updateTimbreStatus();
      preview({ m: 64, v: settings.voice });
    });
    $('#rngReverb').addEventListener('input', (e) => {
      settings.reverb = +e.target.value; saveSettings();
      if (live) live.engine.setReverb(settings.reverb);
    });

    $('#projName').addEventListener('input', (e) => { P.name = e.target.value.slice(0, 80) || 'Sem título'; changed(); });
    $('#projName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

    $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#selChord').addEventListener('change', (e) => { settings.chord = e.target.value; saveSettings(); });
    $$('#durGroup .dur').forEach((b) => b.addEventListener('click', () => setDuration(+b.dataset.d)));
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnZoomIn').addEventListener('click', () => zoom(1));
    $('#btnZoomOut').addEventListener('click', () => zoom(-1));

    $$('[data-transpose]').forEach((b) => b.addEventListener('click', () => transposeSelection(+b.dataset.transpose)));
    $('#btnDup').addEventListener('click', duplicateSelection);
    $('#btnDel').addEventListener('click', deleteSelection);
    $('#selVowel').addEventListener('change', (e) => setSelectionVowel(e.target.value));

    $('#selBeats').addEventListener('change', (e) => {
      const old = totalSteps();
      P.beats = +e.target.value;
      let end = 0; P.notes.forEach((n) => { end = Math.max(end, n.s + n.d); });
      P.measures = clamp(Math.max(Math.ceil(old / spm()), Math.ceil(end / spm()), 1), 1, MAX_MEASURES);
      applyLayout(); changed();
      if (transport.state === 'playing') transport.rebase(true);
    });
    $('#btnMeasPlus').addEventListener('click', () => addMeasures(1));
    $('#btnMeas4').addEventListener('click', () => addMeasures(4));
    $('#btnMeasMinus').addEventListener('click', () => {
      if (P.measures <= 1) return;
      let end = 0; P.notes.forEach((n) => { end = Math.max(end, n.s + n.d); });
      if (end > (P.measures - 1) * spm()) { toast('Há notas no último compasso'); return; }
      P.measures--; applyLayout(); changed();
      if (transport.state === 'playing') transport.rebase(true);
    });
    $('#selSnap').addEventListener('change', (e) => { settings.snap = +e.target.value; saveSettings(); });
    $('#selNotation').addEventListener('change', (e) => {
      settings.notation = e.target.value; saveSettings(); labelKeys(); syncVoicePanel(); renderNotes();
    });

    // demos
    const dl = $('#demoList');
    CC.demos.forEach((d) => {
      const b = document.createElement('button'); b.className = 'demo';
      b.innerHTML = '<b></b><span></span>';
      $('b', b).textContent = d.name; $('span', b).textContent = d.desc;
      b.addEventListener('click', () => {
        if (dirty && P.notes.length && !confirm('Há alterações não salvas. Abrir o exemplo mesmo assim?')) return;
        loadProject(d.build(), null); dirty = false; updateDirty(); closeSidebar();
        toast('Exemplo carregado – aperte Espaço para ouvir');
      });
      dl.appendChild(b);
    });

    // topo
    $('#btnNew').addEventListener('click', newProject);
    $('#btnNewSide').addEventListener('click', newProject);
    $('#btnSave').addEventListener('click', saveProject);
    $('#btnLibrary').addEventListener('click', () => { renderLibrary(); $('#dlgLibrary').showModal(); });
    $('#btnExport').addEventListener('click', () => {
      $('#expFrom').value = 1; $('#expTo').value = P.measures; updateExportDialog(); $('#dlgExport').showModal();
    });
    $('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
    $('#btnDoExport').addEventListener('click', doExport);
    $$('input[name="fmt"]').forEach((r) => r.addEventListener('change', updateExportDialog));
    $$('input[name="rng"]').forEach((r) => r.addEventListener('change', () => { if (r.checked && r.value === 'part') $('#expFrom').focus(); }));
    [$('#expFrom'), $('#expTo')].forEach((i) => i.addEventListener('focus', () => { $('input[name="rng"][value="part"]').checked = true; }));
    $('#fileImport').addEventListener('change', (e) => { importFile(e.target.files[0]); e.target.value = ''; });
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

    $('#btnMenu').addEventListener('click', openSidebar);
    $('#btnSideClose').addEventListener('click', closeSidebar);
    $('#sideBackdrop').addEventListener('click', closeSidebar);

    document.addEventListener('keydown', onKey);
  }

  function addMeasures(k) {
    if (P.measures >= MAX_MEASURES) return;
    P.measures = Math.min(MAX_MEASURES, P.measures + k);
    applyLayout(); changed();
    if (transport.state === 'playing') transport.rebase(true);
  }

  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      if (!(tag === 'input' && e.target.type === 'range')) return;
    }
    if (document.querySelector('dialog[open]')) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;

    if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); selectOnly(P.notes.map((n) => n.id)); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod) return;

    if (k === ' ') { e.preventDefault(); togglePlay(); return; }
    if (k === 'Home') { e.preventDefault(); transport.seek(0); updatePlayhead(0); roll.scrollLeft = 0; return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (k === 'Escape') { selectOnly([]); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!selection.size) return;
      e.preventDefault(); moveSelection((k === 'ArrowRight' ? 1 : -1) * settings.snap); return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!selection.size) return;
      e.preventDefault(); transposeSelection((k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1)); return;
    }
    if (k >= '1' && k <= '4') { setActiveVoice(VOICE_ORDER[+k - 1]); return; }
    const lk = k.toLowerCase();
    if (lk === 'q') setTool('note');
    else if (lk === 'w') setTool('chord');
    else if (lk === 'e') setTool('erase');
  }

  /* ───────────────────────── Instalação PWA e Service Worker ───────────────────────── */

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e; $('#btnInstall').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => { $('#btnInstall').classList.add('hidden'); deferredPrompt = null; });
  function bindInstall() {
    $('#btnInstall').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
      deferredPrompt = null; $('#btnInstall').classList.add('hidden');
    });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  /* ───────────────────────── Timbre: amostras de coro ───────────────────────── */

  function updateTimbreStatus() {
    const el = $('#timbreStatus'); if (!el) return;
    const S = CC.Samples;
    if (settings.timbre === 'synth') { el.textContent = 'Sintetizador formântico (leve, sem arquivos de áudio).'; return; }
    if (S.state === 'ready') el.textContent = 'Vozes reais de coro carregadas.';
    else if (S.state === 'error') el.textContent = 'Amostras indisponíveis: usando o sintetizador. Abra o app por um servidor (http/https), não direto do arquivo.';
    else el.textContent = 'Carregando vozes de coro… ' + Math.round(S.progress * 100) + '%';
  }

  /* ───────────────────────── Início ───────────────────────── */

  function init() {
    buildRoll();
    buildVoicePanel();
    bindUI();
    bindInstall();

    const params = new URLSearchParams(location.search);
    const draft = CC.LS.get(CC.KEY_DRAFT, null);
    try {
      if (params.get('action') === 'new') {
        loadProject(CC.defaultProject(), null);
      } else if (draft && draft.data) {
        loadProject(draft.data, draft.id && CC.library.get(draft.id) ? draft.id : null);
        dirty = !(draft.id && CC.library.get(draft.id)); updateDirty();
      } else {
        loadProject(CC.demos[0].build(), null);
      }
    } catch (e) {
      loadProject(CC.demos[0].build(), null);
    }
    setTool('note');
    setActiveVoice(settings.voice);
    CC.Samples.on(updateTimbreStatus);
    if (settings.timbre === 'coral') CC.Samples.load();
    updateTimbreStatus();
  }

  CC._app = { // ganchos para testes automatizados
    state: () => ({ P, selection, tool, settings, transport, live }),
    voiceChord, getLive,
  };

  init();
})();
