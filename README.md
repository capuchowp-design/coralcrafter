# Coralcrafter

Editor e criador de partituras/tablaturas para **corais e vozes humanas**, feito como PWA.
Em vez de cordas, o som vem de **vozes humanas** (soprano, contralto, tenor e baixo) cantando vogais sustentadas: *Ah, Eh, Ee, Oh, Oo*.

As vozes tocadas são **gravações reais de coro** (Choir Aahs e Voice Oohs); há também um modo sintético opcional.

Tudo roda no navegador, sem backend e **sem CDN**. Depois da primeira visita funciona offline.

## Recursos

- **Grade melódica** (piano roll) com notas por voz: clique para inserir, arraste para mover (tempo e altura), puxe a borda direita para mudar a duração.
- **Ferramenta Acorde**: um clique cria um acorde SATB (maior, menor, 7, maj7, m7, dim, aum, sus4) já distribuído dentro da tessitura de cada voz.
- **Timbre de coral real** por padrão (amostras, com loop para sustentar notas longas) ou **sintético** (formantes), à escolha em *Projeto → Timbre das vozes*.
- **4 vozes** com vogal, volume, mudo e solo. A faixa colorida da grade mostra a tessitura confortável da voz ativa, e notas fora dela ficam tracejadas.
- **Polifonia** ilimitada (várias notas por voz e por tempo) e vogal por nota.
- **Player** com Play / Pause / Stop, loop, BPM e volume, usando a Web Audio API. Dá para editar e mudar o BPM tocando.
- **Salvar/Abrir** na biblioteca do navegador (LocalStorage), com rascunho automático, e importar/exportar **JSON**.
- **Exportar** a peça inteira ou um trecho (compassos X a Y):
  - **WAV** (renderização offline das vozes, com reverberação)
  - **MIDI** (uma pista por voz, Choir Aahs / Voice Oohs)
  - **TXT** (tablatura em texto, uma linha por voz)
  - **PNG** (imagem da partitura em grade)
- Notação **Dó Ré Mi** ou **C D E**, fórmula de compasso 2/4 a 7/4, desfazer/refazer, zoom, atalhos de teclado.
- **PWA**: manifest, ícones (incluindo *maskable*), service worker e botão de instalar.

## Como rodar

Qualquer servidor estático serve. É preciso servir por `http(s)` (o service worker e o carregamento das amostras não funcionam abrindo o `index.html` direto do disco):

```bash
cd coralcrafter
python3 -m http.server 8000
# abra http://localhost:8000
```

Para publicar no **GitHub Pages**: envie estes arquivos para o repositório e ative *Settings → Pages* na branch `main`.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura da página, ícones SVG e diálogos |
| `style.css` | Tema escuro, layout responsivo |
| `app.js` | Editor: grade, interação, vozes, transporte, arquivos |
| `audio.js` | Banco de amostras de coro, sintetizador formântico, agendador (lookahead), render offline e WAV |
| `io.js` | Projeto, LocalStorage, exportação MIDI/TXT/PNG/JSON |
| `demos.js` | Projetos de exemplo |
| `coral-voices.bin` | Pacote único com 122 amostras MP3 de coro (Choir Aahs e Voice Oohs, Dó1–Dó6), ~3 MB |
| `manifest.json`, `sw.js`, `*.png` | PWA (manifest, cache offline, ícones) |

## Como o som é feito

**Coral real (padrão).** Cada nota toca uma gravação de coro da altura exata (uma amostra por semitom, Dó1–Dó6). Como a amostra dura ~3 s, o trecho final recebe crossfade para o app sustentar notas de qualquer duração sem cortes ou cliques. As notas ligam umas às outras com crossfade de potência constante (sem "buracos" nem "socos" nas trocas) e usam uma camada única, para não haver batimento entre cópias da mesma gravação. *Ah* e *Eh* usam o *Choir Aahs*; *Oh*, *Oo* e *Ee* usam o *Voice Oohs*, e *Eh*, *Ee* e *Oo* são moldadas por filtros de formante. As amostras ficam num único arquivo, `coral-voices.bin` (todos os arquivos do projeto ficam na raiz, sem pastas), e são pré-carregadas no cache do PWA.

**Sintético.** Três osciladores com fonte de espectro glotal, vibrato e ruído de respiração, passando por 5 filtros passa-banda com os formantes de cada vogal e tipo de voz. É leve e não usa arquivos de áudio. Também é o reserva automático se as amostras não carregarem.

Nos dois modos há compensação de volume por voz, compressor, limitador e reverberação de convolução (tipo igreja). O áudio exportado em **WAV** usa o timbre escolhido; o **MIDI** leva só as notas (Choir Aahs / Voice Oohs no General MIDI).

## Créditos

As amostras de coro vêm do soundfont **FluidR3_GM** (Frank Wen), convertidas para MIDI.js por [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) e usadas sob a licença [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). Mantenha esta atribuição ao publicar.

## Atalhos

`Espaço` tocar/pausar · `Home` início · `1`–`4` escolher voz · `Q` `W` `E` nota/acorde/apagar · `Del` apagar · `Ctrl+D` duplicar · `Ctrl+Z`/`Ctrl+Y` desfazer/refazer · `Ctrl+A` selecionar tudo · `←` `→` mover · `↑` `↓` transpor (Shift = oitava) · `Ctrl+S` salvar.

## Limitações

- O compasso usa a semínima como tempo (2/4 a 7/4); não há compassos compostos tipo 6/8.
- A grade vai de Dó1 a Dó6 e a peça tem no máximo 256 compassos.
- A exportação MIDI não traz letra nem dinâmica.
