/* Coralcrafter – projetos de exemplo */
(function (global) {
  'use strict';
  const CC = (global.CC = global.CC || {});
  const N = CC.parseNote;

  function base(name, bpm, measures) {
    const p = CC.defaultProject();
    p.name = name; p.bpm = bpm; p.measures = measures;
    return p;
  }
  const add = (p, v, note, s, d, o) => {
    const n = { v, m: N(note), s, d };
    if (o) n.o = o;
    p.notes.push(n);
  };

  CC.demos = [
    {
      id: 'acordes',
      name: 'Acordes em Ah',
      desc: 'C · Am · F · G · C com condução de vozes suave',
      build() {
        const p = base('Acordes em Ah', 66, 5);
        const chords = [
          ['G4', 'E4', 'C4', 'C3'],
          ['A4', 'E4', 'C4', 'A2'],
          ['A4', 'F4', 'C4', 'F3'],
          ['B4', 'G4', 'D4', 'G3'],
          ['C5', 'G4', 'E4', 'C3'],
        ];
        chords.forEach((c, i) => ['S', 'A', 'T', 'B'].forEach((v, k) => add(p, v, c[k], i * 16, 16)));
        return p;
      },
    },
    {
      id: 'cascata',
      name: 'Entradas em cascata',
      desc: 'Tema em oitavas: as vozes entram uma a uma',
      build() {
        const p = base('Entradas em cascata', 92, 16);
        // tema de 4 compassos sobre C | G | Am | F  (notas em semicolcheias: q=4, h=8)
        const theme = [
          ['E4', 4], ['G4', 4], ['C5', 8],
          ['B4', 4], ['A4', 4], ['G4', 8],
          ['E5', 4], ['D5', 4], ['C5', 8],
          ['A4', 4], ['G4', 4], ['F4', 4], ['E4', 4],
        ];
        const entries = { S: [0, 0], A: [4, 0], T: [8, -12], B: [12, -24] };
        Object.keys(entries).forEach((v) => {
          const [startMeasure, shift] = entries[v];
          for (let rep = startMeasure; rep < 16; rep += 4) {
            let s = rep * 16;
            theme.forEach(([nm, d]) => { p.notes.push({ v, m: N(nm) + shift, s, d }); s += d; });
          }
        });
        return p;
      },
    },
    {
      id: 'vogais',
      name: 'Teste de vogais',
      desc: 'O mesmo acorde cantado em Ah, Eh, Ee, Oh e Oo',
      build() {
        const p = base('Teste de vogais', 60, 5);
        const vowels = ['A', 'E', 'I', 'O', 'U'];
        vowels.forEach((o, i) => {
          [['S', 'G4'], ['A', 'E4'], ['T', 'C4'], ['B', 'C3']].forEach(([v, nm]) => add(p, v, nm, i * 16, 16, o));
        });
        return p;
      },
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
