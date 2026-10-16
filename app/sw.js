// App Shell のプリキャッシュ（D-002）。オフライン起動のためだけのService Worker。APK（Capacitor）には登録しない（app.js）。
// 版数 CACHE: 配信（.github/workflows/pages.yml）が、sw.js 以外の app/ の内容ハッシュで `sf6memo-<8桁>` に置き換える（コミットはしない）。
// app/ のどれかが変われば版数が必ず変わるので、手で上げる必要はない。リポジトリ内の値（sf6memo-dev）はローカル開発用で、更新の検証には使えない。
// ponytail: ファイル一覧 FILES は手で保つ。app/ にファイルを足したら FILES にも足す（tests/e2e.mjs 19b が不一致を検出する）。
const CACHE = 'sf6memo-dev';
const FILES = ['index.html', 'app.js', 'core.js', 'specials.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

// cache: 'reload' で、HTTPキャッシュ（GitHub Pagesは10分）の古い版を新しい版のキャッシュへ入れない。
// skipWaiting は使わない: 新しい版は待機し、開いているタブが全部閉じたあとの次回起動で切り替わる（タブの途中で版が混ざらない）。
addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

// `*.github.io` はオリジン共有なので、他のアプリのキャッシュを消さないよう接頭辞で絞る
addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sf6memo-') && k !== CACHE).map((k) => caches.delete(k)))));
});

// 同一オリジンのGETだけ処理する（他は素通し）。キャッシュ優先で、無ければネットワーク。
// ナビゲーション（`/strategy-memo/`、`?gray=1` 付きなど）は、URLに関わらずキャッシュした index.html を返す（HTMLだけ新しく、JSが古い、という版の混在を避ける）
addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  const key = request.mode === 'navigate' ? 'index.html' : request;
  e.respondWith(caches.open(CACHE).then((c) => c.match(key)).then((hit) => hit ?? fetch(request)));
});
