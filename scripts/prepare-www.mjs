// Prepara a pasta www/ (o que vai dentro do APK) a partir dos arquivos do repositório.
// Os arquivos originais NÃO são alterados: as mudanças abaixo são feitas só nas cópias.
// Se algum trecho não for encontrado, o script para com erro (assim você nota na hora).
import fs from 'node:fs';
import path from 'node:path';

// ===== Opções =====
const APP_NAME = 'Coralcrafter';
const APP_SLUG = 'coralcrafter';
const TWO_ROW_HEADER = true; // celular: 1ª linha só com o nome do app; o resto desce para a 2ª (só em pé; deitado fica numa linha). false = como está no site
// ==================

const ROOT = process.cwd();
const WWW = path.join(ROOT, 'www');
const fail = (m) => { console.error('ERRO: ' + m); process.exit(1); };

// ---- Nome do pacote: io.github.<usuario>.coralcrafter (minúsculas, sem hífen) ----
function makeAppId() {
  if (process.env.APP_ID && process.env.APP_ID.trim()) return process.env.APP_ID.trim();
  let owner = (process.env.OWNER || 'meuusuario').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!owner) owner = 'meuusuario';
  if (/^[0-9]/.test(owner)) owner = 'u' + owner;
  return `io.github.${owner}.${APP_SLUG}`;
}
const APP_ID = makeAppId();
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(APP_ID)) fail('Nome de pacote inválido: ' + APP_ID);

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

// ---- Arquivos copiados sem alteração (inclui as vozes de coro, que ficam dentro do app) ----
const COPY = ['audio.js', 'demos.js', 'coral-voices.bin', 'manifest.json', 'apple-touch-icon.png', 'favicon-32x32.png',
  'icon-72x72.png', 'icon-96x96.png', 'icon-128x128.png', 'icon-144x144.png', 'icon-152x152.png', 'icon-192x192.png',
  'icon-384x384.png', 'icon-512x512.png', 'icon-maskable-192x192.png', 'icon-maskable-512x512.png'];
for (const f of COPY) {
  if (!fs.existsSync(f)) fail('Arquivo não encontrado na raiz do repositório: ' + f);
  fs.copyFileSync(f, path.join(WWW, f));
}

// ---- Ajuda para editar uma cópia de texto ----
function edit(file, fn) {
  if (!fs.existsSync(file)) fail('Arquivo não encontrado na raiz do repositório: ' + file);
  let s = fs.readFileSync(file, 'utf8');
  const once = (re, to, what) => {
    if (!(typeof re === 'string' ? s.includes(re) : re.test(s))) fail(`Trecho não encontrado em ${file}: ${what}`);
    s = s.split(re).join(to); // string: troca todas; regex sem /g: troca a 1ª
  };
  const onceRe = (re, to, what) => {
    if (!re.test(s)) fail(`Trecho não encontrado em ${file}: ${what}`);
    s = s.replace(re, () => to);
  };
  fn({ once, onceRe, get: () => s, set: (v) => { s = v; } });
  fs.writeFileSync(path.join(WWW, file), s);
}

// ---- io.js: exportar (WAV, MIDI, TXT, PNG, JSON) abre a folha "Compartilhar" do Android ----
edit('io.js', ({ onceRe }) => {
  onceRe(/function download\(blob, filename\) \{\s*const url = URL\.createObjectURL\(blob\);\s*const a = document\.createElement\('a'\);\s*a\.href = url; a\.download = filename;\s*document\.body\.appendChild\(a\);\s*a\.click\(\);\s*setTimeout\(\(\) => \{ URL\.revokeObjectURL\(url\); a\.remove\(\); \}, 1500\);\s*\}/,
    "async function download(blob, filename) { const buf = new Uint8Array(await blob.arrayBuffer()); return window.fbSaveFile(filename, buf, blob.type || 'application/octet-stream'); }",
    'função download');
});

// ---- app.js: sem service worker, sem botão de instalar, textos do aparelho ----
edit('app.js', ({ once, onceRe }) => {
  onceRe(/if \('serviceWorker' in navigator && \/\^https\?:\$\/\.test\(location\.protocol\)\) \{/, 'if (false) {', 'registro do service worker');
  once('Este navegador não suporta Web Audio API.', 'Este aparelho não suporta Web Audio API.', 'texto Web Audio');
  once("'Salvo neste navegador'", "'Salvo neste aparelho'", 'texto salvo');
  once("'Projeto salvo neste navegador'", "'Projeto salvo neste aparelho'", 'texto projeto salvo');
  once('Exemplo carregado – aperte Espaço para ouvir', 'Exemplo carregado – toque em ▶ para ouvir', 'texto do exemplo');
});

// ---- index.html: textos, importar sem filtro, ajudas (exportação, área segura, cabeçalho) ----
edit('index.html', ({ once, onceRe, get, set }) => {
  once('title="Salvar no navegador (Ctrl+S)"', 'title="Salvar (Ctrl+S)"', 'título do botão Salvar');
  once('Os projetos ficam salvos neste navegador (LocalStorage).', 'Os projetos ficam salvos dentro do aplicativo, neste aparelho.', 'texto da biblioteca');
  once('<input id="fileImport" type="file" accept=".json,application/json" hidden>', '<input id="fileImport" type="file" hidden>', 'importar .json');
  const helper = `
<style>
html{--fb-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px));--fb-bottom:var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px));--fb-left:var(--safe-area-inset-left,env(safe-area-inset-left,0px));--fb-right:var(--safe-area-inset-right,env(safe-area-inset-right,0px));}
.app{padding-top:var(--fb-top)!important;padding-bottom:var(--fb-bottom);padding-left:var(--fb-left);padding-right:var(--fb-right);}
#btnInstall{display:none!important;}
@media(max-width:960px){.sidebar{padding-top:max(12px,var(--fb-top))!important;}.dlg .btn{width:auto;padding:0 14px;white-space:nowrap;}.dlg .btn .lbl{display:inline;}}
${TWO_ROW_HEADER ? `@media(max-width:960px) and (orientation:portrait){.topbar{flex-wrap:wrap;row-gap:6px;}.brand{flex:1 1 calc(100% - 60px);}.brand-text{display:block!important;}.projname{order:2;}.top-actions{order:3;}}` : ''}
</style>
<script>
window.fbSaveFile=async function(name,bytes,mime){
  var cap=window.Capacitor, P=cap&&cap.Plugins;
  if(cap&&cap.isNativePlatform&&cap.isNativePlatform()&&P&&P.Filesystem&&P.Share){
    try{
      var bin=''; for(var i=0;i<bytes.length;i+=0x8000){ bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); }
      var r=await P.Filesystem.writeFile({path:name,data:btoa(bin),directory:'CACHE'});
      await P.Share.share({title:name,url:r.uri,dialogTitle:'Salvar ou enviar o arquivo'});
      return;
    }catch(e){ if(e&&/cancel/i.test(String(e.message||e))) return; console.error(e); }
  }
  var url=URL.createObjectURL(new Blob([bytes],{type:mime}));
  var a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},4000);
};
</script>
`;
  onceRe(/<\/head>/, helper + '</head>', '</head>');
});

// style.css: sem alterações
if (!fs.existsSync('style.css')) fail('style.css não encontrado.');
fs.copyFileSync('style.css', path.join(WWW, 'style.css'));

// ---- Configuração do Capacitor ----
const cfg = { appId: APP_ID, appName: APP_NAME, webDir: 'www', backgroundColor: '#0a0c13', android: { allowMixedContent: false } };
fs.writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2));

console.log('OK. Pacote: ' + APP_ID + ' | Nome: ' + APP_NAME);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `app_id=${APP_ID}\n`);
