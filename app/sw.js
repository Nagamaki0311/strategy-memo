// App Shell のプリキャッシュ（D-002）。オフライン起動のためだけのService Worker。APK（Capacitor）には登録しない（app.js）。
// ponytail: ファイル一覧と版数 CACHE はデプロイごとに手で上げる。上げ忘れると、利用者の端末は古い版のまま動く（手動更新の限界）。
// 必要になったらビルド時にファイルのハッシュを埋め込む。app/ にファイルを足したら FILES にも足す。
const CACHE = 'sf6memo-v1';
const FILES = ['index.html', 'app.js', 'core.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

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
