// ブラウザ検証（T-008〜T-011）。`npm test` には含めない。依存はリポジトリに入れず、グローバルの Playwright を使う。
// 使い方（リポジトリルートで）:
//   1. python3 -m http.server 8000 &      # リポジトリルートを配信する（BASE で配信先を変えられる。既定 http://localhost:8000/app/index.html）
//   2. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e.mjs
//      - Playwright は /opt/node-tools/node_modules のグローバル版（1.56.1）を使う。リポジトリには依存を足さない。`playwright install` は不要。
//      - FAST=1 を付けると、時間のかかるトーストの一時停止の検証（約30秒）を省く。
//      - SHOTS=<dir> を指定すると360幅（と430幅）のスクリーンショットを保存する（目視用。判定には使わない）。
//      - Service Worker（19章）は、このファイルが立てる専用の静的サーバー（localhost、ルートとサブパス）で検証する。BASE は使わない。
//        SW_APP=<dir> で配信する app/ を差し替えられる（変異テスト用の app/ のコピー）。ONLY_SW=1 で19章だけ、ONLY_24=1 で24章（技名。360・390・430幅）だけ実行する。SHOTS は360幅と430幅を保存する（430幅は名前の末尾に -430）。
//      - 既存の検証は、Service Worker を無効にして動かす（browser.newContext の既定が serviceWorkers: 'block'）。
//   3. 終わったらサーバーを止める（kill %1）。
// 終了コード0が合格。360幅・430幅の2回分を実行する（トーストの時間経過の検証は360幅のみ）。
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportDoc, CHARACTERS } from '../app/core.js';

const BASE = process.env.BASE ?? 'http://localhost:8000/app/index.html';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const T0 = 1_700_000_000_000;
const sec = (id, characterId, name, order) => ({ id, characterId, name, order, updatedAt: T0 });
const N = (stance, str, key) => ({ type: 'normal', stance, key, str });
const SP = (motion, str, key) => ({ type: 'special', motion, key, str });
const combo = (id, sectionId, title, tokens, extra = {}) => ({
  id, characterId: 'ryu', controlType: 'classic', sectionId, title, position: 'any', tokens, memo: '', tags: [], favorite: false,
  createdAt: T0 - 1000 + Number(id.slice(1)), updatedAt: T0, ...extra, // createdAt <= updatedAt（validateDoc）。idの数字で作成順を表す
});
const LONG = Array.from({ length: 12 }, () => [N('crouch', 'M', 'K'), SP('236', 'H', 'P')]).flat();
const seedState = () => ({
  sections: [sec('s1', 'ryu', '通常', 0), sec('s2', 'ryu', '画面端', 1), sec('s3', 'ryu', '起き攻め', 2)],
  combos: [
    combo('c1', 's1', '基本コンボ', [N('crouch', 'M', 'K'), SP('236', 'H', 'P'), { type: 'system', id: 'CDR' }, N('crouch', 'M', 'K'), SP('236', 'H', 'P')], { tags: ['基本'] }),
    combo('c2', 's1', '長いコンボ', LONG, { position: 'corner' }),
    combo('c3', 's2', '', [{ type: 'note', id: 'CH' }, SP('623', 'M', 'P'), { type: 'sa', level: 3 }]),
  ],
});

// 設定画面の免責（D-018 の文面）
const LEGAL = '本アプリは個人が制作した非公式のファンツールであり、株式会社カプコンおよび関係各社とは一切関係がなく、公式・公認のものではありません。『STREET FIGHTER』は株式会社カプコンの商標または登録商標です。ゲーム内の名称・技名・コマンド等に関する権利は各権利者に帰属します。本アプリは無料で、広告・課金はありません。技名・コマンドは、カプコン公式サイトの公開情報を参考に独自に整理したもので、誤りや最新バージョンとの差異がある場合があります。';

const failures = [];
let checks = 0;
// 想定外の例外（待機のタイムアウトなど）でも、それまでの不合格を表示してから終了コード1で終わる
process.on('uncaughtException', (e) => {
  console.log(`e2e: 中断 ${String(e.message).split('\n')[0]} @ ${String(e.stack).split('\n').find((l) => l.includes('e2e.mjs'))}\n${failures.map((f) => `FAIL ${f}`).join('\n')}`);
  process.exit(1);
});
async function check(name, fn) {
  checks++;
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${String(e.message).split('\n').slice(0, 4).join(' / ')}`);
  }
}

const browser = await chromium.launch();
{ // 既存の検証はService Workerなしで動かす。19章だけ serviceWorkers: 'allow' を渡す
  const open = browser.newContext.bind(browser);
  browser.newContext = (o) => open({ serviceWorkers: 'block', ...o });
}
async function newPage(width, seed, ctxOpts = {}, init = null) {
  const ctx = await browser.newContext({ viewport: { width, height: 740 }, deviceScaleFactor: 1, ...ctxOpts });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(BASE);
  if (seed) {
    await page.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc(seed));
    await page.reload();
  }
  return page;
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sf6memo.data')));
const storedRaw = (page, k = 'sf6memo.data') => page.evaluate((key) => localStorage.getItem(key), k);
const hash = (page) => page.evaluate(() => location.hash);
const names = (page) => page.$$eval('.sec-name', (els) => els.map((e) => e.textContent));
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = async (page, name, width) => { if (SHOTS && (width === 360 || width === 430)) { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}${width === 360 ? '' : `-${width}`}.png` }); } }; // 360幅は従来の名前、430幅は末尾に -430
// hash を変え、画面が描き直される（#app の .screen が新しい要素になる）まで待つ。同じ hash なら何も起きないので待たない。
// 固定の待ち時間ではなく描き直しを待つ（遅い環境でのゆらぎと、速い環境での無駄な待ちをなくす）
const gotoHash = async (page, h) => {
  const same = await page.evaluate((x) => {
    if (location.hash === x) return true;
    window.__screen = document.querySelector('.screen');
    location.hash = x;
    return false;
  }, h);
  // 新しい画面の出現アニメーション（translateX。終わるまで横にはみ出す）が終わるまで待つ
  if (!same) await page.waitForFunction(() => { const s = document.querySelector('.screen'); return s && s !== window.__screen && s.getAnimations().length === 0; });
};
// コマンド列のDOMを、編集と詳細で比べられる形にする。詳細は出す情報のないチップ（通常技）を <button> にしない（B-Med3）ので、ボタンも span の読み上げ形にそろえる
const normRow = (r) => {
  const c = r.cloneNode(true);
  c.querySelectorAll('.cursor, .pending, .to-end, .cmd-hint').forEach((x) => x.remove()); // 編集だけにある挿入カーソル等
  c.querySelectorAll('button.chip, button.tag').forEach((b) => {
    const sp = document.createElement('span');
    sp.className = b.className;
    sp.setAttribute('role', 'img');
    sp.setAttribute('aria-label', b.getAttribute('aria-label'));
    sp.append(...b.childNodes);
    b.replaceWith(sp);
  });
  return c.outerHTML;
};

// ===== SECTION: 19 Service Worker・manifest・配信（T-013） =====
// 本物のオリジン（localhost）が要るので、python の http.server とは別に、app/ だけを配信する静的サーバーを立てる。
// 機内モードは context.setOffline(true) に加えて、サーバー側で接続を切って再現する（setOffline は Service Worker の fetch を止めないため。
// キャッシュに無いファイルがあっても、setOffline だけではネットワークから取れてしまい、検出できない）。
// prefix='/strategy-memo/' で、GitHub Pagesのプロジェクトサイトと同じサブパス配信を再現する。
// 版数 CACHE はデプロイ時に pages.yml が app/ の内容ハッシュへ置き換える（リポジトリ内の値はローカル開発用）。ここでは形式と、置き換えの仕組みを検査する（19b）
const CACHE_RE = /^sf6memo-[A-Za-z0-9]+$/;
const cacheOf = (dir) => readFileSync(path.join(dir, 'sw.js'), 'utf8').match(/^const CACHE = '([^']*)'/m)[1];
const SW_APP = path.resolve(process.env.SW_APP ?? new URL('../app', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function serveApp(dir, prefix = '/') {
  const root = path.resolve(dir) + path.sep;
  // sw・appjs: sw.js・app.js の本文を書き換える（版数の変更・デプロイの再現用）。down: 真のあいだは接続を切る（機内モード）。切られたあとに来た要求は downHits に残る
  // 配信には GitHub Pages と同じ Cache-Control: max-age=600 を付ける（HTTPキャッシュの古い版を新しい版のキャッシュへ入れないことの検査用）
  const s = { misses: [], downHits: [], down: false, sw: (t) => t, appjs: (t) => t };
  s.server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // ブラウザ自身のSW更新確認（/sw.js）は切断中でも飛んでくる。アプリが取りに行った要求だけを downHits に残す
    if (s.down) { if (!p.endsWith('/sw.js')) s.downHits.push(p); req.socket.destroy(); return; }
    const rel = p.startsWith(prefix) ? p.slice(prefix.length) || 'index.html' : null;
    const file = rel === null ? null : path.join(dir, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!file || !file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { s.misses.push(p); res.writeHead(404); res.end(); return; }
    let body = readFileSync(file);
    if (rel === 'sw.js') body = s.sw(body.toString());
    if (rel === 'app.js') body = s.appjs(body.toString());
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' });
    res.end(body);
  });
  await new Promise((ok) => s.server.listen(0, ok));
  s.port = s.server.address().port;
  s.origin = (host = 'localhost') => `http://${host}:${s.port}${prefix}`;
  s.close = () => new Promise((ok) => s.server.close(ok));
  return s;
}
async function swPage(width, init) {
  const ctx = await browser.newContext({ viewport: { width, height: 740 }, serviceWorkers: 'allow' });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.failed = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('requestfailed', (r) => page.failed.push(r.url()));
  return page;
}
// 登録した Service Worker が activated（install のプリキャッシュ完了後）になるまで待つ
const swActivated = (page) => page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  if (r.active.state !== 'activated') await new Promise((ok) => r.active.addEventListener('statechange', () => r.active.state === 'activated' && ok()));
  return r.active.state;
});
const swRegs = async (page) => { await page.waitForSelector('.cell'); await page.waitForTimeout(500); return page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length); };
const cacheKeys = (page) => page.evaluate(async () => (await caches.keys()).sort());
const pngSize = async (url) => { const r = await fetch(url); const b = Buffer.from(await r.arrayBuffer()); return [r.status, b.subarray(1, 4).toString(), b.readUInt32BE(16), b.readUInt32BE(20)]; };

for (const width of process.env.ONLY_24 ? [] : [360, 430]) {
  const tag = `[${width}]`;
  const root = await serveApp(SW_APP);
  const copy = mkdtempSync(path.join(tmpdir(), 'sf6-pages-'));
  cpSync(SW_APP, copy, { recursive: true }); // 別ディレクトリ（app/ の中身だけ）を、サブパスで配信する
  const sub = await serveApp(copy, '/strategy-memo/');

  // 19a. 受け入れ基準7.3-5: 機内モードで、起動・閲覧・編集・保存ができる
  for (const [label, srv] of [['ルート', root], ['サブパス /strategy-memo/', sub]]) {
    const page = await swPage(width);
    await page.goto(srv.origin());
    await check(`${tag} 19a ${label}: 初回アクセスでService Workerが登録され、activated になる`, async () => {
      assert.equal(await swActivated(page), 'activated');
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope), srv.origin());
    });
    await page.context().setOffline(true);
    srv.down = true;
    await page.reload().catch(() => {}); // キャッシュに無いと失敗する。次の検証で不合格として報告する
    await check(`${tag} 19a ${label}: 機内モードで再読み込みしても起動し、キャラ選択32件・CSS適用・SW経由・ネットワークへの要求なし`, async () => {
      assert.equal(await page.locator('.cell').count(), 32);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(14, 15, 17)'); // styles.css（--bg）が読めている
      assert.equal(await page.evaluate(() => document.fonts.check('20px "Tilt Neon"')), true);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true);
      assert.deepEqual(srv.downHits, []);
      assert.deepEqual(page.failed, []);
      assert.deepEqual(page.errors, []);
    });
    await check(`${tag} 19a ${label}: 機内モードで、クエリ付き・index.html直指定のURLでも起動する`, async () => {
      for (const u of [`${srv.origin()}?gray=1`, `${srv.origin()}index.html`, `${srv.origin()}#/settings`]) {
        await page.goto(u);
        await page.waitForSelector('#app *');
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(14, 15, 17)', u);
      }
      await page.goto(srv.origin());
      assert.deepEqual(srv.downHits, []);
    });
    // 機内モードで、セクション追加 -> 記録の作成・保存 -> 閲覧
    await page.locator('.cell[aria-label^="リュウ"]').click();
    await page.locator('.empty .chips .btn', { hasText: /^通常$/ }).click();
    await page.getByRole('link', { name: '記録', exact: true }).click();
    await page.waitForSelector('.pad');
    for (const n of ['中K', '波動 236', '強P']) await page.getByRole('button', { name: n, exact: true }).click();
    await page.getByLabel('タイトル（任意）').fill('機内モード');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => /^#\/c\/ryu\/r\/[0-9a-f]{32}$/.test(location.hash));
    await check(`${tag} 19a ${label}: 機内モードで、セクション追加・記録の作成・保存ができ、詳細で読める`, async () => {
      assert.equal(await page.locator('.d-title').innerText(), '機内モード');
      assert.equal(await page.locator('.d-cmd .chip').count(), 2);
      const d = await stored(page);
      assert.deepEqual([d.sections.map((x) => x.name), d.combos.map((x) => x.title)], [['通常'], ['機内モード']]);
    });
    await page.reload();
    await check(`${tag} 19a ${label}: 機内モードの再読み込みのあとも、保存した記録を一覧と詳細で閲覧できる`, async () => {
      await page.waitForSelector('.d-cmd .row');
      assert.equal(await page.locator('.d-title').innerText(), '機内モード');
      await gotoHash(page, '#/c/ryu');
      assert.equal(await page.locator('.item').count(), 1);
      assert.deepEqual(srv.downHits, []);
      assert.deepEqual(page.failed, []);
      assert.deepEqual(page.errors, []);
    });
    srv.down = false;
    await page.context().close();
  }

  // 19b. manifest とアイコン
  {
    const page = await swPage(width);
    await page.goto(root.origin());
    await check(`${tag} 19b manifest: 項目が仕様どおり（name・start_url・scope・display・orientation・lang・色）`, async () => {
      const m = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
      assert.deepEqual(
        Object.fromEntries(['name', 'short_name', 'start_url', 'scope', 'display', 'orientation', 'lang', 'theme_color', 'background_color'].map((k) => [k, m[k]])),
        { name: 'SF6戦略メモ', short_name: '戦略メモ', start_url: './', scope: './', display: 'standalone', orientation: 'portrait', lang: 'ja', theme_color: '#0E0F11', background_color: '#0E0F11' },
      );
      assert.equal(await page.locator('meta[name=theme-color]').getAttribute('content'), m.theme_color);
      assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'manifest.webmanifest');
      assert.equal(await page.locator('link[rel=icon]').getAttribute('href'), 'icon.svg');
    });
    await check(`${tag} 19b manifest: iconsは192・512のそれぞれが purpose any と maskable の2項目（併記しない）で、ファイルは200のPNGで宣言どおりの寸法`, async () => {
      const m = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
      assert.deepEqual(m.icons.map((i) => [i.src, i.sizes, i.type, i.purpose]), [
        ['icon-192.png', '192x192', 'image/png', 'any'], ['icon-192.png', '192x192', 'image/png', 'maskable'],
        ['icon-512.png', '512x512', 'image/png', 'any'], ['icon-512.png', '512x512', 'image/png', 'maskable'],
      ]);
      for (const [src, px] of [['icon-192.png', 192], ['icon-512.png', 512]]) assert.deepEqual(await pngSize(`${root.origin()}${src}`), [200, 'PNG', px, px], src);
      assert.equal((await fetch(`${root.origin()}icon.svg`)).status, 200);
    });
    await check(`${tag} 19b sw.js の CACHE は sf6memo-英数字 の形（配信時に内容ハッシュへ置き換わる。リポジトリ内の値はローカル開発用）`, async () => {
      assert.match(cacheOf(SW_APP), CACHE_RE);
    });
    await check(`${tag} 19b 配信時の版数: pages.yml の置き換えコマンドで CACHE が app/ の内容ハッシュ（sf6memo-8桁）になり、sw.js 以外を変えると変わり、変えなければ変わらない`, async () => {
      // pages.yml の run をそのまま、app/ のコピー（cwd 直下に app/）に対して実行する
      const stamp = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8').match(/- name: SWの版数[^\n]*\n\s+run: \|\n((?: {10}[^\n]*\n)+)/)[1].replace(/^ {10}/gm, '');
      const work = mkdtempSync(path.join(tmpdir(), 'sf6-stamp-'));
      try {
        cpSync(SW_APP, path.join(work, 'app'), { recursive: true });
        const run = () => { execFileSync('bash', ['-e', '-c', stamp], { cwd: work }); return cacheOf(path.join(work, 'app')); };
        const v1 = run();
        assert.match(v1, /^sf6memo-[0-9a-f]{8}$/);
        assert.equal(run(), v1, '内容が同じなら同じ版数（sw.js 自身の書き換えは版数に入らない）');
        for (const f of readdirSync(path.join(work, 'app')).filter((x) => x !== 'sw.js')) {
          const before = readFileSync(path.join(work, 'app', f));
          writeFileSync(path.join(work, 'app', f), Buffer.concat([before, Buffer.from('\n')]));
          assert.notEqual(run(), v1, `${f} を変えたのに版数が変わらない`);
          writeFileSync(path.join(work, 'app', f), before);
          assert.equal(run(), v1, `${f} を戻したら版数も戻る`);
        }
        // sw.js のコメントなど CACHE 以外を変えても、版数は内容ハッシュのまま（sw.js 自身は入力に含めない）
        writeFileSync(path.join(work, 'app', 'sw.js'), `${readFileSync(path.join(work, 'app', 'sw.js'), 'utf8')}// x\n`);
        assert.equal(run(), v1);
      } finally {
        rmSync(work, { recursive: true });
      }
    });
    await check(`${tag} 19b アイコンのPNGは新しい図案（背景・●P・管の芯・●Kの4点の色。192と512）`, async () => {
      const px = (src, pts) => page.evaluate(async ([u, pts]) => {
        const img = new Image(); img.src = u; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        return pts.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3));
      }, [`${root.origin()}${src}`, pts]);
      const want = [[14, 15, 17], [240, 216, 112], [255, 196, 160], [143, 211, 240]]; // #0E0F11 地、#F0D870 の●P（Pの左）、#FFC4A0 の管の芯（上辺）、#8FD3F0 の●K（Kの右）
      for (const [src, k] of [['icon-512.png', 1], ['icon-192.png', 0.375]]) {
        const got = await px(src, [[10 * k, 10 * k], [170 * k, 256 * k], [276 * k, 166 * k], [345 * k, 256 * k]].map(([x, y]) => [Math.round(x), Math.round(y)]));
        got.forEach((c, i) => assert.ok(c.every((v, j) => Math.abs(v - want[i][j]) <= 12), `${src} 点${i} ${c} != ${want[i]}`));
      }
    });
    await check(`${tag} 19b sw.js の FILES が、配信する app/ のファイル（sw.js・ライセンス文書を除く）と一致し、すべて取得できる`, async () => {
      const files = [...readFileSync(path.join(SW_APP, 'sw.js'), 'utf8').match(/const FILES = \[(.*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
      assert.deepEqual(files, readdirSync(SW_APP).filter((f) => f !== 'sw.js' && f !== 'OFL-TiltNeon.txt').sort());
      for (const f of files) assert.equal((await fetch(`${root.origin()}${f}`)).status, 200, f);
    });
    await check(`${tag} 19b 404がなく、サブパス配信（app/ の中身だけをルートに置く）でも絶対パス参照がない`, async () => {
      assert.deepEqual(root.misses, []);
      assert.deepEqual(sub.misses, []);
    });
    await page.context().close();
  }

  // 19c. 登録する条件
  {
    const stubs = [
      ['Capacitorのネイティブ環境（isNativePlatform: () => true）', root.origin(), () => { window.Capacitor = { isNativePlatform: () => true }; }, 0],
      ['Capacitorのブラウザ環境（isNativePlatform: () => false）は登録する', root.origin(), () => { window.Capacitor = { isNativePlatform: () => false }; }, 1],
      ['localhost以外のhttp（LANのアドレス相当、127.0.0.1）', root.origin('127.0.0.1'), null, 0],
      ['localhostのhttp（対照）', root.origin(), null, 1],
    ];
    for (const [label, url, init, regs] of stubs) {
      const page = await swPage(width, init);
      await page.goto(url);
      await check(`${tag} 19c 登録数が ${regs}: ${label}`, async () => {
        assert.equal(await swRegs(page), regs);
        assert.equal(await page.locator('.cell').count(), 32); // 登録しなくてもアプリは動く
        assert.deepEqual(page.errors, []);
      });
      await page.context().close();
    }
    const fail = await swPage(width, () => { navigator.serviceWorker.register = () => Promise.reject(new Error('stub')); });
    const warns = [];
    fail.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
    await fail.goto(root.origin());
    await check(`${tag} 19c 登録に失敗してもコンソールに出すだけで、アプリは動く`, async () => {
      await fail.waitForSelector('.cell');
      await fail.waitForTimeout(300);
      assert.equal(await fail.locator('.cell').count(), 32);
      assert.deepEqual(fail.errors, []);
      assert.equal(warns.length, 1, warns.join('|'));
    });
    await fail.context().close();
  }

  // 19d. 更新: 版数を変えた sw.js を配信し直す。開いているタブは旧版で動き続け、タブを閉じると新版が有効になって旧キャッシュを消す
  {
    const page = await swPage(width);
    await page.goto(root.origin());
    await swActivated(page);
    await page.evaluate(async () => { // 旧版の残骸と、同じオリジンの他アプリのキャッシュ
      await (await caches.open('sf6memo-v0')).put('/x', new Response('old'));
      await (await caches.open('other-app-v1')).put('/x', new Response('other'));
    });
    await page.reload(); // 現行版に制御されたタブ
    const v1 = (await cacheKeys(page)).filter((k) => k.startsWith('sf6memo-') && k !== 'sf6memo-v0');
    // デプロイの再現: app.js が変わり（印を足す）、CACHE が変わる。サーバーは max-age=600 を付けているので、HTTPキャッシュの古い app.js を新しいキャッシュへ入れると印が無い
    root.sw = (t) => t.replace(/const CACHE = '[^']*'/, "const CACHE = 'sf6memo-v3'");
    root.appjs = (t) => `${t}\n// DEPLOY-2 MARKER\n`;
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await page.waitForFunction(async () => (await caches.keys()).includes('sf6memo-v3'), null, { timeout: 8000 }); // 新版のインストール（プリキャッシュ）が始まった
    await page.waitForTimeout(1500); // skipWaiting があれば、この間に有効化されて旧キャッシュが消える
    await check(`${tag} 19d 更新: 新版はプリキャッシュして待機するだけ（skipWaitingなし）。旧版のキャッシュは残り、開いているタブは動き続ける`, async () => {
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state), 'installed');
      assert.deepEqual(v1.length, 1);
      assert.equal(v1[0], cacheOf(SW_APP));
      assert.deepEqual(await cacheKeys(page), ['other-app-v1', 'sf6memo-v0', v1[0], 'sf6memo-v3'].sort());
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state), 'activated');
      await page.locator('.cell[aria-label^="ケン"]').click();
      await page.waitForFunction(() => location.hash === '#/c/ken');
      assert.deepEqual(page.errors, []);
    });
    await check(`${tag} 19d 更新: 新しいキャッシュには、HTTPキャッシュ（max-age=600）の古い版でなく、サーバーの新しい app.js が入る（cache: 'reload'）`, async () => {
      assert.equal(await page.evaluate(async () => (await (await (await caches.open('sf6memo-v3')).match('app.js')).text()).includes('DEPLOY-2 MARKER')), true);
    });
    await page.close(); // 開いているタブがなくなる
    const next = await page.context().newPage();
    await next.goto(root.origin());
    await check(`${tag} 19d 更新: タブを閉じたあと新版が有効になり、sf6memo- の旧キャッシュだけが消える（他アプリのキャッシュは残る）`, async () => {
      await next.waitForFunction(async () => (await caches.keys()).includes('sf6memo-v3') && !(await caches.keys()).includes('sf6memo-v0'), null, { timeout: 8000 });
      assert.deepEqual(await cacheKeys(next), ['other-app-v1', 'sf6memo-v3']);
      assert.equal(await next.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.scriptURL), `${root.origin()}sw.js`);
    });
    await next.context().close();
    root.sw = (t) => t;
    root.appjs = (t) => t;
  }

  await root.close();
  await sub.close();
  rmSync(copy, { recursive: true });
}
if (process.env.ONLY_SW) await finish();

for (const width of process.env.ONLY_24 ? [] : [360, 430]) {
  const tag = `[${width}]`;

  // 1. キャラ選択 -> 再読み込み -> 最近使ったキャラ
  {
    const page = await newPage(width);
    await check(`${tag} 1 初回は案内文とグリッド32件`, async () => {
      assert.equal(await page.locator('.cell').count(), 32);
      assert.match(await page.locator('.bottombar').innerText(), /キャラクターを選ぶと記録を始められます/);
      assert.equal(await page.locator('.cell-n, .cell-lv').count(), 0); // 件数・メーターは見せない（D-016）
      assert.ok(await noHScroll(page));
    });
    await shot(page, '01-home-first', width);
    for (const n of ['リュウ', '春麗', 'ケン', 'ガイル']) {
      await page.locator(`.cell[aria-label^="${n}"]`).click();
      await page.waitForFunction((t) => location.hash.startsWith('#/c/') && document.querySelector('.topbar h1')?.textContent.endsWith(t), n); // h1は「RYU」（装飾）＋読み上げ名のカナ
      await page.getByRole('button', { name: 'キャラクター選択に戻る' }).click();
      await page.waitForSelector('.grid');
    }
    await page.reload();
    await check(`${tag} 1 再読み込み後、最近使ったキャラが新しい順で最大3件`, async () => {
      assert.deepEqual(await page.locator('.recent-list a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['ガイル', 'ケン', '春麗']); // 英字は aria-hidden の装飾
    });
    await shot(page, '02-home-recent', width);
    await page.locator('.recent-list a').first().click();
    await check(`${tag} 1 最近使ったキャラから一覧へ`, async () => assert.equal(await hash(page), '#/c/guile'));
    await check(`${tag} 未知のhashは #/ へ`, async () => {
      await gotoHash(page, '#/nonsense/xx');
      assert.equal(await hash(page), '#/');
      await gotoHash(page, '#/c/nobody');
      assert.equal(await hash(page), '#/');
    });
    await check(`${tag} 1 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 2. 保存失敗と不正データ
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu');
    const before = await storedRaw(page);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    await page.getByRole('button', { name: 'セクション', exact: true }).click();
    await page.getByRole('button', { name: 'スタン' }).click();
    await page.waitForSelector('.err');
    await check(`${tag} 2 保存失敗でその場にエラーが出て、操作は巻き戻る（画面にもメモリにも残らない）`, async () => {
      const t = await page.locator('.err').innerText();
      assert.match(t, /保存できませんでした/);
      assert.match(t, /端末の保存領域がいっぱいです。変更は保存されませんでした。/);
      assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め']);
      assert.equal(await page.locator('.err[role=alert]').count(), 1); // 読み上げられる
      assert.equal(await page.locator('#toast .toast').count(), 0); // 保存に失敗した操作に［元に戻す］は出さない
    });
    await shot(page, '03-save-error', width);
    await page.getByRole('button', { name: '起き攻めのメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click(); // 空のセクションの削除も保存に失敗する
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 2 保存に失敗した削除には［元に戻す］を出さず、エラーを出す`, async () => {
      assert.equal(await page.locator('#toast .toast').count(), 0);
      assert.equal(await page.locator('.err').count(), 1);
      assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め']);
    });
    await page.reload();
    await check(`${tag} 2 再読み込み後にデータが変わっていない`, async () => {
      assert.equal(await storedRaw(page), before);
      assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め']);
    });
    await check(`${tag} 2 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    const bad = await newPage(width);
    await bad.evaluate(() => localStorage.setItem('sf6memo.data', '{broken'));
    await bad.reload();
    await check(`${tag} 2 壊れたJSONは上書きせず、エラー表示の読み取り専用で起動`, async () => {
      assert.equal(await storedRaw(bad), '{broken');
      const t = await bad.locator('.err').innerText();
      assert.match(t, /保存データを読み込めませんでした（データは変更していません）/);
      assert.match(t, /JSONとして読めません/);
      assert.match(t, /読み取り専用/);
      await bad.locator('.cell[aria-label^="リュウ"]').click();
      await bad.waitForSelector('.topbar');
      assert.equal(await bad.locator('.bottombar').count(), 0); // 変更操作は出さない
      assert.equal(await bad.locator('.err').count(), 1);
      assert.equal(await storedRaw(bad), '{broken');
    });
    await shot(bad, '04-readonly', width);
    await bad.evaluate(() => localStorage.setItem('sf6memo.data', JSON.stringify({ app: 'sf6-strategy-memo', schemaVersion: 1, sections: [], combos: [{ id: '<img src=x onerror=alert(1)>' }] })));
    await bad.reload();
    await check(`${tag} 2 検証に通らない文書も同様（理由はtextContent）`, async () => {
      assert.match(await bad.locator('.err').innerText(), /読み込めませんでした/);
      assert.equal(await bad.locator('img').count(), 0);
    });
    await bad.context().close();
  }

  // 3. セクションの追加・名称変更・並べ替え・削除
  {
    const page = await newPage(width);
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 3 空状態: 候補ボタンと［名前を付けて作る］`, async () => {
      const t = await page.locator('.empty').innerText();
      assert.match(t, /このキャラクターの記録はまだありません。まず状況（セクション）を作ります。/);
      assert.deepEqual(await page.locator('.empty .chips .btn').allInnerTexts(), ['通常', 'カウンター', 'パニッシュカウンター', 'インパクト壁やられ', 'スタン', '画面端', '起き攻め']);
      assert.equal(await page.getByRole('button', { name: '記録', exact: true }).isDisabled(), true);
      assert.ok(await noHScroll(page));
    });
    await shot(page, '05-list-empty', width);
    await page.locator('.empty .chips .btn', { hasText: /^通常$/ }).click(); // 候補から1タップ
    await page.getByRole('button', { name: 'セクション', exact: true }).click();
    await page.getByRole('button', { name: 'カウンター', exact: true }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.getByRole('button', { name: 'セクション', exact: true }).click();
    await shot(page, '06-sheet-add', width);
    await page.getByRole('button', { name: '名前を付けて作る' }).click();
    await page.getByLabel('セクション名').fill('');
    await page.getByRole('button', { name: '追加', exact: true }).click();
    await check(`${tag} 3 空の名前は追加されずエラー`, async () => {
      assert.match(await page.locator('.field-err').innerText(), /入力してください/);
      assert.equal((await stored(page)).sections.length, 2);
    });
    await page.getByLabel('セクション名').fill('  自作  ');
    await page.getByRole('button', { name: '追加', exact: true }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 3 追加（候補・自作）`, async () => {
      assert.deepEqual(await names(page), ['通常', 'カウンター', '自作']);
      assert.deepEqual((await stored(page)).sections.map((s) => [s.name, s.order]), [['通常', 0], ['カウンター', 1], ['自作', 2]]);
    });
    await check(`${tag} 3 追加済みの候補は候補から消える`, async () => {
      await page.getByRole('button', { name: 'セクション', exact: true }).click();
      assert.equal(await page.locator('.sheet .chips .btn', { hasText: /^通常$/ }).count(), 0);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
    });
    // 名称変更
    await page.getByRole('button', { name: 'カウンターのメニュー' }).click();
    await shot(page, '07-sheet-menu', width);
    await page.getByRole('button', { name: '名称変更' }).click();
    await page.getByLabel('セクション名').fill('CTR');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 3 名称変更`, async () => {
      assert.deepEqual(await names(page), ['通常', 'CTR', '自作']);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'CTRのメニュー'); // フォーカス復帰
    });
    // メニューの上へ／下へ
    await page.getByRole('button', { name: '自作のメニュー' }).click();
    await page.getByRole('button', { name: '上へ' }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 3 シートの［上へ］`, async () => assert.deepEqual(await names(page), ['通常', '自作', 'CTR']));
    // 並べ替えモード
    await page.getByRole('button', { name: '並べ替え' }).click();
    await check(`${tag} 3 並べ替えモード: 見出しだけ・［完了］のみ・先頭の上は無効`, async () => {
      assert.equal(await page.locator('.item, .empty-sec').count(), 0);
      assert.deepEqual(await page.locator('.bottombar .btn').allInnerTexts(), ['完了']);
      assert.equal(await page.getByRole('button', { name: '通常を上へ' }).isDisabled(), true);
      assert.ok(await noHScroll(page));
    });
    await shot(page, '08-reorder', width);
    await page.getByRole('button', { name: 'CTRを上へ' }).click();
    await check(`${tag} 3 並べ替え: ライブリージョンで読み上げ・フォーカス維持`, async () => {
      await page.waitForFunction(() => document.getElementById('live').textContent !== '');
      assert.equal(await page.locator('#live').textContent(), 'CTRを2番目に移動');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'CTRを上へ');
    });
    await page.getByRole('button', { name: 'CTRを上へ' }).click();
    await check(`${tag} 3 先頭まで上げるとフォーカスは［下へ］へ`, async () => {
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'CTRを下へ');
    });
    await page.getByRole('button', { name: '完了' }).click();
    const order1 = ['CTR', '通常', '自作'];
    await check(`${tag} 3 並べ替えの結果`, async () => assert.deepEqual(await names(page), order1));
    await page.reload();
    await check(`${tag} 3 再読み込み後も順序が保たれる`, async () => {
      assert.deepEqual(await names(page), order1);
      assert.deepEqual((await stored(page)).sections.map((s) => s.order).sort(), [0, 1, 2]);
    });

    // 中身の入れ方: 保存データへ直接コンボを入れる（CTRと通常に1件ずつ）
    const doc = await stored(page);
    const idOf = (n) => doc.sections.find((s) => s.name === n).id;
    doc.combos = [combo('c1', idOf('CTR'), '一つ目', [N('stand', 'L', 'P')]), combo('c2', idOf('通常'), '二つ目', [N('stand', 'M', 'P')])];
    await page.evaluate((d) => localStorage.setItem('sf6memo.data', JSON.stringify(d)), doc);
    await page.reload();
    const base = await stored(page);

    // 空のセクションは即時削除 + 取り消し
    await page.getByRole('button', { name: '自作のメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 3 空のセクションは即時削除され、取り消しトーストが出る`, async () => {
      assert.deepEqual(await names(page), ['CTR', '通常']);
      assert.match(await page.locator('#toast').innerText(), /「自作」を削除しました/);
      assert.equal(await page.locator('#toast').getAttribute('role'), 'status');
      assert.deepEqual((await stored(page)).sections.map((s) => s.order).sort(), [0, 1]);
    });
    await shot(page, '09-toast-undo', width);
    await page.getByRole('button', { name: '元に戻す' }).click();
    await check(`${tag} 3 取り消しで元の状態に戻る（deepEqual）`, async () => {
      assert.deepEqual(await stored(page), base);
      assert.deepEqual(await names(page), order1);
    });

    // 中身のあるセクションは移動先を選ぶまで消えない
    await page.getByRole('button', { name: 'CTRのメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await shot(page, '10-sheet-delete', width);
    await check(`${tag} 3 中身ありは移動先を選ぶまで削除ボタンが無効で、削除されない`, async () => {
      assert.equal(await page.getByRole('button', { name: '移動して削除' }).isDisabled(), true);
      assert.deepEqual(await stored(page), base);
    });
    await page.getByRole('radio', { name: /通常/ }).check();
    await check(`${tag} 3 移動先を選ぶと有効になる`, async () => assert.equal(await page.getByRole('button', { name: '移動して削除' }).isDisabled(), false));
    await page.getByRole('button', { name: '移動して削除' }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 3 移動して削除: 記録は移動先へ、取り消しトースト`, async () => {
      const d = await stored(page);
      assert.deepEqual([...d.sections].sort((a, b) => a.order - b.order).map((s) => s.name), ['通常', '自作']);
      const normal = d.sections.find((s) => s.name === '通常');
      assert.deepEqual(d.combos.map((c) => c.sectionId), [normal.id, normal.id]);
      assert.match(await page.locator('#toast').innerText(), /「CTR」を削除し、1件を「通常」へ移動しました/);
    });
    await page.getByRole('button', { name: '元に戻す' }).click();
    await check(`${tag} 3 取り消しで元の状態に戻る（移動削除、deepEqual）`, async () => assert.deepEqual(await stored(page), base));

    // 他にセクションがないとき、中身のあるセクションは削除不可
    await gotoHash(page, '#/c/luke');
    const d2 = await stored(page);
    d2.sections.push(sec('lk1', 'luke', '唯一', 0));
    d2.combos.push({ ...combo('c9', 'lk1', 'ルーク記録', [N('stand', 'L', 'K')]), characterId: 'luke' });
    await page.evaluate((d) => localStorage.setItem('sf6memo.data', JSON.stringify(d)), d2);
    await page.reload();
    await page.getByRole('button', { name: '唯一のメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await check(`${tag} 3 他にセクションが無いと削除ボタンが無効で理由を表示する`, async () => {
      assert.equal(await page.getByRole('button', { name: '移動して削除' }).isDisabled(), true);
      assert.match(await page.locator('.sheet').innerText(), /他にセクションがないため削除できません/);
    });
    await shot(page, '11-sheet-delete-disabled', width);
    // 戻る操作でシートが閉じ、画面は留まる
    await page.goBack();
    await check(`${tag} 3 戻る操作でシートが閉じる（画面は移らない）`, async () => {
      await page.waitForSelector('.sheet', { state: 'detached' });
      assert.equal(await hash(page), '#/c/luke');
      assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
    });
    await page.goBack();
    await check(`${tag} 3 続けて戻ると直前の画面`, async () => assert.equal(await hash(page), '#/c/ryu'));
    await check(`${tag} 3 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 4. 一覧のSプレビューと詳細プレースホルダー
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 4 Sプレビューが描画され、高さ28pxで切れる`, async () => {
      assert.equal(await page.locator('.item').count(), 3);
      assert.equal(await page.locator('.preview .row.S').count(), 3);
      const hs = await page.$$eval('.preview', (els) => els.map((e) => ({ h: e.getBoundingClientRect().height, ov: getComputedStyle(e).overflow, inner: e.firstElementChild.scrollHeight })));
      assert.ok(hs.every((x) => x.h === 28 && x.ov === 'hidden'), JSON.stringify(hs));
      assert.ok(hs.some((x) => x.inner > 28), '長い列が2行に折り返して切れている');
      assert.deepEqual(await page.locator('.item-meta').allInnerTexts(), ['画面端・全24手', 'どこでも・基本・全5手', 'どこでも・全2手']); // 新しい順。ノートは手に数えない
      assert.match((await page.locator('.item-title').allInnerTexts()).join(), /長いコンボ,基本コンボ/);
      assert.ok(await noHScroll(page));
    });
    await check(`${tag} 4 ［＋］は new?s= へ、見出しに番号と件数`, async () => {
      assert.equal(await page.getByRole('link', { name: '画面端に記録を追加' }).getAttribute('href'), '#/c/ryu/new?s=s2');
      assert.equal(await page.getByRole('link', { name: '記録', exact: true }).getAttribute('href'), '#/c/ryu/new?s=s1');
      assert.match(await page.locator('.sec-head').first().innerText(), /01\s*通常\s*2件/);
    });
    await shot(page, '12-list', width);
    // 折りたたみ
    await page.getByRole('button', { name: /通常/ }).first().click();
    await check(`${tag} 4 折りたたみ: 行が隠れ、状態が保存され再読み込み後も維持`, async () => {
      assert.equal(await page.locator('.item').count(), 1);
      assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('sf6memo.settings')))).collapsed.ryu.s1, true);
      await page.reload();
      assert.equal(await page.locator('.item').count(), 1);
      assert.equal(await page.locator('.sec-toggle').first().getAttribute('aria-expanded'), 'false');
    });
    await shot(page, '13-list-collapsed', width);
    await page.locator('.sec-toggle').first().click();
    // 行タップ -> 詳細プレースホルダー -> 戻る
    await page.locator('.item', { hasText: '基本コンボ' }).click();
    await check(`${tag} 4 行タップで詳細へ`, async () => {
      assert.equal(await hash(page), '#/c/ryu/r/c1');
      assert.equal(await page.locator('.d-title').innerText(), '基本コンボ');
    });
    await page.goBack();
    await check(`${tag} 4 端末の戻る操作で一覧に戻る`, async () => {
      assert.equal(await hash(page), '#/c/ryu');
      await page.waitForSelector('.item');
    });
    await page.locator('.item', { hasText: '基本コンボ' }).click();
    await page.getByRole('button', { name: /の一覧に戻る/ }).click();
    await check(`${tag} 4 アプリ内の戻るボタンでも一覧に戻る`, async () => {
      assert.equal(await hash(page), '#/c/ryu');
      await page.waitForSelector('.item');
    });
    await page.getByRole('link', { name: '記録', exact: true }).click();
    await check(`${tag} 4 ＋記録は新規作成画面（セクション選択済み）、編集・設定のルート`, async () => {
      assert.equal(await page.locator('#f-sec').evaluate((e) => e.selectedOptions[0].textContent), '通常');
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      assert.match(await page.locator('.topbar h1').innerText(), /編集/);
      await gotoHash(page, '#/settings');
      assert.match(await page.locator('.topbar h1').innerText(), /設定/);
      await gotoHash(page, '#/');
    });
    await check(`${tag} 4 履歴がない画面（直接開いた設定）の戻るは親画面へ置き換える`, async () => {
      const fresh = await (await browser.newContext({ viewport: { width, height: 740 } })).newPage();
      await fresh.goto(`${BASE}#/settings`);
      const len = await fresh.evaluate(() => history.length);
      await fresh.getByRole('button', { name: 'キャラクター選択に戻る' }).click();
      assert.equal(await hash(fresh), '#/');
      assert.equal(await fresh.locator('.grid').count(), 1);
      assert.equal(await fresh.evaluate(() => history.length), len); // 履歴を増やしていない
      await fresh.context().close();
    });
    await check(`${tag} 4 ホームの件数は読み上げ名だけ（見える文字は英字のみ）`, async () => {
      const cell = page.locator('.cell[aria-label^="リュウ"]');
      assert.equal(await cell.getAttribute('aria-label'), 'リュウ 3件');
      assert.equal(await cell.innerText(), 'RYU');
    });
    await check(`${tag} 4 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 6. 他タブの変更（M1）
  {
    const ctx = await browser.newContext({ viewport: { width, height: 740 } });
    const open = async (blockStorageEvent) => {
      const p = await ctx.newPage();
      p.errors = [];
      p.on('pageerror', (e) => p.errors.push(e.message));
      // 他タブの storage イベントを app が受け取れない状況（イベントの取りこぼし）を再現する。app より先に登録して止める
      if (blockStorageEvent) await p.addInitScript(() => addEventListener('storage', (e) => e.stopImmediatePropagation()));
      await p.goto(`${BASE}#/c/ryu`);
      return p;
    };
    const a = await open(false);
    await a.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc(seedState()));
    await a.reload();
    const b = await open(false);
    const add = async (p, name) => {
      await p.getByRole('button', { name: 'セクション', exact: true }).click();
      await p.getByRole('button', { name, exact: true }).click();
      await p.waitForSelector('.sheet', { state: 'detached' });
    };
    const addCustom = async (p, name) => {
      await p.getByRole('button', { name: 'セクション', exact: true }).click();
      await p.getByRole('button', { name: '名前を付けて作る' }).click();
      await p.getByLabel('セクション名').fill(name);
      await p.getByRole('button', { name: '追加', exact: true }).click();
      await p.waitForSelector('.sheet', { state: 'detached' });
    };
    await add(a, 'スタン');
    await check(`${tag} 6 他タブの追加が、再読み込みなしで反映される（storageイベント）`, async () => {
      await b.waitForFunction(() => [...document.querySelectorAll('.sec-name')].some((e) => e.textContent === 'スタン'));
      assert.deepEqual(await names(b), ['通常', '画面端', '起き攻め', 'スタン']);
    });
    await add(b, 'カウンター');
    await a.reload();
    await check(`${tag} 6 A追加→B追加→Aリロードで両方のセクションが残る`, async () => {
      assert.deepEqual(await names(a), ['通常', '画面端', '起き攻め', 'スタン', 'カウンター']);
      assert.equal((await stored(a)).sections.length, 5);
    });
    await check(`${tag} 6 他タブの変更でシートは閉じる`, async () => {
      await a.getByRole('button', { name: '通常のメニュー' }).click();
      await a.waitForSelector('.sheet');
      await add(b, 'パニッシュカウンター');
      await a.waitForSelector('.sheet', { state: 'detached' });
      assert.equal(await a.evaluate(() => document.getElementById('app').inert), false);
      assert.equal((await names(a)).includes('パニッシュカウンター'), true);
    });
    // イベントを取りこぼした古いタブは、上書きせずに読み直して通知する
    const stale = await open(true);
    await add(a, 'インパクト壁やられ');
    const beforeStale = await storedRaw(a);
    await addCustom(stale, 'Stale追加');
    await check(`${tag} 6 古いタブからの保存は他タブの内容を上書きせず、読み直して通知する`, async () => {
      assert.equal(await storedRaw(a), beforeStale);
      const t = await stale.locator('.err').innerText();
      assert.match(t, /他のタブで変更されたため、最新の内容を読み込み直しました。もう一度操作してください。/);
      assert.equal((await names(stale)).includes('インパクト壁やられ'), true);
      assert.equal(await stale.locator('#toast .toast').count(), 0);
    });
    await check(`${tag} 6 読み直した後の操作は保存でき、エラーが消える`, async () => {
      await addCustom(stale, 'Fresh追加');
      assert.equal(await stale.locator('.err').count(), 0);
      assert.deepEqual((await stored(a)).sections.map((x) => x.name).slice(-2), ['インパクト壁やられ', 'Fresh追加']);
    });
    await check(`${tag} 6 ページエラーなし`, async () => assert.deepEqual([...a.errors, ...b.errors, ...stale.errors], []));
    await ctx.close();
  }

  // 7. エラー帯の位置（M2）と保存失敗の種類（L3・L4）
  {
    const many = seedState();
    for (let i = 0; i < 40; i++) many.combos.push(combo(`c${100 + i}`, 's3', `記録${i}`, [N('stand', 'L', 'P'), SP('236', 'M', 'K')]));
    const page = await newPage(width, many);
    await gotoHash(page, '#/c/ryu');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    await page.getByRole('button', { name: 'セクション', exact: true }).click();
    await page.getByRole('button', { name: 'スタン', exact: true }).click();
    await page.waitForSelector('.err');
    await check(`${tag} 7 最下部までスクロールした状態の保存失敗でも、エラー帯がビューポート内にある`, async () => {
      const r = await page.evaluate(() => {
        const e = document.querySelector('.banners').getBoundingClientRect();
        return { top: e.top, bottom: e.bottom, vh: innerHeight, scrolled: scrollY, barBottom: document.querySelector('.topbar').getBoundingClientRect().bottom };
      });
      assert.ok(r.scrolled > 500, `スクロールしている ${r.scrolled}`);
      assert.ok(r.top >= 0 && r.bottom <= r.vh, JSON.stringify(r));
      assert.ok(Math.abs(r.top - r.barBottom) < 1, `上部バーの直下 ${JSON.stringify(r)}`);
    });
    await shot(page, '15-error-scrolled', width);
    await page.context().close();

    const denied = await newPage(width, seedState());
    await gotoHash(denied, '#/c/ryu');
    await denied.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); }; });
    await denied.getByRole('button', { name: 'セクション', exact: true }).click();
    await denied.getByRole('button', { name: 'スタン', exact: true }).click();
    await check(`${tag} 7 非quotaの保存失敗（SecurityError）は別の文言で、操作は巻き戻る`, async () => {
      await denied.waitForSelector('.err');
      const t = await denied.locator('.err').innerText();
      assert.match(t, /ブラウザが保存を許可していません。変更は保存されませんでした。/);
      assert.doesNotMatch(t, /保存領域がいっぱい/);
      assert.equal((await names(denied)).includes('スタン'), false);
    });
    await denied.context().close();

    // settings だけの失敗ではバナーを出さない（dataは保存できる）
    const sOnly = await newPage(width, seedState());
    await sOnly.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'sf6memo.settings') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
    });
    await gotoHash(sOnly, '#/c/ken'); // recentCharacters の保存が失敗する
    await sOnly.getByRole('button', { name: 'キャラクター選択に戻る' }).click();
    await gotoHash(sOnly, '#/c/ryu');
    await sOnly.getByRole('button', { name: '通常' }).first().click(); // 折りたたみ（settings保存が失敗）
    await check(`${tag} 7 settingsだけの保存失敗ではエラーを出さず、メモリ上の値は保つ`, async () => {
      assert.equal(await sOnly.locator('.err').count(), 0);
      assert.equal(await sOnly.locator('.sec-toggle').first().getAttribute('aria-expanded'), 'false');
    });
    await sOnly.context().close();

    // 1001個目のセクションは保存せず、理由を出す（L4）
    const big = { sections: Array.from({ length: 1000 }, (_, i) => sec(`b${i}`, 'ryu', `区分${i}`, i)), combos: [] };
    const bp = await newPage(width, big);
    await gotoHash(bp, '#/c/ryu');
    const rawBig = await storedRaw(bp);
    await bp.getByRole('button', { name: 'セクション', exact: true }).click();
    await bp.getByRole('button', { name: 'スタン', exact: true }).click();
    await check(`${tag} 7 1001個目のセクションは書かれず、エラー（理由）が出る`, async () => {
      await bp.waitForSelector('.err');
      assert.match(await bp.locator('.err').innerText(), /保存できませんでした[\s\S]*sectionsが多すぎます/);
      assert.equal(await storedRaw(bp), rawBig);
      assert.equal(await bp.locator('.sec-head').count(), 1000);
    });
    await bp.context().close();
  }

  // 8. フォーカス・Tab閉じ込め・取り消しの範囲・入力エラー（L5・L7）
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu');
    const active = () => page.evaluate(() => ({ fk: document.activeElement?.dataset?.fk ?? null, cls: document.activeElement?.className ?? '', inSheet: !!document.activeElement?.closest('.sheet'), text: document.activeElement?.textContent ?? '' }));
    // 空のセクション（起き攻めは空）を削除 -> フォーカスは［元に戻す］へ。Enterで取り消すと見出しへ戻る
    await page.getByRole('button', { name: '起き攻めのメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 8 削除の直後、フォーカスはトーストの［元に戻す］にある`, async () => {
      assert.match((await active()).cls, /toast-act/);
    });
    await page.keyboard.press('Enter');
    await check(`${tag} 8 取り消し後、フォーカスは復元された見出しのボタンへ`, async () => {
      assert.equal(await page.locator('#toast .toast').count(), 0);
      assert.match((await active()).fk, /^fold:s3$/);
      assert.equal((await names(page)).length, 3);
    });
    // 取り消しの範囲: 削除 -> 別の変更でトーストが消える（古い取り消しで他の変更を巻き戻さない）
    await page.getByRole('button', { name: '起き攻めのメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await page.waitForSelector('#toast .toast');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.getByRole('button', { name: '通常のメニュー' }).click();
    await page.getByRole('button', { name: '名称変更' }).click();
    await page.getByLabel('セクション名').fill('改名');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 8 削除のあと別の変更をするとトーストは消える`, async () => {
      assert.equal(await page.locator('#toast').innerText(), '');
      assert.equal(await page.locator('#toast .toast').count(), 0);
      assert.deepEqual(await names(page), ['改名', '画面端']);
    });
    // 空状態の候補追加 -> フォーカスは追加された見出しへ
    const empty = await newPage(width);
    await gotoHash(empty, '#/c/luke');
    await empty.locator('.empty .chips .btn', { hasText: /^スタン$/ }).click();
    await check(`${tag} 8 空状態の候補で追加した後、フォーカスは追加された見出しへ`, async () => {
      const a = await empty.evaluate(() => ({ fk: document.activeElement.dataset.fk, name: document.activeElement.querySelector('.sec-name')?.textContent }));
      assert.match(a.fk, /^fold:/);
      assert.equal(a.name, 'スタン');
    });
    await empty.context().close();

    // Tab閉じ込め: メニュー
    await page.getByRole('button', { name: '画面端のメニュー' }).click();
    await check(`${tag} 8 シート(メニュー): 末尾からTabで先頭へ、先頭からShift+Tabで末尾へ`, async () => {
      await page.getByRole('button', { name: '閉じる' }).focus();
      await page.keyboard.press('Tab');
      assert.equal((await active()).text, '名称変更');
      await page.keyboard.press('Shift+Tab');
      assert.equal((await active()).text, '閉じる');
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.equal((await active()).inSheet, true); }
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Shift+Tab'); assert.equal((await active()).inSheet, true); }
    });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
    // Tab閉じ込め: ラジオグループ（中身のあるセクションの削除。移動先が2つ以上ある状態にする）
    await page.getByRole('button', { name: 'セクション', exact: true }).click();
    await page.getByRole('button', { name: 'スタン', exact: true }).click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.getByRole('button', { name: '改名のメニュー' }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await check(`${tag} 8 シート(ラジオ): 先頭でShift+Tab・選択後のShift+Tabでもシート内に留まる`, async () => {
      await page.getByRole('radio').first().focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal((await active()).text, '閉じる'); // 有効な末尾（［移動して削除］は無効）
      await page.keyboard.press('Tab');
      assert.equal((await active()).inSheet && (await page.evaluate(() => document.activeElement.type)), 'radio');
      await page.keyboard.press('ArrowDown'); // 2番目を選択 -> Tab停止位置が選択中のラジオ（DOM順の先頭ではない）に移る
      await page.keyboard.press('Shift+Tab');
      const a = await active();
      assert.equal(a.inSheet, true);
      assert.equal(a.text, '移動して削除'); // 最初の停止位置から末尾へ折り返す
      for (let i = 0; i < 10; i++) { await page.keyboard.press('Shift+Tab'); assert.equal((await active()).inSheet, true); }
      for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); assert.equal((await active()).inSheet, true); }
    });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });

    // 名称入力: エラー後に入力し直すと aria-invalid が外れる
    await page.getByRole('button', { name: 'セクション', exact: true }).click();
    await page.getByRole('button', { name: '名前を付けて作る' }).click();
    await page.getByLabel('セクション名').fill('');
    await page.getByRole('button', { name: '追加', exact: true }).click();
    await check(`${tag} 8 名称入力: エラー後に入力し直すと aria-invalid とエラー文が消える`, async () => {
      assert.equal(await page.getByLabel('セクション名').getAttribute('aria-invalid'), 'true');
      await page.getByLabel('セクション名').fill('a');
      assert.equal(await page.getByLabel('セクション名').getAttribute('aria-invalid'), null);
      assert.equal(await page.locator('.field-err').innerText(), '');
    });
    await page.context().close();
    // 上部バーの［設定］は44px
    const home = await newPage(width);
    await check(`${tag} 8 ［設定］の高さは44px以上`, async () => assert.ok((await home.locator('.top-action').boundingBox()).height >= 44));
    await home.context().close();
  }

  // 9. 壊れた settings・特殊な hash・永続化の要求
  {
    const bads = ['{broken', 'null', '[]', '"x"', '{"collapsed":"abc","recentCharacters":"ryu","notation":5}',
      '{"collapsed":{"ryu":[true],"__proto__":{"a":true},"nobody":{"x":true}},"recentCharacters":[1,null,"ryu","ryu","nobody"],"lastChangeAt":-5}'];
    for (const bad of bads) {
      const page = await newPage(width, seedState());
      await page.evaluate((v) => localStorage.setItem('sf6memo.settings', v), bad);
      await page.reload();
      await gotoHash(page, '#/c/ryu');
      await check(`${tag} 9 壊れた settings ${bad.slice(0, 24)}… でも既定値で起動し、dataは読める`, async () => {
        assert.equal(await page.locator('.err').count(), 0);
        assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め']);
        assert.equal(await page.locator('.item').count(), 3);
        assert.deepEqual(page.errors, []);
      });
      await page.context().close();
    }
    const page = await newPage(width, seedState());
    for (const [h, want] of [['#/c/__proto__', '#/'], ['#/__proto__', '#/'], ['#/c/constructor', '#/'], ['#/c/ryu/x', '#/'], ['#/settings/x', '#/'], ['#/c/ryu/new?s=__proto__', '#/c/ryu/new?s=__proto__']]) {
      await gotoHash(page, h);
      await check(`${tag} 9 hash ${h} -> ${want}`, async () => {
        assert.equal(await hash(page), want);
        assert.equal(await page.locator('.topbar h1').count(), 1);
      });
    }
    await check(`${tag} 9 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    // navigator.storage.persist() は、データの初回保存成功時に1回だけ（settingsの書き込みでは呼ばない）
    const ctx = await browser.newContext({ viewport: { width, height: 740 } });
    await ctx.addInitScript(() => { window.__persist = 0; navigator.storage.persist = async () => { window.__persist++; return true; }; });
    const pp = await ctx.newPage();
    await pp.goto(`${BASE}#/c/ryu`); // recentCharacters の保存（settings）
    await check(`${tag} 9 settingsの保存だけではpersist()を呼ばない`, async () => assert.equal(await pp.evaluate(() => window.__persist), 0));
    await pp.locator('.empty .chips .btn', { hasText: /^通常$/ }).click();
    await pp.getByRole('button', { name: 'セクション', exact: true }).click();
    await pp.getByRole('button', { name: 'スタン', exact: true }).click();
    await pp.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 9 データの初回保存成功時にpersist()を1回だけ呼ぶ`, async () => assert.equal(await pp.evaluate(() => window.__persist), 1));
    await ctx.close();
  }

  // 10. シートの履歴ゴースト（L1）
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu');
    await page.getByRole('button', { name: '通常のメニュー' }).click();
    await page.waitForSelector('.sheet');
    await page.goBack();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.goForward();
    await page.waitForTimeout(300);
    await check(`${tag} 10 進む操作で開いていないシートの履歴に戻っても、シートは出ず画面も移らない`, async () => {
      assert.equal(await page.locator('.sheet').count(), 0);
      assert.equal(await hash(page), '#/c/ryu');
      assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
      assert.equal(await page.evaluate(() => !!history.state?.sheet), false);
    });
    await page.getByRole('button', { name: '通常のメニュー' }).click();
    await page.waitForSelector('.sheet');
    await page.getByRole('button', { name: '閉じる' }).click();
    await check(`${tag} 10 同じシートを開き直して［閉じる］で閉じ、inertも解除される`, async () => {
      await page.waitForSelector('.sheet', { state: 'detached' });
      assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
      assert.equal(await hash(page), '#/c/ryu');
      assert.equal(await page.evaluate(() => !!history.state?.sheet), false);
    });
    await check(`${tag} 10 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 11. トーストの一時停止（時間がかかるので360幅のみ。FAST=1 で省く）
  if (width === 360 && !process.env.FAST) {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu');
    const del = async (name) => {
      await page.getByRole('button', { name: `${name}のメニュー` }).click();
      await page.getByRole('button', { name: '削除' }).click();
      await page.waitForSelector('#toast .toast');
    };
    const state = () => page.locator('#toast .toast').count();
    await del('起き攻め');
    await page.hover('#toast .toast');
    await page.waitForTimeout(6600);
    await check(`${tag} 11 マウスのホバー中は6秒を超えてもトーストが残る`, async () => assert.equal(await state(), 1));
    await page.mouse.move(5, 300);
    await page.waitForTimeout(6600);
    await check(`${tag} 11 ホバーを外すと残り時間で消える`, async () => assert.equal(await state(), 0));
    await page.getByRole('button', { name: '画面端のメニュー' }).click(); // 記録ありなので移動先シートが出る
    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('radio', { name: /通常/ }).check();
    await page.getByRole('button', { name: '移動して削除' }).click();
    await page.waitForSelector('#toast .toast');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // キーボードで［元に戻す］へ（focus-visible）
    await page.waitForTimeout(6600);
    await check(`${tag} 11 キーボードフォーカス中は6秒を超えてもトーストが残る`, async () => {
      assert.match(await page.evaluate(() => document.activeElement.className), /toast-act/);
      assert.equal(await state(), 1);
    });
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(6600);
    await check(`${tag} 11 フォーカスを外すと消える`, async () => assert.equal(await state(), 0));
    await page.context().close();
  }

  // 12. 編集画面・パッド（T-010）
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu/new?s=s1');
    const chips = () => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label').split('、')[0])); // コマンド部分だけを見る（技名は24章。読み上げ名は「コマンド、技名」の順）
    const aria = (name) => page.getByRole('button', { name, exact: true });
    const radio = (name) => page.getByRole('radio', { name, exact: true });
    let clicks = 0;
    const tap = async (loc) => { clicks++; await loc.click(); };
    const checked = (name) => radio(name).getAttribute('aria-checked');
    const rowDom = () => page.$eval('.cmd .row', normRow);

    await check(`${tag} 12 空の編集画面: 案内文・下書き表示なし・セクション選択済み・パッドは下部`, async () => {
      assert.equal(await page.locator('.cmd-hint').innerText(), '下のパッドで技を入力');
      assert.equal(await page.locator('.draft-time').innerText(), '');
      assert.equal(await page.locator('.recent-keys .key').count(), 5);
      assert.equal(await page.locator('#f-sec').evaluate((e) => e.selectedOptions[0].textContent), '通常');
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).evaluate((e) => e.classList.contains('primary')), true);
    });
    await shot(page, '20-edit-empty', width);

    // 受け入れ基準7.3-1: 検算用の例を、実際のキーのクリック9回で入力する
    await tap(radio('しゃがみ'));
    await check(`${tag} 12 姿勢↓を押すと選択枠（aria-checked）とペンディング表示が出る`, async () => {
      assert.equal(await checked('しゃがみ'), 'true');
      assert.equal(await page.locator('.cmd .pending').count(), 1);
      assert.equal(await page.locator('.cmd .pending .ghost').count(), 1);
    });
    await shot(page, '21-edit-pending', width);
    await tap(aria('中K'));
    await tap(aria('波動 236'));
    await check(`${tag} 12 ↓のあとモーションを選ぶと、姿勢の選択枠は立ちへ移る（確定する技に↓は入らない）`, async () => {
      assert.equal(await checked('しゃがみ'), 'false');
      assert.equal(await checked('立ち'), 'true');
      assert.equal(await aria('波動 236').getAttribute('aria-pressed'), 'true');
    });
    await shot(page, '22-edit-pending-motion', width);
    await tap(aria('強P'));
    await tap(aria('キャンセルドライブラッシュ'));
    await tap(radio('しゃがみ'));
    await tap(aria('中K'));
    await tap(aria('波動 236'));
    await tap(aria('強P'));
    await check(`${tag} 12 受け入れ基準7.3-1: 検算用の例を9タップで入力でき、列のaria-labelが期待どおり`, async () => {
      assert.ok(clicks <= 9, `クリック ${clicks} 回`);
      assert.equal(clicks, 9);
      assert.deepEqual(await chips(), ['屈中K', '波動 ↓↘→ 強P', 'CDR', '屈中K', '波動 ↓↘→ 強P']);
      assert.equal(await page.locator('.cmd .cmd-hint').count(), 0);
      await page.waitForFunction(() => document.getElementById('live').textContent === '追加: 波動 ↓↘→ 強P、強波動拳');
    });
    await shot(page, '23-edit-typed', width);
    const typedDom = await rowDom();
    await check(`${tag} 12 下書きに入力のたびに保存され、「下書き保存済み HH:MM」が出る`, async () => {
      const d = JSON.parse(await storedRaw(page, 'sf6memo.drafts'));
      assert.deepEqual(Object.keys(d), ['new:s1']);
      assert.equal(d['new:s1'].tokens.length, 5);
      assert.match(await page.locator('.draft-time').innerText(), /^下書き保存済み \d\d:\d\d$/);
    });

    // 受け入れ基準7.3-2: 保存 -> 再読み込み -> 詳細のコマンド列が、入力直後の編集画面のコマンド列と同じDOM
    await page.getByLabel('タイトル（任意）').fill('検算コンボ');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => /^#\/c\/ryu\/r\/[0-9a-f]{32}$/.test(location.hash));
    const savedId = (await hash(page)).split('/').pop();
    await check(`${tag} 12 保存成功: 詳細へ置き換えで移り、トースト「保存しました」、下書きは消え、日時が入る`, async () => {
      assert.match(await page.locator('#toast').innerText(), /保存しました/);
      assert.equal(await page.locator('.d-title').innerText(), '検算コンボ');
      const d = await stored(page);
      const c = d.combos.find((x) => x.id === savedId);
      assert.deepEqual([c.sectionId, c.characterId, c.controlType, c.favorite, c.tokens.length], ['s1', 'ryu', 'classic', false, 5]);
      assert.ok(c.createdAt > T0 && c.createdAt === c.updatedAt);
      assert.deepEqual(JSON.parse(await storedRaw(page, 'sf6memo.drafts')), {});
    });
    await check(`${tag} 12 保存後に戻ると、編集画面ではなく一覧へ着く（置き換え）`, async () => {
      await page.goBack();
      assert.ok(['', '#/'].includes(await hash(page)), await hash(page)); // 最初に開いたキャラクター選択
    });
    await page.goForward();
    await page.reload();
    await check(`${tag} 12 受け入れ基準7.3-2: 再読み込み後の詳細のコマンド列DOMが、入力直後の編集画面と同じ`, async () => {
      await page.waitForSelector('.d-cmd .row');
      const after = await page.$eval('.d-cmd .row', normRow);
      assert.ok(typedDom.length > 500);
      assert.equal(after, typedDom);
    });
    await shot(page, '24-detail', width);
    await check(`${tag} 12 詳細に input・textarea・contenteditable がない`, async () => {
      assert.equal(await page.locator('input, textarea, select, [contenteditable]').count(), 0);
    });
    await check(`${tag} 12 トースト「保存しました」は2.5秒で消える`, async () => {
      await page.waitForFunction(() => document.querySelector('#toast .toast') === null, null, { timeout: 4000 }).catch(() => {});
      assert.equal(await page.locator('#toast .toast').count(), 0);
    });
    await check(`${tag} 12 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 13. 編集: 下書き・保存失敗・1回限りの姿勢・OD・取り消し・方向キー・直近の技・ポップオーバー
  {
    const page = await newPage(width, seedState());
    const chips = () => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label').split('、')[0])); // コマンド部分だけを見る（技名は24章。読み上げ名は「コマンド、技名」の順）
    const aria = (name) => page.getByRole('button', { name, exact: true });
    const radio = (name) => page.getByRole('radio', { name, exact: true });
    const toastText = () => page.locator('#toast').innerText();

    // 下書き: 保存せずに離れて戻ると復元される
    await gotoHash(page, '#/c/ryu/new?s=s1');
    await check(`${tag} 13 直近の技: 最新順・重複なし・注記なし`, async () => {
      assert.deepEqual(await page.$$eval('.recent-keys .key', (els) => els.map((e) => e.getAttribute('aria-label'))),
        ['SA3を追加', '昇龍 →↓↘ 中P、中昇龍拳を追加', '波動 ↓↘→ 強P、強波動拳を追加', '屈中Kを追加', 'CDRを追加']);
    });
    await aria('中P').click();
    await aria('波動 236').click();
    await aria('強P').click();
    await page.getByLabel('タイトル（任意）').fill('途中のメモ');
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 13 保存せずに離れるとトースト「下書きを残しました」`, async () => assert.match(await toastText(), /下書きを残しました/));
    await gotoHash(page, '#/c/ryu/new?s=s1');
    await check(`${tag} 13 戻ると下書きが復元され、上部にお知らせが出る`, async () => {
      assert.match(await page.locator('.notice').innerText(), /前回の下書きを開きました/);
      assert.deepEqual(await chips(), ['立ち中P', '波動 ↓↘→ 強P']);
      assert.equal(await page.getByLabel('タイトル（任意）').inputValue(), '途中のメモ');
      assert.match(await page.locator('.draft-time').innerText(), /下書き保存済み/);
    });
    await shot(page, '25-draft-restored', width);
    await page.reload();
    await check(`${tag} 13 再読み込みでも下書きが復元される`, async () => {
      assert.deepEqual(await chips(), ['立ち中P', '波動 ↓↘→ 強P']);
      assert.equal(await page.locator('.notice').count(), 1);
    });
    await page.getByRole('button', { name: '破棄して新規' }).click();
    await check(`${tag} 13 ［破棄して新規］で下書きが消え、空の画面になる`, async () => {
      assert.equal(await page.locator('.notice').count(), 0);
      assert.deepEqual(await chips(), []);
      assert.equal(await page.getByLabel('タイトル（任意）').inputValue(), '');
      assert.deepEqual(JSON.parse(await storedRaw(page, 'sf6memo.drafts')), {});
    });
    await aria('強P').click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => /\/r\//.test(location.hash));
    await check(`${tag} 13 保存すると下書きは残らない（保存して離れたときのトーストも出ない）`, async () => {
      assert.deepEqual(JSON.parse(await storedRaw(page, 'sf6memo.drafts')), {});
      assert.doesNotMatch(await toastText(), /下書きを残しました/);
    });

    // 保存失敗: 画面は移らず、その場にエラー。入力内容は残る。直すと保存できる
    await gotoHash(page, '#/c/ryu/new?s=s2');
    await aria('中K').click();
    await page.getByLabel('タイトル（任意）').fill('失敗するメモ');
    await page.locator('.cmd').click({ position: { x: 5, y: 5 } }); // パッドを戻す
    await page.evaluate(() => {
      window.__origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    });
    const dataBefore = await storedRaw(page);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await check(`${tag} 13 保存失敗: エラー表示が出て画面は移らず、入力内容は残る`, async () => {
      await page.waitForSelector('.err');
      assert.match(await page.locator('.err').innerText(), /保存できませんでした[\s\S]*保存領域がいっぱいです。入力内容はこの画面に残っています。/);
      assert.equal(await hash(page), '#/c/ryu/new?s=s2');
      assert.deepEqual(await chips(), ['立ち中K']);
      assert.equal(await page.getByLabel('タイトル（任意）').inputValue(), '失敗するメモ');
      assert.equal(await storedRaw(page), dataBefore);
      assert.equal(await page.locator('.err[role=alert]').count(), 1);
    });
    await shot(page, '26-edit-save-error', width);
    await check(`${tag} 13 下書きの保存失敗も同じ表示（エラーが出続ける）`, async () => {
      await aria('強K').click();
      assert.equal(await page.locator('.err').count(), 1);
      assert.deepEqual(await chips(), ['立ち中K', '立ち強K']);
    });
    await page.evaluate(() => { Storage.prototype.setItem = window.__origSet; });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await check(`${tag} 13 原因を直して再度保存すると保存できる`, async () => {
      await page.waitForFunction(() => /\/r\//.test(location.hash));
      assert.equal((await stored(page)).combos.length, 5);
    });

    // 姿勢の1回限り・OD・取り消し・方向キー
    await gotoHash(page, '#/c/ryu/new?s=s1');
    await radio('しゃがみ').click();
    await aria('中K').click();
    await aria('中K').click();
    await check(`${tag} 13 姿勢は1回限り: ↓→中K→（自動で立ち）→中K`, async () => {
      assert.deepEqual(await chips(), ['屈中K', '立ち中K']);
      assert.equal(await radio('立ち').getAttribute('aria-checked'), 'true');
    });
    await radio('ジャンプ').click();
    await radio('ジャンプ').click();
    await check(`${tag} 13 同じ姿勢をもう一度押すと解除される`, async () => assert.equal(await radio('立ち').getAttribute('aria-checked'), 'true'));
    await aria('OD P').click();
    await check(`${tag} 13 OD-Pでモーションがなければ追加せず、トースト「先にモーションを選んでください」`, async () => {
      assert.deepEqual(await chips(), ['屈中K', '立ち中K']);
      assert.match(await toastText(), /先にモーションを選んでください/);
    });
    await shot(page, '27-edit-od-toast', width);
    await aria('昇龍 623').click();
    await aria('OD P').click();
    await check(`${tag} 13 モーション＋OD-PでOD必殺技が確定する`, async () => assert.equal((await chips()).at(-1), 'OD 昇龍 →↓↘ P'));
    await aria('直前の入力を取り消す').click();
    await check(`${tag} 13 消す: 直前のトークンを削除する`, async () => assert.deepEqual(await chips(), ['屈中K', '立ち中K']));
    await radio('しゃがみ').click();
    await aria('直前の入力を取り消す').click();
    await check(`${tag} 13 消す: ペンディングがあればペンディングだけを戻す`, async () => {
      assert.deepEqual(await chips(), ['屈中K', '立ち中K']);
      assert.equal(await page.locator('.cmd .pending').count(), 0);
    });
    await aria('左').click();
    await aria('強P').click();
    await check(`${tag} 13 方向キー1つ＋ボタンで方向入れ通常技（引き強P）`, async () => assert.equal((await chips()).at(-1), '引き強P'));
    await aria('下').click();
    await aria('右下').click();
    await aria('右').click();
    await aria('強K').click();
    await check(`${tag} 13 方向キー3つ＋ボタンで必殺技（236強K）`, async () => assert.equal((await chips()).at(-1), '波動 ↓↘→ 強K'));
    await aria('下').click();
    await aria('強K').click();
    await check(`${tag} 13 ↓の方向キー＋ボタンはしゃがみ通常技`, async () => assert.equal((await chips()).at(-1), '屈強K'));
    await aria('カウンターヒット').click();
    await check(`${tag} 13 注記CHがタグとして付く`, async () => {
      assert.equal(await page.locator('.cmd .tag').count(), 1);
      assert.equal(await page.locator('.cmd .tag').first().innerText(), 'CH');
    });

    await aria('SA3を追加').click();
    await check(`${tag} 13 直近の技を1タップでカーソル位置に追加`, async () => assert.equal((await chips()).at(-1), 'SA3'));
    await check(`${tag} 13 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    // 直近8件の上限
    const many = seedState();
    many.combos.push(combo('c50', 's1', '多い', [1, 3, 4, 6, 7, 8, 9].flatMap((d) => [{ ...N('stand', 'L', 'P'), dir: d }, { ...N('crouch', 'H', 'K'), dir: d }])));
    const p8 = await newPage(width, many);
    await gotoHash(p8, '#/c/ryu/new?s=s1');
    await check(`${tag} 13 直近の技は最大8件`, async () => assert.equal(await p8.locator('.recent-keys .key').count(), 8));
    await p8.context().close();
    const none = await newPage(width, { sections: seedState().sections, combos: [] });
    await gotoHash(none, '#/c/ryu/new?s=s1');
    await check(`${tag} 13 直近が空のときは案内文`, async () => assert.equal(await none.locator('.recent-empty').innerText(), '入力した技がここに並びます'));
    await none.context().close();
  }

  // 14. チップのポップオーバー・挿入カーソル・戻る操作
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu/r/c1/edit');
    const chips = () => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label').split('、')[0])); // コマンド部分だけを見る（技名は24章。読み上げ名は「コマンド、技名」の順）
    const pop = page.locator('.popover');
    const opt = (name) => pop.getByRole('button', { name, exact: true });
    await check(`${tag} 14 既存の記録の編集: 保存済みのトークンが入っている`, async () => {
      assert.deepEqual(await chips(), ['屈中K', '波動 ↓↘→ 強P', 'CDR', '屈中K', '波動 ↓↘→ 強P']);
      assert.equal(await page.getByLabel('タイトル（任意）').inputValue(), '基本コンボ');
      assert.equal(await page.locator('.tag-list .pill').count(), 1);
    });
    await page.locator('.cmd .chip').nth(1).click();
    await pop.waitFor();
    await check(`${tag} 14 ポップオーバー: 対応行・強度の行（OD付き）・挿入・削除、選択中チップに枠`, async () => {
      assert.equal(await pop.locator('.pop-name').innerText(), '強波動拳'); // 技名はポップオーバーに常に出る（24章）
      assert.match(await pop.locator('.pop-note').last().innerText(), /＝ 236（波動）/);
      assert.deepEqual(await pop.locator('.pop-row').first().locator('button').allInnerTexts(), ['弱', '中', '強', '', 'OD']); // 空は灰色の●（強度なし。文字なし）
      assert.equal(await opt('強').getAttribute('aria-pressed'), 'true');
      assert.equal(await opt('この前に挿入').isVisible(), true);
      assert.equal(await opt('削除').isVisible(), true);
      assert.equal(await page.locator('.cmd .chip.sel').count(), 1);
      const b = await pop.boundingBox();
      assert.ok(b.width <= 320 && b.x >= 0 && b.x + b.width <= width, JSON.stringify(b));
      const c = await page.locator('.cmd .chip.sel').boundingBox();
      assert.ok(b.y + b.height <= c.y + 1 || b.y >= c.y + c.height - 1, '近接し、チップに重ならない');
      assert.equal(await page.evaluate(() => document.getElementById('app').inert), true);
    });
    await shot(page, '28-edit-popover', width);
    await page.keyboard.press('Escape');
    await check(`${tag} 14 Escで閉じる（選択枠も外れる・画面は移らない）`, async () => {
      await pop.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.cmd .chip.sel').count(), 0);
      assert.equal(await hash(page), '#/c/ryu/r/c1/edit');
      assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
    });
    await page.locator('.cmd .chip').nth(1).click();
    await pop.waitFor();
    await page.goBack();
    await check(`${tag} 14 戻る操作で閉じる（画面は移らない）`, async () => {
      await pop.waitFor({ state: 'detached' });
      assert.equal(await hash(page), '#/c/ryu/r/c1/edit');
    });
    await page.locator('.cmd .chip').nth(1).click();
    await pop.waitFor();
    await page.mouse.click(width - 4, 200); // 外側のタップ
    await check(`${tag} 14 外側のタップで閉じる`, async () => {
      await pop.waitFor({ state: 'detached' });
      assert.equal(await hash(page), '#/c/ryu/r/c1/edit');
    });
    // 強度変更
    await page.locator('.cmd .chip').nth(1).click();
    await opt('中').click();
    await check(`${tag} 14 強度変更: 該当トークンだけが置き換わる`, async () => {
      await pop.waitFor({ state: 'detached' });
      assert.deepEqual(await chips(), ['屈中K', '波動 ↓↘→ 中P', 'CDR', '屈中K', '波動 ↓↘→ 強P']);
    });
    await page.locator('.cmd .chip').nth(1).click();
    await opt('OD').click();
    await check(`${tag} 14 必殺技の［OD］への変更`, async () => assert.equal((await chips())[1], 'OD 波動 ↓↘→ P'));
    await page.locator('.cmd .chip').nth(2).click(); // CDR は強度なし
    await check(`${tag} 14 システム技のポップオーバーに強度の行はない`, async () => {
      assert.equal(await pop.locator('.pop-row').count(), 1);
      assert.deepEqual(await pop.locator('.pop-note').allInnerTexts(), ['キャンセルドライブラッシュ（CDR）']); // 正式名称（モーションの対応表示ではない）
    });
    await page.keyboard.press('Escape');
    // 前に挿入
    await page.locator('.cmd .chip').nth(2).click();
    await opt('この前に挿入').click();
    await check(`${tag} 14 ［この前に挿入］でカーソルがそのチップの前に移り、末尾以外なら［末尾へ］が出る`, async () => {
      await pop.waitFor({ state: 'detached' });
      const order = await page.$$eval('.cmd .row [data-i], .cmd .cursor', (els) => els.map((e) => (e.classList.contains('cursor') ? '|' : e.getAttribute('aria-label'))));
      assert.equal(order.indexOf('|'), 2, order.join());
      assert.equal(await page.getByRole('button', { name: '末尾へ' }).count(), 1);
      assert.ok((await page.getByRole('button', { name: '末尾へ' }).boundingBox()).height >= 44);
    });
    await shot(page, '29-edit-cursor-middle', width);
    await page.getByRole('button', { name: '強K', exact: true }).click();
    await check(`${tag} 14 カーソル位置への挿入（立ち強K がCDRの前に入る）`, async () => {
      assert.deepEqual(await chips(), ['屈中K', 'OD 波動 ↓↘→ P', '立ち強K', 'CDR', '屈中K', '波動 ↓↘→ 強P']);
    });
    await page.getByRole('button', { name: '末尾へ' }).click();
    await check(`${tag} 14 ［末尾へ］でカーソルが末尾に戻り、ボタンは消える`, async () => assert.equal(await page.getByRole('button', { name: '末尾へ' }).count(), 0));
    // 削除と取り消し
    const before = await chips();
    await page.locator('.cmd .chip').nth(2).click();
    await opt('削除').click();
    await check(`${tag} 14 ［削除］は即時に実行され、取り消しトーストが出る`, async () => {
      await pop.waitFor({ state: 'detached' });
      assert.equal((await chips()).length, before.length - 1);
      assert.match(await page.locator('#toast').innerText(), /「立ち強K」を削除しました/);
    });
    await page.getByRole('button', { name: '元に戻す' }).click();
    await check(`${tag} 14 取り消しで元の列に戻る`, async () => assert.deepEqual(await chips(), before));
    // SAと注記
    await page.getByRole('button', { name: 'スーパーアーツ3', exact: true }).click();
    await page.locator('.cmd .chip').last().click();
    await check(`${tag} 14 SAのポップオーバーは［SA1］［SA2］［SA3］`, async () => {
      assert.deepEqual(await pop.locator('.pop-row').first().locator('button').allInnerTexts(), ['SA1', 'SA2', 'SA3']);
    });
    await opt('SA1').click();
    await check(`${tag} 14 SAの変更`, async () => assert.equal((await chips()).at(-1), 'SA1'));
    // セクション・位置・タグ
    await page.getByLabel('セクション').selectOption('s2');
    await page.getByRole('radio', { name: '画面端' }).check();
    await check(`${tag} 14 タグの候補: 使用済みタグだけ（「画面端限定」などを既定で出さない）。入力済みは候補から消える`, async () => {
      assert.deepEqual(await page.locator('.suggest .pill').allInnerTexts(), []); // 使用済みの「基本」は入力済み
    });
    await page.getByLabel('タグ', { exact: true }).fill('練習用');
    await page.keyboard.press('Enter');
    await page.getByLabel('メモ').fill('ここで\n改行');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => location.hash === '#/c/ryu/r/c1');
    await check(`${tag} 14 編集の保存: updatedAtのみ更新し、セクション・位置・タグ・メモが反映される`, async () => {
      const c = (await stored(page)).combos.find((x) => x.id === 'c1');
      assert.equal(c.createdAt, T0 - 999);
      assert.ok(c.updatedAt > T0);
      assert.deepEqual([c.sectionId, c.position, c.tags, c.memo, c.title], ['s2', 'corner', ['基本', '練習用'], 'ここで\n改行', '基本コンボ']);
      assert.equal(c.tokens.length, 7);
      assert.match(await page.locator('.d-meta').innerText(), /画面端・画面端・基本 練習用/);
      assert.equal(await page.locator('.d-memo p').innerText(), 'ここで\n改行');
    });
    await check(`${tag} 14 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    // 別キャラの使用済みタグも候補に出る
    const t2 = seedState();
    t2.sections.push(sec('k1', 'ken', '通常', 0));
    t2.combos.push({ ...combo('c20', 'k1', '', [N('stand', 'L', 'P')], { tags: ['他キャラ限定', '基本'] }), characterId: 'ken' });
    const tp = await newPage(width, t2);
    await gotoHash(tp, '#/c/ryu/new?s=s1');
    await check(`${tag} 14 タグの候補: そのキャラの使用済み、続けて全体の使用済み（入力で絞り込み）`, async () => {
      assert.deepEqual(await tp.locator('.suggest .pill').allInnerTexts(), ['基本', '他キャラ限定']);
      await tp.getByLabel('タグ', { exact: true }).fill('他');
      assert.deepEqual(await tp.locator('.suggest .pill').allInnerTexts(), ['他キャラ限定']);
      await tp.locator('.suggest .pill').first().click();
      assert.deepEqual(await tp.locator('.tag-list .pill').allInnerTexts(), ['他キャラ限定']);
      assert.equal(await tp.locator('.suggest .pill').count(), 1); // 追加済みは候補から消え、残りは基本
    });
    await tp.context().close();
  }

  // 15. 寸法・チップ追加の遅延・パッドの出し入れ・不正なURL・XSS
  {
    const page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu/new?s=s1');
    await check(`${tag} 15 パッドの上端は y>=326、高さは414、横スクロールなし`, async () => {
      const b = await page.locator('.pad').boundingBox();
      assert.ok(b.y >= 326, JSON.stringify(b));
      assert.equal(b.height, 414);
      assert.ok(await noHScroll(page));
      assert.equal(await page.evaluate(() => { const p = document.querySelector('.pad'); return p.scrollWidth <= p.clientWidth; }), true);
      assert.equal(await page.evaluate(() => document.querySelector('.screen.edit').scrollHeight <= innerHeight), true); // 画面自体はスクロールしない
    });
    await check(`${tag} 15 パッドのキーの最小タップ領域は幅・高さとも44以上`, async () => {
      const sizes = await page.$$eval('.pad button', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), r.width, r.height]; }));
      assert.ok(sizes.length >= 40, `キー ${sizes.length}`);
      const small = sizes.filter(([, w, h]) => w < 44 || h < 44);
      assert.deepEqual(small, []);
    });
    await check(`${tag} 15 システム行: 6個は常に見え、7個目はのぞいて横スクロールできる（360幅）`, async () => {
      const r = await page.$$eval('.sys-keys .key', (els) => els.map((e) => { const b = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), b.left, b.right]; }));
      const padRight = await page.evaluate(() => document.querySelector('.sys-keys').getBoundingClientRect().right);
      assert.deepEqual(r.map((x) => x[0]).slice(0, 6), ['キャンセルドライブラッシュ', 'パリィドライブラッシュ', 'ドライブインパクト', 'スーパーアーツ1', 'スーパーアーツ2', 'スーパーアーツ3']);
      assert.ok(r[5][2] <= padRight, '6個目まで見える');
      if (width === 360) assert.ok(r[6][1] < padRight - 10 && r[6][2] > padRight, `DPがのぞく ${r[6]}`);
      assert.equal(await page.$eval('.sys-keys', (e) => e.scrollWidth > e.clientWidth), true);
    });
    await check(`${tag} 15 パッドのキーは button、姿勢は radiogroup`, async () => {
      assert.equal(await page.locator('.pad .key:not(button)').count(), 0);
      assert.equal(await page.locator('.pad [role=radiogroup] [role=radio]').count(), 3);
      assert.equal(await page.locator('.pad [role=radiogroup]').getAttribute('aria-label'), '姿勢');
      assert.deepEqual(await page.locator('.preset-grid .key').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        ['波動 236', '竜巻 214', '昇龍 623', '下下 22', '63214', '溜め横 [4]6', '溜め縦 [2]8', '一回転 360']);
    });
    // 遅延: クリックからコマンド列にチップが現れるまで（headlessなので目安）
    await page.evaluate(() => {
      window.__lat = [];
      let t0;
      document.addEventListener('click', () => { t0 = performance.now(); }, true);
      new MutationObserver(() => {
        if (t0 === undefined) return;
        const t = t0;
        t0 = undefined;
        requestAnimationFrame(() => window.__lat.push(performance.now() - t));
      }).observe(document.querySelector('.cmd'), { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: '弱P', exact: true }).click();
    await check(`${tag} 15 チップのタップ領域は44px四方（見た目34pxに透明の領域を足す。1行のとき）`, async () => {
      const r = await page.evaluate(() => {
        const c = document.querySelector('.cmd .chip');
        const b = c.getBoundingClientRect();
        const hit = (x, y) => document.elementFromPoint(x, y)?.closest('button') === c;
        return { h: b.height, w: b.width, up: hit(b.left + b.width / 2, b.top - 4), down: hit(b.left + b.width / 2, b.bottom + 4), left: hit(b.left - 4, b.top + b.height / 2), right: hit(b.right + 4, b.top + b.height / 2) };
      });
      assert.ok(r.up && r.down && r.left && r.right && r.h >= 34, JSON.stringify(r));
    });
    for (let i = 1; i < 6; i++) await page.getByRole('button', { name: i % 2 ? '中K' : '弱P', exact: true }).click();
    await check(`${tag} 15 チップ追加の体感遅延: クリックから次のフレームまで100ms以内（目安）`, async () => {
      await page.waitForFunction(() => window.__lat.length >= 6);
      const lat = await page.evaluate(() => window.__lat);
      console.log(`  [${width}] チップ追加の遅延(ms): ${lat.map((x) => x.toFixed(1)).join(', ')}`);
      assert.ok(Math.max(...lat) <= 100, JSON.stringify(lat));
    });
    // パッドの出し入れ
    await page.getByLabel('タイトル（任意）').click();
    await check(`${tag} 15 タイトル入力にフォーカスするとパッドが隠れる（hidden）`, async () => {
      assert.equal(await page.locator('.pad').evaluate((e) => e.hidden), true);
      assert.equal(await page.locator('.pad').isVisible(), false);
    });
    await shot(page, '30-edit-pad-hidden', width);
    await page.locator('.cmd').click({ position: { x: 5, y: 5 } });
    await check(`${tag} 15 コマンド列の領域をタップするとパッドが戻る`, async () => assert.equal(await page.locator('.pad').isVisible(), true));
    for (const [label, sel] of [['メモ', '#f-memo'], ['タグ', '#f-tag']]) {
      await page.locator(sel).click();
      await check(`${tag} 15 ${label}にフォーカスしてもパッドが隠れる`, async () => assert.equal(await page.locator('.pad').isVisible(), false));
      await page.locator('.cmd').click({ position: { x: 5, y: 5 } });
    }
    await check(`${tag} 15 コマンド列は input でも contenteditable でもない・入力欄の上限が設定されている`, async () => {
      assert.equal(await page.locator('.cmd input, .cmd textarea, .cmd [contenteditable]').count(), 0);
      assert.deepEqual(await page.$$eval('#f-title, #f-memo, #f-tag', (els) => els.map((e) => e.getAttribute('maxlength'))), ['100', '30', '2000']);
    });
    await check(`${tag} 15 横持ち相当（高さ500）ではパッドが縦flexから外れ、コマンド列の下に流れる`, async () => {
      await page.setViewportSize({ width, height: 500 });
      await page.locator('.cmd').click({ position: { x: 5, y: 5 } });
      const r = await page.evaluate(() => {
        const c = document.querySelector('.cmd').getBoundingClientRect();
        const p = document.querySelector('.pad');
        const f = document.querySelector('.fields').getBoundingClientRect();
        return { cmdBottom: c.bottom, padTop: p.getBoundingClientRect().top + scrollY, padPos: getComputedStyle(p).position, fieldsTop: f.top + scrollY };
      });
      assert.equal(r.padPos, 'static');
      assert.ok(Math.abs(r.padTop - (r.cmdBottom + await page.evaluate(() => scrollY))) < 2, JSON.stringify(r));
      assert.ok(r.fieldsTop >= r.padTop + 414 - 1, JSON.stringify(r));
      await page.setViewportSize({ width, height: 740 });
    });
    await check(`${tag} 15 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    // 不正なURLは安全な画面へ
    const bad = await newPage(width, seedState());
    for (const [h, want] of [['#/c/ryu/r/nope', '#/c/ryu'], ['#/c/ryu/r/nope/edit', '#/c/ryu'], ['#/c/nobody/r/c1', '#/'], ['#/c/nobody/r/c1/edit', '#/'], ['#/c/ken/r/c1', '#/c/ken'], ['#/c/ken/new?s=s1', '#/c/ken'], ['#/c/ryu/r/__proto__/edit', '#/c/ryu']]) {
      await gotoHash(bad, h);
      await check(`${tag} 15 不正なURL ${h} -> ${want}`, async () => {
        assert.equal(await hash(bad), want);
        assert.equal(await bad.locator('.topbar h1').count(), 1);
      });
    }
    await check(`${tag} 15 ページエラーなし（不正URL）`, async () => assert.deepEqual(bad.errors, []));
    await bad.context().close();

    // XSS: タイトル・タグ・メモ・セクション名に入れたHTMLは発火せず、文字として出る
    const xss = await newPage(width, seedState());
    await gotoHash(xss, '#/c/ryu/new?s=s1');
    const evil = '<img src=x onerror="window.__xss=1">';
    await xss.getByLabel('タイトル（任意）').fill(evil);
    await xss.getByLabel('タグ', { exact: true }).fill(evil);
    await xss.keyboard.press('Enter');
    await xss.getByLabel('メモ').fill(`<script>window.__xss=2</script>${evil}`);
    await xss.getByRole('button', { name: '保存', exact: true }).click();
    await xss.waitForFunction(() => /\/r\//.test(location.hash));
    await check(`${tag} 15 XSS: 詳細・編集・一覧でHTMLは発火せず、文字として表示される`, async () => {
      assert.equal(await xss.locator('.d-title').innerText(), evil);
      assert.match(await xss.locator('.d-meta').innerText(), /<img src=x/);
      assert.equal(await xss.locator('img').count(), 0);
      await xss.locator('.bottombar .primary').click();
      await xss.waitForSelector('.fields');
      assert.equal(await xss.getByLabel('タイトル（任意）').inputValue(), evil);
      assert.equal(await xss.locator('img').count(), 0);
      await gotoHash(xss, '#/c/ryu');
      assert.equal(await xss.locator('.item-title', { hasText: '<img' }).count(), 1);
      assert.equal(await xss.locator('img').count(), 0);
      await xss.waitForTimeout(300);
      assert.equal(await xss.evaluate(() => window.__xss), undefined);
    });
    await check(`${tag} 15 ページエラーなし（XSS）`, async () => assert.deepEqual(xss.errors, []));
    await xss.context().close();
  }

  // 16. 詳細・複製・削除と取り消し・凡例（T-011）
  {
    let page = await newPage(width, seedState());
    await gotoHash(page, '#/c/ryu');
    await page.locator('.item', { hasText: '基本コンボ' }).click();
    await page.waitForSelector('.d-cmd .row');
    await page.waitForTimeout(300); // 画面遷移の動き（160ms）が終わるまで
    const base = await stored(page);
    await check(`${tag} 16 詳細の構成: 上部バー（戻る・キャラ/セクション・凡例）、セクション・位置・タグ、タイトル、コマンド列、下部バー`, async () => {
      assert.equal(await page.locator('.topbar h1').innerText(), 'リュウ/通常');
      assert.equal(await page.locator('.d-meta').innerText(), '通常・どこでも・基本');
      assert.equal(await page.locator('.d-title').innerText(), '基本コンボ');
      assert.deepEqual(await page.locator('.bottombar .btn').allInnerTexts(), ['その他…', '複製', '編集']);
      assert.equal(await page.locator('.bottombar .primary').innerText(), '編集');
      assert.equal(await page.locator('button[aria-label="凡例を開く"]').count(), 1);
      assert.equal(await page.getByRole('button', { name: '凡例', exact: true }).count(), 0); // 文字の［凡例］はない（ヘルプマークに置き換え）
      assert.equal(await page.getByRole('button', { name: 'リュウの一覧に戻る' }).count(), 1);
      assert.ok(await noHScroll(page));
      const chipH = await page.$$eval('.d-cmd .chip', (els) => Math.max(...els.map((e) => e.getBoundingClientRect().height)));
      assert.ok(chipH >= 34, `コマンド列はL（${chipH}）`);
    });
    await page.locator('.d-cmd .chip').nth(1).click();
    await check(`${tag} 16 モーションを含むチップのポップオーバー「↓↘→ ＝ 236（波動）」（編集の操作は出ない）`, async () => {
      assert.match(await page.locator('.popover').innerText(), /＝ 236（波動）/);
      assert.equal(await page.locator('.popover button').count(), 0);
      assert.equal(await page.locator('input, textarea, [contenteditable]').count(), 0);
    });
    await shot(page, '31-detail-popover', width);
    await page.keyboard.press('Escape');
    await page.locator('button[aria-label="凡例を開く"]').click();
    await page.waitForSelector('.sheet.tall');
    await check(`${tag} 16 凡例: 高さ90dvhのボトムシート、下端に固定の［閉じる］、全グループがある`, async () => {
      await page.waitForTimeout(300);
      const b = await page.locator('.sheet.tall').boundingBox();
      assert.ok(Math.abs(b.height - 740 * 0.9) < 2 && Math.abs(b.y + b.height - 740) < 2, JSON.stringify(b));
      const close = await page.getByRole('button', { name: '閉じる' }).boundingBox();
      assert.ok(close.y + close.height <= 740 && close.y > 740 * 0.8, JSON.stringify(close));
      const t = await page.locator('.sheet.tall').innerText();
      for (const w of ['ボタン', '姿勢', '方向', 'モーションのプリセットと通称', 'OD', 'システム技・SA', '注記', 'つなぎ', 'キャンセルドライブラッシュ', 'パニッシュカウンター', '波動', '一回転', '書き出し時の表記']) assert.ok(t.includes(w), w);
      assert.equal(await page.locator('.sheet.tall .leg .chip').count() > 10, true);
      assert.equal(await page.locator('.sheet.tall input, .sheet.tall textarea, .sheet.tall [contenteditable]').count(), 0);
      assert.equal(await page.locator('.sheet.tall .diag-c').count(), 9);
      assert.ok(await noHScroll(page));
    });
    await shot(page, '32-legend', width);
    await page.locator('.sheet-body').evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await shot(page, '33-legend-bottom', width);
    await page.goBack();
    await check(`${tag} 16 凡例は戻る操作で閉じる（画面は移らない）`, async () => {
      await page.waitForSelector('.sheet', { state: 'detached' });
      assert.equal(await hash(page), '#/c/ryu/r/c1');
    });
    await page.locator('button[aria-label="凡例を開く"]').click();
    await page.getByRole('button', { name: '閉じる' }).click();
    await check(`${tag} 16 凡例の［閉じる］で閉じ、フォーカスは［凡例］へ戻る`, async () => {
      await page.waitForSelector('.sheet', { state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.fk), 'legend');
    });

    // 複製
    await page.getByRole('button', { name: '複製', exact: true }).click();
    await page.waitForFunction(() => location.hash !== '#/c/ryu/r/c1');
    const copyId = (await hash(page)).split('/').pop();
    await check(`${tag} 16 複製: 新しいidで同じセクションに複製し、複製の詳細へ移ってトースト「複製しました」`, async () => {
      assert.match(await page.locator('#toast').innerText(), /複製しました/);
      assert.equal(await page.locator('.d-title').innerText(), '基本コンボのコピー');
      const d = await stored(page);
      assert.equal(d.combos.length, 4);
      const o = d.combos.find((c) => c.id === 'c1');
      const c = d.combos.find((x) => x.id === copyId);
      assert.notEqual(copyId, 'c1');
      assert.deepEqual({ ...c, id: 0, title: 0, createdAt: 0, updatedAt: 0 }, { ...o, id: 0, title: 0, createdAt: 0, updatedAt: 0 });
      assert.ok(c.createdAt > T0 && c.createdAt === c.updatedAt);
      assert.deepEqual(d.combos.find((x) => x.id === 'c1'), base.combos.find((x) => x.id === 'c1')); // 元は変わらない
    });
    await check(`${tag} 16 複製の詳細から戻ると元の詳細（履歴に積まれている）`, async () => {
      await page.goBack();
      assert.equal(await hash(page), '#/c/ryu/r/c1');
    });
    await page.goForward();

    // 削除と取り消し（複製を消して、元の状態へ戻す）
    const withCopy = await stored(page);
    await page.getByRole('button', { name: 'その他…' }).click();
    await shot(page, '34-detail-more', width);
    await page.getByRole('button', { name: '削除' }).click();
    await check(`${tag} 16 削除: 一覧へ移り、トースト「「タイトル」を削除しました［元に戻す］」`, async () => {
      await page.waitForSelector('.sheet', { state: 'detached' });
      await page.waitForFunction(() => location.hash === '#/c/ryu');
      assert.match(await page.locator('#toast').innerText(), /「基本コンボのコピー」を削除しました/);
      assert.equal(await page.getByRole('button', { name: '元に戻す' }).count(), 1);
      assert.equal((await stored(page)).combos.some((c) => c.id === copyId), false);
      assert.equal(await page.locator('.item').count(), 3);
    });
    await shot(page, '35-list-after-delete', width);
    await page.getByRole('button', { name: '元に戻す' }).click();
    await check(`${tag} 16 取り消しで元の記録と同じ内容（deepEqual）に戻る`, async () => {
      assert.deepEqual(await stored(page), withCopy);
      assert.equal(await page.locator('.item').count(), 4);
    });
    await page.context().close();
    // 一覧から来た詳細の削除は、履歴を1つ戻すだけで一覧になる（一覧が二重に積まれない）
    const p2 = await newPage(width, seedState());
    await gotoHash(p2, '#/c/ryu');
    await p2.locator('.item', { hasText: '長いコンボ' }).click();
    await p2.getByRole('button', { name: 'その他…' }).click();
    await p2.getByRole('button', { name: '削除' }).click();
    await p2.waitForFunction(() => location.hash === '#/c/ryu' && !document.querySelector('.d-cmd'));
    await p2.waitForSelector('.item');
    await check(`${tag} 16 一覧から来た詳細の削除: 履歴を戻して一覧へ。さらに戻るとキャラクター選択（一覧が重複しない）`, async () => {
      assert.equal(await p2.locator('.item', { hasText: '長いコンボ' }).count(), 0);
      assert.match(await p2.locator('#toast').innerText(), /「長いコンボ」を削除しました/);
      await p2.goBack();
      assert.ok(['', '#/'].includes(await hash(p2)), await hash(p2));
    });
    await p2.goForward();
    await p2.getByRole('button', { name: '元に戻す' }).click().catch(() => {});
    await p2.context().close();
    page = await newPage(width, seedState());

    // 編集ボタン、タイトルなし・メモなしの詳細
    await gotoHash(page, '#/c/ryu/r/c3');
    await check(`${tag} 16 タイトルなし・メモなしの詳細（注記CHのタグ）と、編集へ移る主ボタン`, async () => {
      assert.equal(await page.locator('.d-title').count(), 0);
      assert.equal(await page.locator('.d-memo').count(), 0);
      assert.equal(await page.locator('.d-cmd .tag').first().innerText(), 'CH');
      await page.getByRole('link', { name: '編集' }).click();
      await page.waitForSelector('.cmd .row');
      assert.equal(await hash(page), '#/c/ryu/r/c3/edit');
      assert.equal(await page.locator('.cmd .tag').count(), 1);
      assert.equal(await page.locator('button[aria-label="凡例を開く"]').count(), 1);
      assert.equal(await page.getByRole('button', { name: '凡例', exact: true }).count(), 0);
    });
    await page.locator('button[aria-label="凡例を開く"]').click();
    await check(`${tag} 16 編集画面からも凡例を開ける`, async () => {
      await page.waitForSelector('.sheet.tall');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
    });
    await check(`${tag} 16 ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 17a. デザイン刷新v2（T-017a。design-spec-v2 9章の1・2・5・7・8・10）
  {
    // damage 付きの記録（c1=3240、c3=0、c2・c9はなし）と、全チップ種を含む c9
    const SYSALL = [{ type: 'system', id: 'CDR' }, { type: 'system', id: 'RAW_DR' }, { type: 'system', id: 'DI' }, { type: 'system', id: 'PARRY' }, { type: 'system', id: 'REVERSAL' },
      { type: 'sa', level: 1 }, SP('236', 'OD', 'P'), { type: 'note', id: 'CH' }, SP('236', 'H', 'P')];
    const dmgSeed = () => {
      const d = seedState();
      d.combos[0].damage = 3240;
      d.combos[2].damage = 0;
      d.combos.push(combo('c9', 's1', '全部入り', SYSALL));
      CHARACTERS.filter((c) => c.id !== 'ryu').slice(0, 8).forEach((c, i) => { // 点灯するキャラを9人にする（起動時の点灯は先頭6件）
        d.sections.push(sec(`o${i}`, c.id, '通常', 0));
        d.combos.push({ ...combo(`z${i + 10}`, `o${i}`, 'x', [N('stand', 'L', 'P')]), characterId: c.id });
      });
      return d;
    };
    // 発光（ぼかしのある影、または外側の影、または text-shadow）を持つ要素のclass。DPのS寸法の二重枠は 0ぼかしの inset（形そのもの）なので発光に数えない
    const noGlow = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => {
      const cs = getComputedStyle(e);
      const parts = cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((x) => x.trim());
      const glow = parts.some((x) => { const n = x.replace(/rgba?\([^)]*\)/, '').replace('inset', '').trim().split(/\s+/).map(parseFloat); return !x.includes('inset') || n[2] > 0; });
      return glow || cs.textShadow !== 'none';
    }).map((e) => e.className || e.tagName));

    // 起動時の点灯: 1回だけ、先頭6件。タップを妨げない
    const page = await newPage(width, dmgSeed());
    await check(`${tag} 17a 起動時の点灯: 点灯タイルは9、動くのは先頭6件（60msずつずれる）、480ms`, async () => {
      assert.equal(await page.locator('.cell.lit').count(), 9);
      const r = await page.$$eval('.cell.boot', (els) => els.map((e) => { const cs = getComputedStyle(e.querySelector('.cell-en')); return [e.style.getPropertyValue('--d'), cs.animationName, cs.animationDuration, cs.animationDelay]; }));
      assert.equal(r.length, 6);
      assert.deepEqual(r.map((x) => x[0]), ['0ms', '60ms', '120ms', '180ms', '240ms', '300ms']);
      assert.ok(r.every((x) => x[1] === 'flick' && x[2] === '0.48s'), JSON.stringify(r));
      assert.equal(await page.locator('.cell.lit:not(.boot)').count(), 3); // 7件目以降は即時
    });
    await check(`${tag} 17a 動いている最中でもタイルをタップできる`, async () => {
      await page.locator('.cell.lit').first().click({ timeout: 2000 });
      await page.waitForFunction(() => location.hash === '#/c/ryu');
    });
    await check(`${tag} 17a 画面に戻っても点灯は再生しない（1回だけ）`, async () => {
      await page.goBack();
      await page.waitForSelector('.grid');
      assert.equal(await page.locator('.cell.boot').count(), 0);
      assert.equal(await page.locator('.cell.lit').count(), 9);
    });
    await check(`${tag} 17a キャラ選択: 32件が下部バーの上に収まる、英字は aria-hidden、リンク名は「リュウ 4件」`, async () => {
      assert.equal(await page.locator('.cell').count(), 32);
      const bottom = await page.evaluate(() => [[...document.querySelectorAll('.cell')].at(-1).getBoundingClientRect().bottom, document.querySelector('.bottombar').getBoundingClientRect().top]);
      assert.ok(bottom[0] <= bottom[1], `最後のタイルの下端${bottom[0]} > 下部バーの上端${bottom[1]}`);
      assert.equal(await page.locator('.cell-en[aria-hidden=true]').count(), 32);
      assert.equal(await page.getByRole('link', { name: 'リュウ 4件', exact: true }).count(), 1);
      assert.equal(await page.getByRole('link', { name: 'ダルシム', exact: true }).count(), 1); // 0件は件数なし
    });
    await check(`${tag} 17a 点灯と消灯の色（リュウ4件=段階3）: 点灯は緑の板・英字lit+発光、消灯（段階0）は板surface・英字muted・発光なし`, async () => {
      const f = (sel) => page.$eval(sel, (e) => { const b = getComputedStyle(e, '::before'); const t = getComputedStyle(e.querySelector('.cell-en')); return [b.backgroundColor, t.color, t.textShadow !== 'none']; });
      assert.deepEqual(await f('.cell.lit'), ['rgb(27, 36, 35)', 'rgb(234, 255, 240)', true]);
      assert.deepEqual(await f('.cell:not(.lit)'), ['rgb(23, 25, 28)', 'rgb(170, 166, 157)', false]);
    });
    await check(`${tag} 17a タイルの押下は即時（板はline。英字の色は変わらない）、離すと戻る`, async () => {
      const t = page.locator('.cell:not(.lit)').first();
      const bb = await t.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      const down = await t.evaluate((e) => [getComputedStyle(e, '::before').backgroundColor, getComputedStyle(e.querySelector('.cell-en')).color, getComputedStyle(e.querySelector('.cell-en')).textShadow !== 'none', getComputedStyle(e, '::before').transitionDuration]);
      await page.mouse.move(0, 0); // 離す前に外へ出してタップにしない
      await page.mouse.up();
      assert.deepEqual(down, ['rgb(46, 50, 56)', 'rgb(170, 166, 157)', false, '0s']);
    });
    await check(`${tag} 17a 英字の名前がタイル内に収まる（scrollWidth <= clientWidth）`, async () => {
      const over = await page.$$eval('.cell-en', (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
      assert.deepEqual(over, []);
      await page.waitForFunction(() => document.getAnimations().length === 0); // 画面の入場アニメーション（160ms）の途中は、右へ24pxずれていて横スクロールに見える
      assert.ok(await noHScroll(page));
    });
    await check(`${tag} 17a 書体: Tilt Neon が読み込まれ、data URI の woff2 は12KB以下、OFLが同梱されている`, async () => {
      assert.equal(await page.evaluate(() => document.fonts.check('20px "Tilt Neon"')), true);
      assert.equal(await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Tilt Neon') && f.status === 'loaded')), true);
      assert.match(await page.$eval('.cell-en', (e) => getComputedStyle(e).fontFamily), /Tilt Neon/);
      const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');
      const m = css.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/);
      assert.ok(m && Buffer.from(m[1], 'base64').length <= 12 * 1024, 'woff2 > 12KB');
      assert.match(readFileSync(new URL('../app/OFL-TiltNeon.txt', import.meta.url), 'utf8'), /Copyright 2019 The Tilt Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/);
      assert.doesNotMatch(css, /(?<![-\w])(backdrop-)?filter\s*:/); // filter・backdrop-filter を使わない
    });

    // 一覧と詳細のダメージ
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 17a 一覧: ダメージは行メタの右端（「ダメージ 3,240」、0も出す）、未入力は出さない。メタ文字列は省略表示のまま`, async () => {
      assert.deepEqual(await page.locator('.item-meta').evaluateAll((els) => els.map((e) => e.querySelector('.meta-t').innerText + '|' + (e.querySelector('.dmg')?.innerText ?? ''))),
        ['どこでも・全8手|', '画面端・全24手|', 'どこでも・基本・全5手|ダメージ 3,240', 'どこでも・全2手|ダメージ 0']);
      const st = await page.locator('.dmg').first().evaluate((e) => { const b = getComputedStyle(e.querySelector('b')); const m = getComputedStyle(e.closest('.item-meta')); return [getComputedStyle(e).fontSize, b.fontSize, b.fontWeight, b.fontVariantNumeric, m.display, m.gap]; });
      assert.deepEqual(st, ['12px', '13px', '700', 'tabular-nums', 'flex', '8px']);
      assert.equal(await page.locator('.meta-t').first().evaluate((e) => getComputedStyle(e).textOverflow), 'ellipsis');
      assert.ok(await noHScroll(page));
    });
    await check(`${tag} 17a 一覧: 上部バーのワードマークは aria-hidden、h1の読み上げ名は「リュウ」`, async () => {
      assert.equal(await page.locator('.topbar h1 .wm[aria-hidden=true]').innerText(), 'RYU');
      assert.equal(await page.getByRole('heading', { name: 'リュウ', exact: true, level: 1 }).count(), 1);
    });
    await check(`${tag} 17a 一覧のS寸法・UIに発光がない（影はinset 0ぼかしの形のみ、text-shadowなし、filterなし）`, async () => {
      assert.deepEqual(await noGlow(page, '.row.S, .row.S *, .item, .sec-head, .bottombar, .bottombar *, .topbar, .topbar .btn'), []);
      assert.deepEqual(await page.$$eval('*', (els) => els.filter((e) => { const cs = getComputedStyle(e); return cs.filter !== 'none' || cs.backdropFilter !== 'none'; }).length), 0);
    });
    await gotoHash(page, '#/c/ryu/r/c1');
    await check(`${tag} 17a 詳細: .d-stat は20px・700・tabular、タイトルの下。未入力の詳細には出ない`, async () => {
      const r = await page.$eval('.d-stat', (e) => { const n = e.querySelector('.d-stat-n'); const cs = getComputedStyle(n); return [e.innerText.replace(/\s+/g, ' '), cs.fontSize, cs.fontWeight, cs.fontVariantNumeric, getComputedStyle(e).display, getComputedStyle(e).gap, e.previousElementSibling.className, e.nextElementSibling.className]; });
      assert.deepEqual(r, ['ダメージ 3,240', '20px', '700', 'tabular-nums', 'flex', '6px', 'd-title', 'd-cmd']);
      await gotoHash(page, '#/c/ryu/r/c2');
      assert.equal(await page.locator('.d-stat').count(), 0);
    });
    await check(`${tag} 17a 複製と編集→保存でダメージが保たれる`, async () => {
      await gotoHash(page, '#/c/ryu/r/c1');
      await page.getByRole('button', { name: '複製' }).click();
      await page.waitForFunction(() => location.hash !== '#/c/ryu/r/c1');
      assert.equal(await page.locator('.d-stat-n').innerText(), '3,240');
      const dup = (await stored(page)).combos.filter((c) => c.damage === 3240);
      assert.equal(dup.length, 2);
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      await page.getByRole('button', { name: '保存' }).click();
      await page.waitForFunction(() => location.hash === '#/c/ryu/r/c1');
      assert.equal((await stored(page)).combos.find((c) => c.id === 'c1').damage, 3240);
    });

    // チップの構造と発光（L寸法）
    await gotoHash(page, '#/c/ryu/r/c9');
    await check(`${tag} 17a 詳細(L): 種別のclass、DRの»、DIの切り欠き、斜めの板、DP二重枠、発光はDR・ODだけ`, async () => {
      const r = await page.evaluate(() => {
        const q = (s) => [...document.querySelectorAll(s)];
        const chip = (s) => getComputedStyle(document.querySelector(`.d-cmd ${s}`));
        const sh = (s) => q(`.d-cmd ${s}`).map((e) => getComputedStyle(e).boxShadow);
        return {
          dr: q('.d-cmd .sys-dr').map((e) => [e.textContent, !!e.querySelector('svg.rush[aria-hidden=true]'), e.getAttribute('aria-label')]),
          di: [q('.d-cmd .sys-di').length, getComputedStyle(document.querySelector('.d-cmd .sys-di'), '::before').clipPath !== 'none', chip('.sys-di').color],
          dp: [q('.d-cmd .sys-dp').length, chip('.sys-dp').borderTopColor, chip('.sys-dp').backgroundColor, chip('.sys-dp').boxShadow],
          sa: [q('.d-cmd .sys-sa').length, chip('.sys-sa').borderTopColor, chip('.sys-sa').backgroundColor],
          tag: [getComputedStyle(document.querySelector('.d-cmd .tag'), '::before').transform, getComputedStyle(document.querySelector('.d-cmd .tag'), '::before').backgroundColor],
          drGlow: sh('.sys-dr'), saGlow: sh('.sys-sa'),
          dotGlow: q('.d-cmd .dot.od').map((e) => getComputedStyle(e).boxShadow), strDot: q('.d-cmd .dot:not(.od)').map((e) => getComputedStyle(e).boxShadow),
          odText: q('.d-cmd .ltr.od').map((e) => [getComputedStyle(e).color, getComputedStyle(e).textShadow]),
          rushSize: [chip('.sys-dr .rush').width, chip('.sys-dr .rush').height],
        };
      });
      assert.deepEqual(r.dr, [['CDR', true, 'CDR'], ['生ラッシュ', true, '生ラッシュ']].map(([t, a, l]) => [t, a, l]));
      assert.deepEqual(r.di, [1, true, 'rgb(14, 15, 17)']);
      assert.deepEqual(r.dp.slice(0, 3), [2, 'rgb(127, 152, 255)', 'rgb(27, 42, 102)']);
      assert.match(r.dp[3], /inset/);
      assert.deepEqual(r.sa, [1, 'rgb(242, 238, 230)', 'rgb(34, 37, 42)']);
      assert.match(r.tag[0], /^matrix\(/);
      assert.equal(r.tag[1], 'rgb(74, 80, 89)');
      assert.ok(r.drGlow.every((x) => x.includes('rgba(77, 242, 124')), r.drGlow.join());
      assert.ok(r.saGlow.every((x) => x === 'none'));
      assert.ok(r.dotGlow.length === 2 && r.dotGlow.every((x) => x.includes('rgba(255, 116, 16')), r.dotGlow.join());
      assert.ok(r.strDot.every((x) => x === 'none'));
      assert.deepEqual(r.odText[0][0], 'rgb(255, 116, 16)');
      assert.match(r.odText[0][1], /rgba\(255, 116, 16/);
      assert.deepEqual(r.rushSize, ['12px', '12px']);
    });
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 17a 一覧(S): »は9px、DPは1pxの枠、DIの切り欠きは4px。ODにも発光なし`, async () => {
      const r = await page.evaluate(() => {
        const sc = (s) => getComputedStyle(document.querySelector(`.item .row.S ${s}`));
        const it = [...document.querySelectorAll('.item')].find((e) => e.textContent.includes('全部入り'));
        const s2 = (sel) => getComputedStyle(it.querySelector(sel));
        return [s2('.sys-dr .rush').width, s2('.sys-dp').borderTopWidth, s2('.sys-di').getPropertyValue('--c'), s2('.dot.od').boxShadow, s2('.ltr.od').textShadow, s2('.sys-dr').boxShadow, sc('.chip').height];
      });
      assert.deepEqual(r.slice(0, 6), ['9px', '1px', '4px', 'none', 'none', 'none']);
    });
    await gotoHash(page, '#/c/ryu/r/c9');
    await page.locator('button[aria-label="凡例を開く"]').click();
    await check(`${tag} 17a 凡例: システム技は種別ごとの行、L寸法の見た目、ODと注記の説明`, async () => {
      await page.waitForSelector('.sheet.tall');
      const t = await page.locator('.leg').innerText();
      for (const w of ['緑の枠と»', '角を切った銀の板', '紺の二重枠', '白い枠', '橙の●2つ（重ねて表示）', '斜めの小さな板']) assert.ok(t.includes(w), w);
      assert.equal(await page.locator('.leg .sys-dr').count(), 2);
      assert.equal(await page.locator('.leg .row:not(.S) .sys').count(), 10); // CDR・生ラッシュ・DI・DP・Dリバ・SA1〜3、前ステ・バクステ（D-013）
      assert.ok(await noHScroll(page));
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
    });

    // 編集画面: パッドとUIに発光なし、システム行の帯、ODキーの橙、タグ［追加］が折れない
    await gotoHash(page, '#/c/ryu/r/c9/edit');
    await check(`${tag} 17a 編集: パッドに発光なし、帯は種別の色（注記には付かない）、ODキーは橙、［追加］は折れない`, async () => {
      assert.deepEqual(await noGlow(page, '.pad .key, .pad .key *, .pad'), []);
      const bands = await page.$$eval('.sys-keys .key', (els) => els.map((e) => [e.getAttribute('aria-label'), e.classList.contains('band') ? getComputedStyle(e, '::before').backgroundColor : null]));
      const col = { キャンセルドライブラッシュ: 'rgb(77, 242, 124)', パリィドライブラッシュ: 'rgb(77, 242, 124)', ドライブインパクト: 'rgb(163, 169, 178)', ドライブパリィ: 'rgb(127, 152, 255)', ドライブリバーサル: 'rgb(127, 152, 255)' };
      for (const [name, c] of bands) {
        const want = col[name] ?? (/^スーパーアーツ/.test(name) ? 'rgb(242, 238, 230)' : null);
        assert.equal(c, want, name);
      }
      assert.equal(bands.filter(([, c]) => c).length, 8);
      assert.equal(await page.locator('.okey .ltr.od').first().evaluate((e) => getComputedStyle(e).color), 'rgb(255, 116, 16)');
      assert.equal(await page.locator('.okey .dot.od').first().evaluate((e) => getComputedStyle(e).color), 'rgb(255, 116, 16)');
      const add = await page.locator('.tag-add .btn').boundingBox();
      assert.ok(add.height <= 48 && add.width >= 44, JSON.stringify(add));
      assert.equal(await page.locator('.tag-add .btn').innerText(), '追加');
    });
    await check(`${tag} 17a ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    // reduced-motion: 点灯は動かず、最終状態で表示される
    const rm = await newPage(width, dmgSeed(), { reducedMotion: 'reduce' });
    await check(`${tag} 17a reduced-motion では起動時の点灯が動かない（animation なし、opacity 1）`, async () => {
      const r = await rm.$$eval('.cell.boot .cell-en', (els) => els.map((e) => [getComputedStyle(e).animationName, getComputedStyle(e).opacity]));
      assert.equal(r.length, 6);
      assert.ok(r.every((x) => x[0] === 'none' && x[1] === '1'), JSON.stringify(r));
    });
    await rm.context().close();
  }

  // 17b. デザイン刷新v2の後半（T-017b。design-spec-v2 4章・5.4・9章の6・7）: ［完了］キー、格納バー、Enter、ダメージ入力欄
  {
    const active = (page) => page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : `${a.tagName.toLowerCase()}#${a.id}`; });
    const padVisible = (page) => page.locator('.pad').isVisible();
    const dockVisible = (page) => page.locator('.pad-dock').isVisible();
    const seed = seedState();
    seed.combos[0].damage = 3240;
    const page = await newPage(width, seed);
    await gotoHash(page, '#/c/ryu/new?s=s1');

    await check(`${tag} 17b ［完了］キー: R1の右端に固定、幅64以上・高さ44以上、▾16pxと「完了」14px/700、aria-label・aria-controls`, async () => {
      const r = await page.evaluate(() => {
        const k = document.querySelector('.r1 .done');
        const b = k.getBoundingClientRect();
        const rec = document.querySelector('.r1 .recent-keys').getBoundingClientRect();
        const ic = k.querySelector('svg').getBoundingClientRect();
        const t = getComputedStyle(k.querySelector('.done-t'));
        return { w: b.width, h: b.height, right: b.right, padRight: document.querySelector('.pad').getBoundingClientRect().right - 6, recW: rec.width, ic: [ic.width, ic.height], rot: k.querySelector('svg').style.transform, t: [k.querySelector('.done-t').textContent, t.fontSize, t.fontWeight],
          label: k.getAttribute('aria-label'), ctl: k.getAttribute('aria-controls'), padId: document.querySelector('section.pad').id, tabindex: document.querySelector('section.pad').getAttribute('tabindex'), tag: k.tagName, glow: getComputedStyle(k).boxShadow };
      });
      assert.ok(r.w >= 64 && r.h >= 44, JSON.stringify(r));
      assert.equal(r.right, r.padRight);
      assert.equal(r.recW, width - 12 - 4 - 64 - 4 - 52); // 直近の列の見える幅（［技名］キー52pxが左に入るので360pxで224px。design-spec-v2.2 1章）
      assert.deepEqual([r.ic, r.rot, r.t], [[16, 16], 'rotate(90deg)', ['完了', '14px', '700']]);
      assert.deepEqual([r.label, r.ctl, r.padId, r.tabindex, r.tag, r.glow], ['パッドを閉じて項目の入力へ', 'pad', 'pad', '-1', 'BUTTON', 'none']);
      assert.equal(await page.locator('.pad-dock').isVisible(), false); // パッドが出ている間は格納バーなし
    });
    await check(`${tag} 17b 直近の技が空でも［完了］は右端に残る（案内文は残り幅）`, async () => {
      const q = await newPage(width, { sections: [sec('s1', 'ryu', '通常', 0)], combos: [] });
      await gotoHash(q, '#/c/ryu/new?s=s1');
      const r = await q.evaluate(() => [document.querySelector('.r1 .recent-empty').getBoundingClientRect().width, document.querySelector('.r1 .done').getBoundingClientRect().width]);
      assert.deepEqual(r, [width - 12 - 4 - 64 - 4 - 52, 64]);
      await q.context().close();
    });
    // ペンディング（↓）を作ってから［完了］
    await page.getByRole('radio', { name: 'しゃがみ', exact: true }).click();
    const before = await storedRaw(page);
    await page.getByRole('button', { name: 'パッドを閉じて項目の入力へ' }).click();
    await check(`${tag} 17b ［完了］: パッドが隠れ、格納バーが出て、#f-sec にフォーカス。ペンディングは保持、保存しない`, async () => {
      assert.equal(await padVisible(page), false);
      assert.equal(await dockVisible(page), true);
      assert.equal(await active(page), 'select#f-sec');
      assert.equal(await page.locator('.cmd .pending').count(), 1);
      assert.equal(await page.locator('.pad').getAttribute('hidden') !== null, true);
      assert.match(await hash(page), /^#\/c\/ryu\/new/); // 保存していない（詳細へ移っていない）
      assert.equal(await storedRaw(page), before);
    });
    await shot(page, '40-edit-dock', width);
    await check(`${tag} 17b 格納バー: パッドの位置（下端）、高さ56、副ボタン［▴ 技を入力］を左寄せに1つ、aria-controls・aria-expanded`, async () => {
      const r = await page.evaluate(() => {
        const d = document.querySelector('footer.bottombar.pad-dock');
        const b = d.getBoundingClientRect();
        const bs = [...d.querySelectorAll('button')];
        const x = bs[0].getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, h: b.height, n: bs.length, left: x.left - b.left, bh: x.height, t: bs[0].textContent.trim(), c: bs[0].getAttribute('aria-controls'), e: bs[0].getAttribute('aria-expanded'), cls: bs[0].className, primary: !!d.querySelector('.primary'), fixed: getComputedStyle(d).position };
      });
      assert.deepEqual([r.h, r.bottom, r.n, r.t, r.c, r.e, r.primary], [56, 740, 1, '技を入力', 'pad', 'false', false], JSON.stringify(r));
      assert.ok(r.left <= 20 && r.bh >= 44, JSON.stringify(r)); // 左寄せ
      assert.equal(r.fixed, 'sticky'); // 浮動ボタンではなく下部バー
      assert.equal(await page.locator('.pad-dock svg').count(), 1);
    });
    await page.locator('.pad-dock button').click();
    await check(`${tag} 17b 格納バーの［▴ 技を入力］: パッドが戻り、フォーカスは section.pad。寸法は414・y>=326のまま`, async () => {
      assert.equal(await padVisible(page), true);
      assert.equal(await dockVisible(page), false);
      assert.equal(await active(page), 'section#pad');
      const b = await page.locator('.pad').boundingBox();
      assert.ok(b.y >= 326 && b.height === 414, JSON.stringify(b));
      assert.equal(await page.locator('.cmd .pending').count(), 1);
    });
    await page.getByRole('button', { name: 'パッドを閉じて項目の入力へ' }).click();
    await page.locator('.cmd').click({ position: { x: 5, y: 5 } });
    await check(`${tag} 17b コマンド列のタップでもパッドが戻り、格納バーは消える`, async () => {
      assert.equal(await padVisible(page), true);
      assert.equal(await dockVisible(page), false);
    });
    await page.getByLabel('メモ').click();
    await check(`${tag} 17b テキスト欄へのフォーカスでパッドが隠れたときも格納バーが出る`, async () => {
      assert.equal(await padVisible(page), false);
      assert.equal(await dockVisible(page), true);
    });
    // Enter 相当
    await page.locator('#f-title').click();
    await page.keyboard.press('Enter');
    await check(`${tag} 17b タイトル欄で Enter すると blur する（パッドは隠れたまま、格納バーが見える）`, async () => {
      assert.equal(await active(page), 'body');
      assert.equal(await padVisible(page), false);
      assert.equal(await dockVisible(page), true);
    });
    await page.locator('#f-dmg').click();
    await page.keyboard.press('Enter');
    await check(`${tag} 17b ダメージ欄で Enter すると blur する`, async () => {
      assert.equal(await active(page), 'body');
      assert.equal(await dockVisible(page), true);
    });
    await check(`${tag} 17b 変換中（isComposing）の Enter では blur しない。メモ欄の Enter は改行のまま`, async () => {
      await page.locator('#f-title').click();
      await page.evaluate(() => document.querySelector('#f-title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
      assert.equal(await active(page), 'input#f-title');
      await page.locator('#f-memo').click();
      await page.keyboard.press('Enter');
      assert.equal(await active(page), 'textarea#f-memo');
      assert.equal(await page.locator('#f-memo').inputValue(), '\n');
      await page.locator('#f-memo').fill('');
    });

    // ダメージ入力欄
    await check(`${tag} 17b ダメージ欄: 並び（セクション・タイトル・位置・ダメージ・タグ・メモ）、属性、ラベル、ヒント、幅120`, async () => {
      assert.deepEqual(await page.$$eval('.fields #f-sec, .fields #f-title, .fields input[name=pos], .fields #f-dmg, .fields #f-tag, .fields #f-memo', (els) => els.map((e) => e.id || e.name).filter((x, i, arr) => arr.indexOf(x) === i)), ['f-sec', 'f-title', 'pos', 'f-dmg', 'f-tag', 'f-memo']);
      const a = await page.$eval('#f-dmg', (e) => Object.fromEntries(['type', 'inputmode', 'pattern', 'maxlength', 'enterkeyhint', 'autocomplete'].map((k) => [k, e.getAttribute(k)])));
      assert.deepEqual(a, { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '5', enterkeyhint: 'done', autocomplete: 'off' });
      assert.equal(await page.locator('label[for=f-dmg]').innerText(), 'ダメージ（任意）');
      assert.equal(await page.getByLabel('ダメージ（任意）').count(), 1);
      const h = await page.$eval('.dmg-hint', (e) => { const cs = getComputedStyle(e); return [e.textContent, cs.fontSize, cs.color, e.getBoundingClientRect().left > document.querySelector('#f-dmg').getBoundingClientRect().right]; });
      assert.deepEqual(h, ['0〜99999', '12px', 'rgb(170, 166, 157)', true]);
      assert.equal((await page.locator('#f-dmg').boundingBox()).width, 120);
      assert.equal(await page.locator('#f-dmg').getAttribute('aria-describedby'), 'f-dmg-hint');
    });
    const typeDmg = async (text) => { await page.locator('#f-dmg').fill(''); await page.locator('#f-dmg').click(); await page.keyboard.insertText(text); };
    await check(`${tag} 17b ダメージ欄: 全角数字は半角に、数字以外は除き、5桁に切る`, async () => {
      await typeDmg('３,２４０');
      assert.equal(await page.locator('#f-dmg').inputValue(), '3240');
      await typeDmg('1a2-3');
      assert.equal(await page.locator('#f-dmg').inputValue(), '123');
      await typeDmg('１２３４５６７');
      assert.equal(await page.locator('#f-dmg').inputValue(), '12345'); // maxlength=5（入力の段階で切る）
      await typeDmg('abc');
      assert.equal(await page.locator('#f-dmg').inputValue(), '');
    });
    await check(`${tag} 17b ダメージ欄: フォーカスが外れたら先頭の0を除く（0050→50、0→0、000→0）`, async () => {
      for (const [typed, want] of [['0050', '50'], ['0', '0'], ['000', '0'], ['００７', '7'], ['100', '100']]) {
        await typeDmg(typed);
        assert.equal(await page.locator('#f-dmg').inputValue(), typed.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xFF10)), '入力中は触らない');
        await page.locator('#f-title').click(); // フォーカスを外す
        assert.equal(await page.locator('#f-dmg').inputValue(), want, typed);
      }
    });
    // 保存して値が一致する（3240）
    await typeDmg('３,２４０');
    await check(`${tag} 17b ダメージ: 下書きに数値で入る`, async () => {
      const d = JSON.parse(await storedRaw(page, 'sf6memo.drafts'));
      assert.equal(d['new:s1'].damage, 3240);
    });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => /\/r\//.test(location.hash));
    const newId = (await hash(page)).split('/r/')[1];
    await check(`${tag} 17b ダメージ: 保存すると 3240（数値）で sf6memo.data に入り、詳細に 20px で出る`, async () => {
      const d = (await stored(page)).combos.find((c) => c.id === newId);
      assert.deepEqual([d.damage, typeof d.damage], [3240, 'number']);
      assert.match(await storedRaw(page), new RegExp(`"id":"${newId}"[^}]*"damage":3240[,}]`));
      assert.deepEqual(await page.$eval('.d-stat', (e) => [e.innerText.replace(/\s+/g, ' '), getComputedStyle(e.querySelector('.d-stat-n')).fontSize]), ['ダメージ 3,240', '20px']);
    });
    await shot(page, '41-detail-damage', width);
    await check(`${tag} 17b ダメージ: 一覧に「ダメージ 3,240」、再読み込み後も詳細・一覧・編集で一致する`, async () => {
      await page.reload();
      await page.waitForSelector('.d-stat');
      assert.equal(await page.locator('.d-stat-n').innerText(), '3,240');
      await gotoHash(page, '#/c/ryu');
      assert.equal(await page.locator(`a[href$="/r/${newId}"] .dmg`).innerText(), 'ダメージ 3,240');
      await gotoHash(page, `#/c/ryu/r/${newId}/edit`);
      assert.equal(await page.locator('#f-dmg').inputValue(), '3240');
    });
    // 空は未入力: キーを持たず、一覧にも詳細にも出ない
    await page.locator('#f-dmg').fill('');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction((id) => location.hash === `#/c/ryu/r/${id}`, newId);
    await check(`${tag} 17b ダメージ: 空にして保存すると damage キーが消え、詳細・一覧に出ない（元の値に戻らない）`, async () => {
      const d = (await stored(page)).combos.find((c) => c.id === newId);
      assert.equal(Object.hasOwn(d, 'damage'), false);
      assert.equal(await page.locator('.d-stat').count(), 0);
      await gotoHash(page, '#/c/ryu');
      assert.equal(await page.locator(`a[href$="/r/${newId}"] .dmg`).count(), 0);
    });
    await check(`${tag} 17b ダメージ: 0 は 0 として保存され、「ダメージ 0」と出る`, async () => {
      await gotoHash(page, `#/c/ryu/r/${newId}/edit`);
      await typeDmg('0');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction((id) => location.hash === `#/c/ryu/r/${id}`, newId);
      assert.equal((await stored(page)).combos.find((c) => c.id === newId).damage, 0);
      assert.equal(await page.locator('.d-stat').innerText().then((t) => t.replace(/\s+/g, ' ')), 'ダメージ 0');
    });
    // 下書き復元
    await check(`${tag} 17b ダメージ: 下書きの復元で値が保たれる（新規）`, async () => {
      await gotoHash(page, '#/c/ryu/new?s=s2');
      await typeDmg('777');
      await page.reload();
      await page.waitForSelector('#f-dmg');
      assert.equal(await page.locator('#f-dmg').inputValue(), '777');
      assert.match(await page.locator('.notice').innerText(), /前回の下書きを開きました/);
      await page.locator('.notice .btn').click(); // 破棄して新規
      assert.equal(await page.locator('#f-dmg').inputValue(), '');
    });
    await check(`${tag} 17b ダメージ: 既存記録の編集でも下書きに保たれ、空にした下書きは元の値に戻らない`, async () => {
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      assert.equal(await page.locator('#f-dmg').inputValue(), '3240'); // 既存記録の値
      await typeDmg('555');
      await page.reload();
      await page.waitForSelector('#f-dmg');
      assert.equal(await page.locator('#f-dmg').inputValue(), '555');
      await page.locator('#f-dmg').fill('');
      await page.locator('#f-dmg').dispatchEvent('input');
      await page.reload();
      await page.waitForSelector('#f-dmg');
      assert.equal(await page.locator('#f-dmg').inputValue(), '');
      assert.match(await page.locator('.notice').innerText(), /前回の下書きを開きました/);
      await page.locator('.notice .btn').click(); // 破棄して保存済みに戻す
      assert.equal(await page.locator('#f-dmg').inputValue(), '3240');
    });
    await check(`${tag} 17b ダメージ: 保存した記録の sf6memo.data の damage はすべて数値`, async () => {
      const ds = (await stored(page)).combos.filter((c) => Object.hasOwn(c, 'damage')).map((c) => typeof c.damage);
      assert.ok(ds.length >= 2 && ds.every((t) => t === 'number'), JSON.stringify(ds));
    });
    await check(`${tag} 17b ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 18. 設定とデータ（T-012）: 書き出し・取り込み・表示設定・書き出しの案内
  {
    const DAY = 86_400_000;
    const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sf6memo.settings') ?? 'null'));
    const patchSettings = (page, patch) => page.evaluate((p) => {
      localStorage.setItem('sf6memo.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('sf6memo.settings') ?? '{}'), ...p }));
    }, patch);
    const downloadVia = async (page, click) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
      return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
    };
    const importFile = (page, content, name = 'in.json') => page.locator('input[type=file]').setInputFiles({
      name, mimeType: 'application/json', buffer: Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)),
    });
    const sheetText = (page) => page.locator('.sheet').innerText().then((t) => t.replace(/\s+/g, ' '));
    const gone = (page) => page.waitForSelector('.sheet', { state: 'detached' });
    const toast = (page) => page.locator('#toast .toast-msg').allInnerTexts();
    const errText = async (page, re) => { // 直前のエラーが残っていても、新しい理由が出るまで待つ。出なければ現在の文字列を返す（呼び出し側の assert が落とす）
      await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.set-err')?.textContent ?? ''), re.source, { timeout: 4000 }).catch(() => {});
      return page.evaluate(() => document.querySelector('.set-err')?.textContent ?? '');
    };
    const FILE_RE = /^sf6-memo-\d{8}-\d{4}\.json$/;

    // 18a 初期表示と、書き出し→全削除→取り込みで元に戻る（受け入れ基準7.3-3）
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/settings');
      await check(`${tag} 18 設定の初期表示: 未実施・ボタン・末尾の表記。破壊的な操作なし`, async () => {
        assert.match(await page.locator('.topbar h1').innerText(), /設定/);
        assert.equal(await page.locator('.set-v').innerText(), 'まだ書き出していません');
        assert.equal(await page.getByRole('button', { name: 'JSONを書き出す' }).evaluate((b) => b.classList.contains('primary')), true);
        assert.equal(await page.getByRole('button', { name: 'JSONを取り込む' }).evaluate((b) => b.classList.contains('primary')), false);
        assert.equal(await page.locator('input[type=file]').getAttribute('accept'), 'application/json,.json');
        const foot = (await page.locator('.set-foot').innerText()).split('\n').filter(Boolean);
        assert.deepEqual(foot, ['非公式アプリです。Capcomとは関係ありません。', LEGAL, 'バージョン v0.1.0', '英字書体: Tilt Neon（SIL Open Font License 1.1）']);
        assert.equal(await page.locator('.set-font').evaluate((e) => getComputedStyle(e).fontSize), '12px');
        assert.deepEqual(await page.getByRole('radio', { name: /矢印|数字|オフ|オン/ }).evaluateAll((r) => r.map((x) => x.checked)), [true, false, true, false]);
        assert.equal(await page.getByRole('button', { name: /削除|消去|リセット|全て|すべて/ }).count(), 0);
        assert.ok(await noHScroll(page));
      });
      await shot(page, '18-settings-initial', width);
      const original = await stored(page);
      const t0 = Date.now();
      const out = await downloadVia(page, () => page.getByRole('button', { name: 'JSONを書き出す' }).click());
      await check(`${tag} 18a 書き出し: ファイル名・整形なしのJSON・内容が保存データと一致・lastExportAt更新・トースト`, async () => {
        assert.match(out.name, FILE_RE);
        assert.ok(!out.text.includes('\n'), '整形なし（取り込み上限との食い違いを小さくする）');
        assert.deepEqual(JSON.parse(out.text), original);
        await page.waitForSelector('#toast .toast');
        assert.deepEqual(await toast(page), ['書き出しました']);
        const s = await settingsOf(page);
        assert.ok(s.lastExportAt >= t0 && s.lastExportAt <= Date.now(), String(s.lastExportAt));
        assert.match(await page.locator('.set-v').innerText(), /^\d{4}-\d\d-\d\d（今日）$/);
        assert.equal(await page.getByRole('button', { name: 'JSONを書き出す' }).isDisabled(), false);
      });
      await shot(page, '19-settings-exported', width);
      await page.evaluate(() => localStorage.clear()); // 全削除（アプリ内に機能がないため、サイトデータの削除で代替。D-006）
      await page.reload();
      await gotoHash(page, '#/settings');
      await check(`${tag} 18a 全削除後は保存データが空`, async () => assert.equal(await storedRaw(page), null));
      await importFile(page, out.text);
      await page.waitForSelector('.sheet');
      await check(`${tag} 18a 取り込みの確認シート: 件数・注記・［やめる］［取り込む］`, async () => {
        const t = await sheetText(page);
        assert.match(t, /^取り込みの確認 記録 追加 3件 ／ 更新 0件 ／ 変更なし 0件 セクション 追加 3件 ／ 更新 0件 ／ 変更なし 0件 同じ記録は更新日時が新しい方を残します/);
        assert.deepEqual(await page.locator('.sheet-foot .btn').allInnerTexts(), ['やめる', '取り込む']);
        assert.equal(await storedRaw(page), null); // 確認前は書かない
        assert.ok(await noHScroll(page));
      });
      await shot(page, '20-import-confirm', width);
      await page.getByRole('button', { name: '取り込む', exact: true }).click();
      await gone(page);
      await check(`${tag} 18a 取り込み後: トーストと、元のデータとの一致（sections・combos）`, async () => {
        assert.deepEqual(await toast(page), ['取り込みました（記録 追加3・更新0、セクション 追加3・更新0）']);
        const now = await stored(page);
        assert.deepEqual(now.sections, original.sections);
        assert.deepEqual(now.combos, original.combos);
        assert.equal(await settingsOf(page).then((s) => s.lastExportAt), null); // 最終書き出し日は取り込まない（D-006）
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.fk), 'import'); // フォーカスは取り込みボタンへ
      });
      await check(`${tag} 18a ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 18b 不正なJSON5種とサイズ超過: データは変わらず、理由がその場に出る（受け入れ基準7.3-4）
    {
      const seed = seedState();
      const good = exportDoc(seed);
      const page = await newPage(width, seed);
      await gotoHash(page, '#/settings');
      const before = await storedRaw(page);
      const beforeSettings = await storedRaw(page, 'sf6memo.settings');
      const cases = [
        ['JSONでない', '{not json', /JSONとして読めません/],
        ['appの不一致', { ...good, app: 'other-app' }, /appが一致しません/],
        ['schemaVersionが新しすぎる', { ...good, schemaVersion: 99 }, /新しい版\(schemaVersion 99\)/],
        ['未知のキー', { ...good, extra: 1 }, /未対応の項目/],
        ['参照整合の破綻', { ...good, combos: good.combos.map((c, i) => (i === 0 ? { ...c, sectionId: 'nope' } : c)) }, /1件目のcombosのsectionIdが不正です/],
        ['サイズ超過（5MB超）', Buffer.alloc(5 * 1024 * 1024 + 1, 0x20), /ファイルが大きすぎます（5MBまで）/],
      ];
      for (const [name, content, re] of cases) {
        await importFile(page, content);
        const t = await errText(page, re);
        await check(`${tag} 18b ${name}: データ不変・理由をその場に表示・シートなし`, async () => {
          assert.match(t, /取り込めませんでした（データは変更していません）/);
          assert.match(t, re);
          assert.equal(await storedRaw(page), before);
          assert.equal(await storedRaw(page, 'sf6memo.settings'), beforeSettings);
          assert.equal(await page.locator('.sheet').count(), 0);
          assert.equal(await page.locator('.set-err .err[role=alert]').count(), 1);
          assert.equal(await page.getByRole('button', { name: 'JSONを取り込む' }).isDisabled(), false);
          assert.ok(await noHScroll(page));
        });
        if (name === 'JSONでない') await shot(page, '21-import-error', width);
      }
      await check(`${tag} 18b 理由は textContent で表示する（HTMLとして解釈しない）`, async () => {
        await importFile(page, '{"app":"<img src=x onerror=alert(1)>"}');
        assert.match(await errText(page, /appが一致しません/), /appが一致しません/);
        assert.equal(await page.locator('.set-err img').count(), 0);
      });
      await check(`${tag} 18b 不正のあとで正しいファイルを選ぶと、エラーが消えて確認シートが出る`, async () => {
        await importFile(page, good);
        await page.waitForSelector('.sheet');
        assert.equal(await page.locator('.set-err .err').count(), 0);
        assert.match(await sheetText(page), /記録 追加 0件 ／ 更新 0件 ／ 変更なし 3件 セクション 追加 0件 ／ 更新 0件 ／ 変更なし 3件/);
        assert.match(await sheetText(page), /追加・更新はありません/); // 0件でも確認シートは出す
        await page.getByRole('button', { name: '取り込む', exact: true }).click();
        await gone(page);
        assert.deepEqual(await toast(page), ['取り込みました（追加0・更新0）']);
        assert.equal(await storedRaw(page), before); // 変更がなければ書き込まない
        assert.equal(await storedRaw(page, 'sf6memo.settings'), beforeSettings);
      });
      await check(`${tag} 18b ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 18c 同じidは更新日時が新しい方、同時刻は端末側、端末のみの記録は残る。［やめる］では何も変えない
    {
      const local = seedState();
      local.combos.push(combo('c5', 's1', '端末のみ', [N('stand', 'L', 'P')]));
      const page = await newPage(width, local);
      await gotoHash(page, '#/settings');
      const before = await storedRaw(page);
      const incoming = exportDoc({
        sections: [...local.sections, sec('s4', 'ryu', '新しい状況', 3)],
        combos: [
          { ...local.combos[0], title: '新しい方', updatedAt: T0 + 1000 }, // 更新
          { ...local.combos[1], title: '同時刻の別内容' }, // 同時刻: 端末側を残す
          { ...local.combos[2], title: '古い方', updatedAt: T0 - 1 }, // 古い: 端末側を残す
          combo('c4', 's4', '追加分', [N('stand', 'H', 'K')], { updatedAt: T0 + 5 }),
        ],
      });
      await importFile(page, incoming);
      await page.waitForSelector('.sheet');
      await check(`${tag} 18c 確認シートの件数は記録とセクションに分かれる（記録: 追加1・更新1・変更なし2、セクション: 追加1・変更なし3）`, async () => assert.match(await sheetText(page), /記録 追加 1件 ／ 更新 1件 ／ 変更なし 2件 セクション 追加 1件 ／ 更新 0件 ／ 変更なし 3件/));
      await page.getByRole('button', { name: 'やめる' }).click();
      await gone(page);
      await check(`${tag} 18c ［やめる］ではデータもトーストも変わらない`, async () => {
        assert.equal(await storedRaw(page), before);
        assert.equal(await page.locator('#toast .toast').count(), 0);
      });
      await importFile(page, incoming);
      await page.waitForSelector('.sheet');
      await page.getByRole('button', { name: '取り込む', exact: true }).click();
      await gone(page);
      await check(`${tag} 18c 新しい方が残り、端末のみの記録も残る。トースト（記録 追加1・更新1、セクション 追加1・更新0）`, async () => {
        const d = await stored(page);
        const title = (id) => d.combos.find((c) => c.id === id)?.title;
        assert.deepEqual(['c1', 'c2', 'c3', 'c4', 'c5'].map(title), ['新しい方', '長いコンボ', '', '追加分', '端末のみ']);
        assert.equal(d.combos.find((c) => c.id === 'c1').updatedAt, T0 + 1000);
        assert.deepEqual(d.sections.map((s) => s.id), ['s1', 's2', 's3', 's4']);
        assert.deepEqual(await toast(page), ['取り込みました（記録 追加1・更新1、セクション 追加1・更新0）']);
      });
      await check(`${tag} 18c ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 18d 表示設定: 方向の表記と補助文字が全画面に反映され、再読み込み後も保たれる
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/settings');
      await page.getByRole('radio', { name: '数字' }).check();
      await check(`${tag} 18d 方向の表記［数字］: 例示に即時反映・保存・フォーカス維持`, async () => {
        assert.equal(await page.locator('.set-sample .row .arrow').count(), 0);
        assert.ok(await page.locator('.set-sample .row .num').count() >= 3);
        assert.equal((await settingsOf(page)).notation, 'numpad');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.fk), 'notation:numpad');
      });
      await shot(page, '22-settings-numpad', width);
      const numpadOnly = async (sel, name) => {
        assert.ok(await page.locator(`${sel} .num`).count() > 0, `${name}: 数字がない`);
        assert.equal(await page.locator(`${sel} .arrow, ${sel} .cw`).count(), 0, `${name}: 矢印が残っている`);
      };
      await check(`${tag} 18d 数字表記が一覧・詳細・編集（列・直近・プリセット）・凡例に反映される`, async () => {
        await gotoHash(page, '#/c/ryu');
        await numpadOnly('.preview', '一覧');
        await gotoHash(page, '#/c/ryu/r/c1');
        await numpadOnly('.d-cmd', '詳細');
        await page.locator('button[aria-label="凡例を開く"]').click();
        await numpadOnly('.sheet .leg .row', '凡例');
        await page.keyboard.press('Escape');
        await gone(page);
        await gotoHash(page, '#/c/ryu/r/c1/edit');
        await numpadOnly('.cmd', '編集の列');
        await numpadOnly('.preset-grid', '編集のプリセット');
        await page.getByRole('button', { name: '波動 236', exact: true }).click(); // ペンディングの仮チップ
        await page.getByRole('button', { name: /^弱P$/ }).click();
        await numpadOnly('.recent-keys', '編集の直近');
        await numpadOnly('.cmd', '編集の列（追加後）');
      });
      await page.reload();
      await check(`${tag} 18d 再読み込み後も数字表記が保たれる`, async () => {
        await gotoHash(page, '#/c/ryu');
        await numpadOnly('.preview', '一覧（再読み込み後）');
        await gotoHash(page, '#/settings');
        assert.equal(await page.getByRole('radio', { name: '数字' }).isChecked(), true);
        await page.getByRole('radio', { name: '矢印' }).check();
        await gotoHash(page, '#/c/ryu');
        assert.equal(await page.locator('.preview .num').count(), 0);
        assert.ok(await page.locator('.preview .arrow').count() > 0);
      });
      await gotoHash(page, '#/settings');
      await page.getByRole('radio', { name: 'オン' }).check();
      await check(`${tag} 18d 補助文字［オン］: 例示のチップに弱・中・強が出る。一覧・編集のパッドにも反映`, async () => {
        assert.equal(await page.locator('.set-sample .row.str-labels').count(), 4); // 方向・必殺技・補助文字・メモの文字サイズの4つの見本
        assert.equal(await page.locator('.set-sample .badge').first().isVisible(), true);
        assert.deepEqual(await page.locator('.set-sample .row').nth(2).locator('.badge').allInnerTexts(), ['弱', '中', '強']);
        assert.equal((await settingsOf(page)).strengthLabels, true);
        assert.ok(await noHScroll(page));
        await gotoHash(page, '#/c/ryu');
        assert.ok(await page.locator('.preview .row.str-labels').count() > 0);
        await gotoHash(page, '#/c/ryu/r/c1/edit');
        assert.equal(await page.locator('.pad.str-labels').count(), 1);
      });
      await shot(page, '23-settings-labels-on', width);
      await page.reload();
      await check(`${tag} 18d 再読み込み後も補助文字［オン］が保たれ、［オフ］で消える`, async () => {
        await gotoHash(page, '#/settings');
        assert.equal(await page.getByRole('radio', { name: 'オン' }).isChecked(), true);
        await page.getByRole('radio', { name: 'オフ' }).check();
        assert.equal(await page.locator('.set-sample .row.str-labels').count(), 0);
        assert.equal(await page.locator('.set-sample .badge').first().isVisible(), false);
        assert.equal((await settingsOf(page)).strengthLabels, false);
      });
      await check(`${tag} 18d ［凡例を見る］で凡例シートが開き、戻る操作で閉じる`, async () => {
        await page.getByRole('button', { name: '凡例を見る' }).click();
        assert.equal(await page.locator('.sheet h2').innerText(), '凡例');
        await page.goBack();
        await gone(page);
        assert.equal(await hash(page), '#/settings');
      });
      await check(`${tag} 18d ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 18e 書き出しの案内（キャラ選択）
    {
      const page = await newPage(width, seedState());
      const home = async (patch) => { await patchSettings(page, patch); await page.reload(); await gotoHash(page, '#/'); };
      const remind = (p = page) => p.locator('.remind');
      const n = Date.now();
      await home({ lastExportAt: n - 13 * DAY, lastChangeAt: n - DAY });
      await check(`${tag} 18e 13日では出ない`, async () => assert.equal(await remind().count(), 0));
      await home({ lastExportAt: n - 20 * DAY, lastChangeAt: n - 30 * DAY });
      await check(`${tag} 18e 20日経っても、書き出し後に変更がなければ出ない`, async () => assert.equal(await remind().count(), 0));
      await home({ lastExportAt: n - 14 * DAY - 1000, lastChangeAt: n - DAY });
      await check(`${tag} 18e 14日以上＋その後に変更あり: 帯が出る（surface地・主ボタンなし）`, async () => {
        assert.match(await remind().innerText(), /最後の書き出しから14日たちました/);
        assert.deepEqual(await remind().locator('.btn').allInnerTexts(), ['書き出す', 'あとで']);
        assert.equal(await remind().locator('.btn.primary').count(), 0);
        assert.equal(await remind().evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(23, 25, 28)'); // --surface
        assert.ok(await noHScroll(page));
        assert.equal(await page.locator('.cell').count(), 32);
      });
      await home({ lastExportAt: n - 21 * DAY, lastChangeAt: n - DAY });
      await shot(page, '24-home-remind', width);
      await page.getByRole('button', { name: 'あとで' }).click();
      await check(`${tag} 18e ［あとで］で消え、7日間出さない（再読み込み後も）`, async () => {
        assert.equal(await remind().count(), 0);
        const until = (await settingsOf(page)).remindSnoozeUntil;
        assert.ok(Math.abs(until - (Date.now() + 7 * DAY)) < 60_000, String(until - Date.now()));
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1');
        await page.reload();
        assert.equal(await remind().count(), 0);
      });
      await home({ remindSnoozeUntil: Date.now() - 1 });
      await check(`${tag} 18e スヌーズの期限が過ぎるとまた出る`, async () => assert.equal(await remind().count(), 1));
      const out = await downloadVia(page, () => page.getByRole('button', { name: '書き出す', exact: true }).click());
      await page.waitForFunction(() => !document.querySelector('.remind'), null, { timeout: 4000 }).catch(() => {}); // 消えなければ次の check が落とす
      await check(`${tag} 18e ［書き出す］: 設定へ移らず帯から書き出し、帯が消えて lastExportAt が更新される`, async () => {
        assert.match(out.name, FILE_RE);
        assert.deepEqual(JSON.parse(out.text), await stored(page));
        assert.equal(await hash(page), '#/');
        assert.ok(Math.abs((await settingsOf(page)).lastExportAt - Date.now()) < 60_000);
        assert.deepEqual(await toast(page), ['書き出しました']);
        await page.reload();
        assert.equal(await remind().count(), 0);
      });
      await home({ lastExportAt: null, lastChangeAt: n, firstChangeAt: n - 13 * DAY });
      await check(`${tag} 18e 未書き出し: 最初の変更から13日では出ない`, async () => assert.equal(await remind().count(), 0));
      await home({ firstChangeAt: n - 15 * DAY });
      await check(`${tag} 18e 未書き出し: 記録があり15日経てば出る（文言は「まだ一度も」）`, async () => {
        assert.match(await remind().innerText(), /まだ一度も書き出していません/);
      });
      await check(`${tag} 18e ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();

      // 記録が0件なら、未書き出しでは出ない
      const empty = await newPage(width);
      await empty.evaluate((n0) => localStorage.setItem('sf6memo.settings', JSON.stringify({ firstChangeAt: n0 - 30 * 86_400_000, lastChangeAt: n0 })), Date.now());
      await empty.reload();
      await check(`${tag} 18e 未書き出しでも記録が0件なら出ない`, async () => assert.equal(await empty.locator('.remind').count(), 0));
      await empty.context().close();
    }

    // 18f 保存データの読み込みエラー（読み取り専用）の救済
    {
      const seed = seedState();
      const page = await newPage(width);
      await page.evaluate(() => localStorage.setItem('sf6memo.data', '{broken'));
      await page.reload();
      await gotoHash(page, '#/settings');
      await check(`${tag} 18f 読み込みエラー: ［保存データをそのまま書き出す］が出て、通常の書き出しは出ない`, async () => {
        assert.equal(await page.getByRole('button', { name: '保存データをそのまま書き出す' }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'JSONを書き出す' }).count(), 0);
        assert.match(await page.locator('.banners .err').innerText(), /保存データを読み込めませんでした（データは変更していません）/);
        assert.ok(await noHScroll(page));
      });
      await shot(page, '25-settings-loaderror', width);
      const raw = await downloadVia(page, () => page.getByRole('button', { name: '保存データをそのまま書き出す' }).click());
      await check(`${tag} 18f 生の文字列がそのままファイルになる（lastExportAt は更新しない）`, async () => {
        assert.equal(raw.text, '{broken');
        assert.match(raw.name, /^sf6-memo-raw-\d{8}-\d{4}\.json$/);
        assert.equal((await settingsOf(page))?.lastExportAt ?? null, null);
      });
      await importFile(page, { ...exportDoc(seed), app: 'x' });
      const badText = await errText(page, /appが一致しません/);
      await check(`${tag} 18f 不正なファイルでは読み取り専用のまま、生の保存データも変わらない`, async () => {
        assert.match(badText, /appが一致しません/);
        assert.equal(await storedRaw(page), '{broken');
        assert.equal(await page.locator('.banners .err').count(), 1);
      });
      // 保存に失敗したら、読み取り専用に戻って生データを残す
      await importFile(page, exportDoc(seed));
      await page.waitForSelector('.sheet');
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
      await page.getByRole('button', { name: '取り込む', exact: true }).click();
      await gone(page);
      await check(`${tag} 18f 取り込みの保存に失敗しても、読み取り専用のまま（生データを残す）`, async () => {
        const t = await page.locator('.banners').innerText();
        assert.match(t, /保存データを読み込めませんでした/);
        assert.match(t, /保存できませんでした/);
        assert.match(t, /取り込みは保存されませんでした。保存領域を確認してください。/);
        assert.doesNotMatch(t, /入力内容はこの画面に残っています/);
        assert.equal(await storedRaw(page), '{broken');
        assert.equal(await page.getByRole('button', { name: 'JSONを書き出す' }).count(), 0);
        assert.deepEqual(await toast(page), []);
      });
      await page.reload();
      await gotoHash(page, '#/settings');
      await importFile(page, exportDoc(seed));
      await page.waitForSelector('.sheet');
      await check(`${tag} 18f 確認シートに「置き換える」旨と件数が出る`, async () => {
        const t = await sheetText(page);
        assert.match(t, /記録 追加 3件 ／ 更新 0件 ／ 変更なし 0件 セクション 追加 3件 ／ 更新 0件 ／ 変更なし 0件/);
        assert.match(t, /現在の保存データは読み込めないため、取り込んだ内容で置き換えます/);
      });
      await shot(page, '26-import-confirm-replace', width);
      await page.getByRole('button', { name: '取り込む', exact: true }).click();
      await gone(page);
      await check(`${tag} 18f 取り込むと読み取り専用が解除され、保存データが取り込んだ文書になる`, async () => {
        assert.equal(await page.locator('.banners').count(), 0);
        assert.deepEqual(await stored(page), exportDoc(seed));
        assert.equal(await page.getByRole('button', { name: 'JSONを書き出す' }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: '保存データをそのまま書き出す' }).count(), 0);
      });
      await check(`${tag} 18f 解除後の編集が保存できる`, async () => {
        await gotoHash(page, '#/c/ryu');
        await page.getByRole('button', { name: 'セクション', exact: true }).click();
        await page.getByRole('button', { name: 'スタン' }).click();
        await gone(page);
        assert.ok((await stored(page)).sections.some((s) => s.name === 'スタン'));
        await page.reload();
        assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め', 'スタン']);
      });
      await check(`${tag} 18f ページエラーなし`, async () => assert.deepEqual(page.errors.filter((e) => !/quota|full/i.test(e)), []));
      await page.context().close();
    }

    // 18g APK内（Capacitor）の書き出し: Filesystem.writeFile（CACHE）＋Share.share。<a download> は使わない
    {
      const stub = () => {
        window.__cap = { writes: [], shares: [], cancel: false, failWrite: false };
        window.Capacitor = {
          isNativePlatform: () => true,
          Plugins: {
            Filesystem: { async writeFile(o) { if (window.__cap.failWrite) throw new Error('disk full'); window.__cap.writes.push(o); return { uri: `file:///cache/${o.path}` }; } },
            Share: { async share(o) { window.__cap.shares.push(o); if (window.__cap.cancel) throw new Error('Share canceled'); return {}; } },
          },
        };
      };
      const seed = seedState();
      const page = await newPage(width, seed, {}, stub);
      let downloads = 0;
      page.on('download', () => downloads++);
      await gotoHash(page, '#/settings');
      const cap = () => page.evaluate(() => window.__cap);
      const exportBtn = page.getByRole('button', { name: 'JSONを書き出す' });
      await page.evaluate(() => { window.__cap.cancel = true; });
      await exportBtn.click();
      await page.waitForFunction(() => window.__cap.shares.length === 1);
      await page.waitForTimeout(150);
      await check(`${tag} 18g 共有シートを閉じた（Share canceled）: 失敗扱いにせず、lastExportAt は更新しない・トーストなし`, async () => {
        assert.equal(await page.locator('.set-err .err').count(), 0);
        assert.equal(await page.locator('#toast .toast').count(), 0);
        assert.equal(await settingsOf(page).then((s) => s?.lastExportAt ?? null), null);
        assert.equal(await exportBtn.isDisabled(), false);
      });
      await page.evaluate(() => { window.__cap.cancel = false; window.__cap.failWrite = true; });
      await exportBtn.click();
      await check(`${tag} 18g 書き込みの失敗: その場に理由を表示し、lastExportAt は更新しない`, async () => {
        const t = await errText(page, /disk full/);
        assert.match(t, /書き出せませんでした.*disk full/);
        assert.equal(await settingsOf(page).then((s) => s?.lastExportAt ?? null), null);
      });
      await page.evaluate(() => { window.__cap.failWrite = false; });
      const t0 = Date.now();
      await exportBtn.click();
      await page.waitForSelector('#toast .toast');
      await check(`${tag} 18g ネイティブ経路で書き出す: CACHE・utf8・ファイル名・Shareにuri・ダウンロードなし・lastExportAt更新`, async () => {
        const c = await cap();
        assert.equal(c.writes.length, 2); // キャンセルのときも書き込みまでは行う（共有シートを閉じただけ）。失敗した書き込みは数えない
        const w = c.writes.at(-1);
        assert.equal(w.directory, 'CACHE');
        assert.equal(w.encoding, 'utf8');
        assert.match(w.path, FILE_RE);
        assert.deepEqual(JSON.parse(w.data), exportDoc(seed));
        assert.deepEqual(c.shares.at(-1).files, [`file:///cache/${w.path}`]);
        assert.equal(downloads, 0);
        assert.ok((await settingsOf(page)).lastExportAt >= t0);
        assert.deepEqual(await toast(page), ['書き出しました']);
        assert.equal(await page.locator('.set-err .err').count(), 0);
      });
      await check(`${tag} 18g ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }
  }

  // 20. T-018（D-013）: パッドの4段・前ステ/バクステ・強度なし・ヘルプマーク・データ版2
  {
    const aria = (page, name) => page.getByRole('button', { name, exact: true });
    const chipsOf = (page) => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label').split('、')[0])); // コマンド部分だけを見る（技名は24章。読み上げ名は「コマンド、技名」の順）
    const draftTokens = async (page) => JSON.parse(await storedRaw(page, 'sf6memo.drafts'))['new:s1'].tokens;
    const rowDom = (page, sel = '.cmd .row') => page.$eval(sel, normRow);

    // 20a パッドの4段目（前ステ・バクステ、強度なし）と、パッドを開いたときの余白
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/new?s=s1');
      const r = await page.evaluate(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
        const keys = (sel) => [...document.querySelectorAll(sel)];
        return {
          pad: box(document.querySelector('.pad')), dirs: box(document.querySelector('.dirs')), dk: keys('.dkey').map(box),
          steps: keys('.steps .key').map((e) => ({ ...box(e), label: e.getAttribute('aria-label'), text: e.textContent.trim(), band: getComputedStyle(e, '::before').borderTopStyle, bandH: getComputedStyle(e, '::before').height })),
          nk: keys('.nkey').map((e) => ({ ...box(e), label: e.getAttribute('aria-label'), text: e.textContent.trim(), dot: e.querySelector('.dot').getBoundingClientRect().width, col: getComputedStyle(e.querySelector('.dot')).color, tcol: getComputedStyle(e.querySelector('.nkey-t')).color })),
          btns: keys('.btns .key').length, lower: box(document.querySelector('.lower')),
          cmdBottom: document.querySelector('.cmd').getBoundingClientRect().bottom, secTop: document.querySelector('#f-sec').getBoundingClientRect().top,
        };
      });
      await check(`${tag} 20a 方向パッドの真下に［バクステ｜前ステ］（aria-labelはバックステップ・前ステップ、44以上、下端の帯は破線）`, async () => {
        assert.deepEqual(r.steps.map((s) => s.label), ['バックステップ', '前ステップ']);
        assert.deepEqual(r.steps.map((s) => s.text), ['バクステ', '前ステ']);
        for (const s of r.steps) {
          assert.ok(s.w >= 44 && s.h >= 44, JSON.stringify(s));
          assert.ok(s.y >= r.dk.at(-1).b && Math.abs(s.y - r.dk.at(-1).b - 6) < 1.5, JSON.stringify(s)); // 方向キーの真下（間隔6）
          assert.equal(`${s.band} ${s.bandH}`, 'dashed 0px');
        }
        assert.ok(Math.abs(r.steps[0].x - r.dirs.x) < 1 && Math.abs(r.steps[1].r - r.dirs.r) < 1);
        if (width === 360) assert.ok(r.steps.every((s) => Math.abs(s.w - 68) < 1 && s.h === 46), JSON.stringify(r.steps));
      });
      await check(`${tag} 20a 右の4段目に［●P 強度なし｜●K 強度なし］（灰色の●30px＋「強度なし」、44以上）`, async () => {
        assert.deepEqual(r.nk.map((s) => s.label), ['P 強度なし', 'K 強度なし']);
        for (const s of r.nk) {
          assert.equal(s.text, '強度なし');
          assert.ok(s.w >= 44 && s.h >= 44 && s.dot === 30, JSON.stringify(s));
          assert.equal(s.col, 'rgb(133, 133, 133)');
          assert.equal(s.tcol, 'rgb(170, 166, 157)');
        }
        if (width === 360) assert.ok(r.nk.every((s) => Math.abs(s.w - 96) < 1 && s.h === 46), JSON.stringify(r.nk));
        assert.ok(Math.abs(r.nk[0].y - r.steps[0].y) < 1.5, '4段目は［バクステ｜前ステ］と同じ段');
        assert.ok(r.nk[0].y > r.btns && r.nk[1].r <= r.pad.r, JSON.stringify(r.nk));
        assert.equal(r.lower.h, 202);
      });
      await check(`${tag} 20a パッドを開いたとき、コマンド列の下端と #f-sec の上端がパッドの上端より上にある`, async () => {
        assert.ok(r.cmdBottom <= r.pad.y && r.secTop <= r.pad.y, JSON.stringify([r.cmdBottom, r.secTop, r.pad.y]));
      });
      await check(`${tag} 20a トーストはパッドの上に出る（--pad-h を使う）`, async () => {
        await aria(page, 'OD P').click(); // モーションなしのOD: 通知のトーストが出る
        await page.waitForSelector('#toast .toast');
        const pos = await page.evaluate(() => [document.querySelector('#toast .toast').getBoundingClientRect().bottom, document.querySelector('.pad').getBoundingClientRect().top]);
        assert.ok(pos[0] <= pos[1] - 8, JSON.stringify(pos));
      });
      await check(`${tag} 20a ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 20b 前ステ・バクステ: 1タップ、▶でつながる、CHが付く、保存→再読み込みで同じDOM、書き出し→取り込みで一致
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/new?s=s1');
      await aria(page, '前ステップ').click();
      await check(`${tag} 20b 前ステが1タップで入る（chip sys sys-mv、aria-label「前ステ」、破線の枠）`, async () => {
        assert.deepEqual(await chipsOf(page), ['前ステ']);
        assert.equal(await page.locator('.cmd .chip').getAttribute('class'), 'chip sys sys-mv');
        assert.equal(await page.locator('.cmd .chip').evaluate((e) => getComputedStyle(e).borderTopStyle), 'dashed');
        assert.deepEqual(await draftTokens(page), [{ type: 'move', id: 'FWD_STEP' }]);
        await page.waitForFunction(() => document.getElementById('live').textContent === '追加: 前ステ');
      });
      await aria(page, 'バックステップ').click();
      await check(`${tag} 20b バクステも1タップで入り、前ステと▶でつながる`, async () => {
        assert.deepEqual(await chipsOf(page), ['前ステ', 'バクステ']);
        assert.equal(await page.locator('.cmd .conn').count(), 1);
      });
      await aria(page, 'カウンターヒット').click();
      await aria(page, '前ステップ').click();
      await aria(page, '弱P').click();
      await check(`${tag} 20b CHが前ステに付く（注記は直後の行動のタグ）。弱Pとも▶でつながる`, async () => {
        assert.deepEqual(await chipsOf(page), ['前ステ', 'バクステ', '前ステ', '立ち弱P']);
        assert.equal(await page.locator('.cmd .grp:has(.chip[aria-label="前ステ"]) .tag').count(), 1);
        assert.equal(await page.locator('.cmd .grp').nth(2).locator('.tag, .chip').evaluateAll((e) => e.map((x) => x.getAttribute('aria-label'))).then((a) => a.join()), 'CH,前ステ');
        assert.equal(await page.locator('.cmd .conn').count(), 3);
        assert.deepEqual(await draftTokens(page), [{ type: 'move', id: 'FWD_STEP' }, { type: 'move', id: 'BACK_STEP' }, { type: 'note', id: 'CH' }, { type: 'move', id: 'FWD_STEP' }, { type: 'normal', stance: 'stand', key: 'P', str: 'L' }]);
      });
      await shot(page, '40-edit-steps', width);
      const typedDom = await rowDom(page);
      await page.getByLabel('タイトル（任意）').fill('ステップ');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction(() => /^#\/c\/ryu\/r\/[0-9a-f]{32}$/.test(location.hash));
      const original = await stored(page);
      await page.reload();
      await check(`${tag} 20b 保存→再読み込みで、詳細のコマンド列が入力直後と同じDOM。保存データは版2`, async () => {
        await page.waitForSelector('.d-cmd .row');
        assert.equal(await page.$eval('.d-cmd .row', normRow), typedDom);
        assert.equal(original.schemaVersion, 2);
        assert.equal(original.combos.find((c) => c.title === 'ステップ').tokens.length, 5);
      });
      await shot(page, '41-detail-steps', width);
      await gotoHash(page, '#/settings');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONを書き出す' }).click()]);
      const text = readFileSync(await dl.path(), 'utf8');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('input[type=file]').setInputFiles({ name: 'in.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await page.waitForSelector('.sheet');
      await page.getByRole('button', { name: '取り込む', exact: true }).click();
      await page.waitForSelector('.sheet', { state: 'detached' });
      await check(`${tag} 20b 書き出し（版2）→全削除→取り込みで、前ステ・バクステを含む記録が一致する`, async () => {
        assert.equal(JSON.parse(text).schemaVersion, 2);
        const now = await stored(page);
        assert.deepEqual(now.combos, original.combos);
        assert.deepEqual(now.sections, original.sections);
      });
      await check(`${tag} 20b ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 20c 強度なし: 入力・aria-label・バッジなし・ポップオーバー
    {
      const page = await newPage(width, seedState(), {}, () => localStorage.setItem('sf6memo.settings', JSON.stringify({ strengthLabels: true })));
      await gotoHash(page, '#/c/ryu/new?s=s1');
      await aria(page, '下').click();
      await aria(page, 'P 強度なし').click();
      await aria(page, '波動 236').click();
      await aria(page, 'K 強度なし').click();
      await aria(page, '弱P').click(); // 補助文字がオンであることの対照（弱Pにはバッジが出る）
      await check(`${tag} 20c ↓→●P（強度なし）は {normal, crouch, P, N}、236→●K（強度なし）は {special, 236, K, N}。aria-labelは「屈P」「波動 ↓↘→ K」`, async () => {
        assert.deepEqual(await chipsOf(page), ['屈P', '波動 ↓↘→ K', '立ち弱P']);
        const t = await draftTokens(page);
        assert.deepEqual(t.slice(0, 2), [{ type: 'normal', stance: 'crouch', key: 'P', str: 'N' }, { type: 'special', motion: '236', key: 'K', str: 'N' }]);
      });
      await check(`${tag} 20c 補助文字オンでも強度なしの●にバッジが出ない（弱Pには出る）。●は灰色`, async () => {
        assert.equal(await page.locator('.cmd .str-labels').count(), 1);
        assert.equal(await page.locator('.cmd .dot.str-n').count(), 2);
        assert.equal(await page.locator('.cmd .dot.str-n .badge').count(), 0);
        assert.equal(await page.locator('.cmd .dot.str-n.has-str').count(), 0);
        assert.equal(await page.locator('.cmd .dot.str-l .badge').count(), 1);
        assert.deepEqual(await page.$$eval('.cmd .dot.str-n', (e) => e.map((x) => getComputedStyle(x).color)), ['rgb(133, 133, 133)', 'rgb(133, 133, 133)']);
      });
      await page.locator('.cmd .chip').first().click();
      await check(`${tag} 20c ポップオーバー（通常技）: 強度は［弱］［中］［強］［●（強度なし）］。現在値は強度なし。各44以上`, async () => {
        const o = await page.locator('.popover .pop-row').first().locator('.opt').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), e.getAttribute('aria-pressed'), b.width, b.height]; }));
        assert.deepEqual(o.map((x) => x.slice(0, 2)), [['弱', 'false'], ['中', 'false'], ['強', 'false'], ['強度なし', 'true']]);
        assert.ok(o.every((x) => x[2] >= 44 && x[3] >= 44), JSON.stringify(o));
        assert.equal(await page.locator('.popover .opt[aria-label="強度なし"] .dot.str-n').count(), 1);
        assert.equal(await page.locator('.popover .opt[aria-label="強度なし"]').innerText(), '');
      });
      await shot(page, '42-popover-normal', width);
      await page.locator('.popover .opt[aria-label="強"]').click();
      await check(`${tag} 20c ポップオーバーで強度なしを強に変更できる`, async () => {
        await page.waitForSelector('.popover', { state: 'detached' });
        assert.deepEqual(await chipsOf(page), ['屈強P', '波動 ↓↘→ K', '立ち弱P']);
      });
      await page.locator('.cmd .chip').nth(1).click();
      await check(`${tag} 20c ポップオーバー（必殺技）は5択［弱］［中］［強］［強度なし］［OD］。.optの左右paddingは4px、各44以上`, async () => {
        const o = await page.locator('.popover .pop-row').first().locator('.opt').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [e.getAttribute('aria-label'), b.width, b.height, cs.paddingLeft, cs.paddingRight]; }));
        assert.deepEqual(o.map((x) => x[0]), ['弱', '中', '強', '強度なし', 'OD']);
        assert.ok(o.every((x) => x[1] >= 44 && x[2] >= 44 && x[3] === '4px' && x[4] === '4px'), JSON.stringify(o));
        assert.ok(await noHScroll(page));
      });
      await shot(page, '43-popover-special', width);
      await page.locator('.popover .opt[aria-label="強度なし"]').click();
      await page.locator('.popover').waitFor({ state: 'detached' });
      await page.locator('.cmd .chip').nth(1).click();
      await page.locator('.popover .opt[aria-label="OD"]').click();
      await check(`${tag} 20c 強度なしの必殺技をODに変更できる（強度なしへも戻せる）`, async () => {
        await page.locator('.popover').waitFor({ state: 'detached' });
        assert.deepEqual(await chipsOf(page), ['屈強P', 'OD 波動 ↓↘→ K', '立ち弱P']);
        assert.deepEqual((await draftTokens(page))[1], { type: 'special', motion: '236', key: 'K', str: 'OD' });
      });
      await check(`${tag} 20c ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 20d ヘルプマーク（詳細・編集の上部バー、設定の［凡例を見る］）と凡例の追加行
    {
      const page = await newPage(width, seedState());
      for (const [h, name] of [['#/c/ryu/r/c1', '詳細'], ['#/c/ryu/r/c1/edit', '編集']]) {
        await gotoHash(page, h);
        await check(`${tag} 20d ${name}の上部バー: 文字の［凡例］がなく、44×44以上の button[aria-label="凡例を開く"]（記号24px、muted）がある`, async () => {
          assert.equal(await page.locator('.topbar').getByText('凡例', { exact: true }).count(), 0);
          const b = page.locator('.topbar button[aria-label="凡例を開く"]');
          assert.equal(await b.count(), 1);
          const r = await b.evaluate((e) => { const x = e.getBoundingClientRect(); const s = e.querySelector('svg').getBoundingClientRect(); return [x.width, x.height, s.width, s.height, getComputedStyle(e).color, e.querySelector('use').getAttribute('href'), e.className]; });
          assert.deepEqual(r, [44, 44, 24, 24, 'rgb(170, 166, 157)', '#i-help', 'icon-btn help']);
          assert.ok(await noHScroll(page));
        });
        await shot(page, name === '詳細' ? '44-help-detail' : '45-help-edit', width);
      }
      await page.locator('button[aria-label="凡例を開く"]').click();
      await page.waitForSelector('.sheet.tall');
      await check(`${tag} 20d 凡例に灰色の●P（強度なし、書き出し「P」）と「移動」群（前ステ・バクステ、破線の枠）がある`, async () => {
        await page.waitForTimeout(300);
        const t = await page.locator('.leg').innerText();
        for (const w of ['移動', '前ステップ', 'バックステップ', '強度なし']) assert.ok(t.includes(w), w);
        assert.equal(await page.locator('.leg .dot.str-n').count(), 1);
        assert.equal(await page.locator('.leg .dot.str-n').evaluate((e) => getComputedStyle(e).color), 'rgb(133, 133, 133)');
        assert.deepEqual(await page.locator('.leg .sys-mv').evaluateAll((e) => e.map((x) => [x.getAttribute('aria-label'), getComputedStyle(x).borderTopStyle])), [['前ステ', 'dashed'], ['バクステ', 'dashed']]);
        const row = (label) => page.locator('.leg tr', { has: page.locator(`[aria-label="${label}"]`) }).locator('.leg-out').innerText();
        assert.equal(await row('前ステ'), '前ステ');
        assert.equal(await row('バクステ'), 'バクステ');
        assert.equal(await page.locator('.leg tr', { has: page.locator('.dot.str-n') }).locator('.leg-out').innerText(), 'P');
        assert.equal(await page.locator('.leg tbody').filter({ hasText: '移動' }).locator('.leg-g').innerText(), '移動');
        assert.ok(await noHScroll(page));
      });
      await shot(page, '46-legend-gray-move', width);
      await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();
      await check(`${tag} 20d 凡例を閉じるとフォーカスがヘルプマークに戻る（編集画面）`, async () => {
        await page.waitForSelector('.sheet', { state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '凡例を開く');
      });
      await gotoHash(page, '#/settings');
      await check(`${tag} 20d 設定の［凡例を見る］は先頭に i-help（20px）が付き、押すと凡例が開く`, async () => {
        const b = page.getByRole('button', { name: '凡例を見る' });
        assert.deepEqual(await b.evaluate((e) => [e.firstElementChild.querySelector('use').getAttribute('href'), e.firstElementChild.getBoundingClientRect().width, e.textContent]), ['#i-help', 20, '凡例を見る']);
        await b.click();
        assert.equal(await page.locator('.sheet h2').innerText(), '凡例');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.sheet', { state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.fk), 'legend');
      });
      await shot(page, '47-settings', width);
      await check(`${tag} 20d ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 20e データの版: 版1はそのまま読めて、保存後は版2。版3は読み込みエラー（読み取り専用、既存値を上書きしない）
    {
      const seed = seedState();
      const v1 = { ...exportDoc(seed), schemaVersion: 1 };
      const page = await newPage(width, null);
      await page.evaluate((d) => localStorage.setItem('sf6memo.data', JSON.stringify(d)), v1);
      await page.reload();
      await gotoHash(page, '#/c/ryu');
      await check(`${tag} 20e 版1のデータで起動でき、エラー帯なしで一覧が出る`, async () => {
        assert.equal(await page.locator('.banners').count(), 0);
        assert.equal(await page.locator('.item').count(), 3);
        assert.equal((await stored(page)).schemaVersion, 1); // 読んだだけでは書き換えない
      });
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      await page.getByLabel('タイトル（任意）').fill('版1から編集');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction(() => location.hash === '#/c/ryu/r/c1');
      await check(`${tag} 20e 編集・保存の後は版2になり、記録は失われない`, async () => {
        const d = await stored(page);
        assert.equal(d.schemaVersion, 2);
        assert.equal(d.combos.length, 3);
        assert.equal(d.combos.find((c) => c.id === 'c1').title, '版1から編集');
        assert.deepEqual(d.combos.find((c) => c.id === 'c2'), seed.combos[1]);
      });
      await page.context().close();

      const v3 = JSON.stringify({ ...exportDoc(seed), schemaVersion: 3 });
      const p3 = await newPage(width, null);
      await p3.evaluate((t) => localStorage.setItem('sf6memo.data', t), v3);
      await p3.reload();
      await check(`${tag} 20e 版3は読み込みエラー（理由を表示、読み取り専用、保存データを上書きしない）`, async () => {
        const t = await p3.locator('.banners').innerText();
        assert.match(t, /保存データを読み込めませんでした/);
        assert.match(t, /新しい版\(schemaVersion 3\)/);
        assert.match(t, /読み取り専用/);
        await gotoHash(p3, '#/c/ryu');
        assert.equal(await p3.locator('.bottombar').count(), 0); // 記録・セクションの追加はできない
        assert.equal(await storedRaw(p3), v3);
        assert.match(await p3.locator('.empty').innerText(), /記録はありません/);
      });
      await check(`${tag} 20e ページエラーなし`, async () => assert.deepEqual(p3.errors, []));
      await p3.context().close();

      // 取り込み: 版1のファイルは受け付け（確認シートが開く）、版3は拒否（データ不変）
      const imp = await newPage(width, seedState());
      await gotoHash(imp, '#/settings');
      const before = await storedRaw(imp);
      await imp.locator('input[type=file]').setInputFiles({ name: 'v3.json', mimeType: 'application/json', buffer: Buffer.from(v3) });
      await check(`${tag} 20e 取り込み: 版3のファイルは「新しい版」で拒否され、データは変わらない`, async () => {
        await imp.waitForFunction(() => /新しい版\(schemaVersion 3\)/.test(document.querySelector('.set-err')?.textContent ?? ''));
        assert.equal(await storedRaw(imp), before);
      });
      const extra = { ...exportDoc({ sections: [sec('x1', 'ken', '通常', 0)], combos: [] }), schemaVersion: 1 };
      await imp.locator('input[type=file]').setInputFiles({ name: 'v1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(extra)) });
      await imp.waitForSelector('.sheet');
      await check(`${tag} 20e 取り込み: 版1のファイルは受け付けられ、取り込み後の保存データは版2`, async () => {
        assert.match(await imp.locator('.sheet').innerText(), /追加 1件/);
        await imp.getByRole('button', { name: '取り込む', exact: true }).click();
        await imp.waitForSelector('.sheet', { state: 'detached' });
        const d = await stored(imp);
        assert.equal(d.schemaVersion, 2);
        assert.equal(d.sections.some((s) => s.id === 'x1'), true);
      });
      await imp.context().close();
    }
  }

  // 21. T-019（D-013。design-spec-v2.1 1・5章）、T-021（D-016）: カナの削除・蛍光グリーンの10段階・ブランドロゴ・性能
  {
    // 1.2の表（正本）。rgb=発光色、tc=ワードマーク・最近使ったキャラの文字色、plate=板の地（発光色を段階×2%だけ --surface に混ぜた値）、
    // 文字の影は blur=l×0.6px・alpha=l×0.05、板の滲みは inset の blur=4+l×0.8px・spread=l×0.6px・alpha=0.12+l×0.055（computed は alpha が8bitに丸められる）
    const TABLE = [
      { rgb: null },
      { rgb: [150, 196, 164], tc: [201, 221, 207], plate: [26, 28, 31], sh: [0.05, 0.6], np: [0.176, 4.8, 0.6] },
      { rgb: [120, 204, 148], tc: [189, 230, 201], plate: [27, 32, 33], sh: [0.1, 1.2], np: [0.23, 5.6, 1.2] },
      { rgb: [98, 216, 138], tc: [174, 239, 194], plate: [27, 36, 35], sh: [0.15, 1.8], np: [0.286, 6.4, 1.8] },
      { rgb: [84, 228, 130], tc: [160, 245, 184], plate: [28, 41, 36], sh: [0.2, 2.4], np: [0.34, 7.2, 2.4] },
      { rgb: [77, 242, 124], tc: [150, 247, 176], plate: [28, 47, 38], sh: [0.25, 3], np: [0.396, 8, 3] },
      { rgb: [77, 242, 124], tc: [168, 249, 190], plate: [29, 51, 40], sh: [0.3, 3.6], np: [0.45, 8.8, 3.6] },
      { rgb: [82, 246, 128], tc: [186, 251, 203], plate: [31, 56, 42], sh: [0.35, 4.2], np: [0.506, 9.6, 4.2] },
      { rgb: [90, 250, 134], tc: [203, 252, 216], plate: [34, 61, 45], sh: [0.4, 4.8], np: [0.56, 10.4, 4.8] },
      { rgb: [102, 252, 142], tc: [218, 253, 227], plate: [37, 66, 49], sh: [0.45, 5.4], np: [0.616, 11.2, 5.4] },
      { rgb: [118, 255, 154], tc: [232, 255, 238], plate: [42, 71, 53], sh: [0.5, 6], np: [0.67, 12, 6] },
    ];
    const want = (lv) => {
      const t = TABLE[lv];
      if (!t.rgb) return { color: 'rgb(170, 166, 157)', tc: 'rgb(170, 166, 157)', shadow: 'none', plate: 'rgb(23, 25, 28)', glow: 'none' };
      const c = t.rgb.join(', ');
      return {
        color: 'rgb(234, 255, 240)', // --lit。タイルの英字は段階1以上で同じ色
        tc: `rgb(${t.tc.join(', ')})`,
        shadow: `rgba(${c}, ${t.sh[0]}) 0px 0px ${t.sh[1]}px`,
        plate: `rgb(${t.plate.join(', ')})`,
        glow: `rgba(${c}, ${t.np[0]}) 0px 0px ${t.np[1]}px ${t.np[2]}px inset`,
      };
    };
    // 件数 → 段階の境界（neonLevel を使わず、表を直接書く）
    const COUNT_LV = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 3], [5, 4], [7, 4], [8, 5], [11, 5], [12, 6], [17, 6], [18, 7], [27, 7], [28, 8], [44, 8], [45, 9], [69, 9], [70, 10]];
    const countsSeed = (counts) => { // counts: [[characterId, 件数], ...]。0件のキャラにはセクションも作らない
      const d = { sections: [], combos: [] };
      for (const [cid, n] of counts) {
        if (!n) continue;
        d.sections.push(sec(`s-${cid}`, cid, '通常', 0));
        for (let i = 0; i < n; i++) d.combos.push({ ...combo(`x${d.combos.length + 1}`, `s-${cid}`, `r${i}`, [N('stand', 'L', 'P')], { createdAt: T0 }), characterId: cid });
      }
      return d;
    };
    const tileStyle = (page, sel) => page.$eval(sel, (e) => {
      const en = getComputedStyle(e.querySelector('.cell-en')), b = getComputedStyle(e, '::before');
      return { lv: e.dataset.lv, color: en.color, shadow: en.textShadow, plate: b.backgroundColor, glow: b.boxShadow, filter: [en.filter, b.filter, en.backdropFilter, b.backdropFilter] };
    });
    const ids = CHARACTERS.map((c) => c.id);

    // 21a カナの削除と件数の非表示: 見えるのは英字だけ。件数は読み上げ名（aria-label）だけが伝える。読み上げ名（aria-label・h1のsr-only）はカナのまま
    {
      const page = await newPage(width, countsSeed([['ryu', 3], ['ken', 1], ['chunli', 70]]));
      await check(`${tag} 21a キャラ選択: .cell の見える文字は英字だけ（カナ・件数・メーターなし）。aria-label は「リュウ 3件」形式で0件は名前だけ`, async () => {
        const r = await page.$$eval('.cell', (els) => els.map((e) => [e.getAttribute('aria-label'), e.innerText.trim()]));
        assert.equal(r.length, 32);
        for (const [label, text] of r) assert.match(text, /^[A-Z.\- ]+$/, `${label}: ${JSON.stringify(text)}`);
        assert.equal(await page.locator('.cell-name, .kn, .cell-n, .cell-lv').count(), 0);
        const by = Object.fromEntries(r);
        assert.equal(by['リュウ 3件'], 'RYU');
        assert.equal(by['ケン 1件'], 'KEN');
        assert.equal(by['春麗 70件'], 'CHUN-LI');
        assert.equal(by['ダルシム'], 'DHALSIM');
        assert.equal(r.filter(([l]) => /^\S+ \d+件$/.test(l)).length, 3);
        assert.equal(await page.getByRole('link', { name: 'リュウ 3件', exact: true }).count(), 1); // 支援技術が件数を読める
      });
      await check(`${tag} 21a キャラ選択: 英字はタイルの縦の中央にあり全タイルで位置がそろう、タイルの高さ54、横スクロールなし`, async () => {
        const r = await page.$$eval('.cell', (els) => els.map((e) => { const t = e.getBoundingClientRect(), n = e.querySelector('.cell-en').getBoundingClientRect(); return [Math.round((n.top - t.top) * 10), t.height, Math.abs((n.top + n.height / 2) - (t.top + t.height / 2))]; }));
        assert.equal(new Set(r.map((x) => x[0])).size, 1, JSON.stringify([...new Set(r.map((x) => x[0]))]));
        assert.ok(r.every((x) => x[1] === 54 && x[2] <= 1), JSON.stringify(r[0]));
        assert.ok(await noHScroll(page));
      });
      await gotoHash(page, '#/c/ryu');
      await check(`${tag} 21a 一覧の上部バー: 見える文字は英字（.wm）だけ。h1の読み上げ名は「リュウ」（.sr-only）で、.kn はない`, async () => {
        assert.equal(await page.locator('.topbar h1 .kn').count(), 0);
        assert.equal(await page.locator('.topbar h1 .sr-only').textContent(), 'リュウ');
        assert.equal(await page.$eval('.topbar h1', (h) => { const c = h.cloneNode(true); c.querySelector('.sr-only').remove(); return c.innerText.trim(); }), 'RYU');
        assert.equal(await page.getByRole('heading', { name: 'リュウ', exact: true, level: 1 }).count(), 1);
        assert.equal(await page.locator('.topbar h1 svg').count(), 0); // ロゴはキャラ選択だけ
      });
      await page.context().close();
    }

    // 21b ネオンの段階（蛍光グリーン）: 件数 → data-lv と、英字・板・滲みの computed style が1.2の表と一致する
    {
      const counts = COUNT_LV.map(([n], i) => [ids[i], n]);
      const page = await newPage(width, countsSeed(counts));
      const found = {};
      await check(`${tag} 21b 件数 0・1・2・3・4・5・7・8・11・12・17・18・27・28・44・45・69・70 の data-lv が境界どおり`, async () => {
        for (const [i, [n, lv]] of COUNT_LV.entries()) {
          const cell = page.locator(`.cell[aria-label^="${CHARACTERS[i].name}"]`);
          assert.equal(await cell.getAttribute('data-lv'), String(lv), `${n}件`);
          found[lv] ??= `.cell[aria-label^="${CHARACTERS[i].name}"]`;
        }
        assert.equal(Object.keys(found).length, 11);
      });
      await check(`${tag} 21b 全11段階: 英字の色、text-shadow、板の地、板の縁からの滲み（inset）が表（1.2）と一致する。filterなし。0件は光なし`, async () => {
        for (let lv = 0; lv <= 10; lv++) {
          const st = await tileStyle(page, found[lv]), w = want(lv);
          assert.deepEqual([st.lv, st.color, st.shadow, st.plate, st.glow], [String(lv), w.color, w.shadow, w.plate, w.glow], `段階${lv}`);
          assert.deepEqual(st.filter, ['none', 'none', 'none', 'none']);
        }
      });
      await check(`${tag} 21b 全タイルの発光の上限: 文字の影は2層以下・ぼかし8px以下・アルファ0.8以下。板の滲みは inset の1層だけで、ぼかし12px以下・広がり6px以下（D-016）`, async () => {
        const bad = await page.$$eval('.cell', (els) => els.flatMap((c) => {
          const layers = (v) => (v === 'none' ? [] : v.split(/,(?![^(]*\))/).map((x) => x.trim()));
          const a = (x) => Number(x.match(/rgba?\(([^)]*)\)/)[1].split(',')[3] ?? 1), nums = (x) => x.replace(/rgba?\([^)]*\)/, '').replace('inset', '').trim().split(/\s+/).map(parseFloat);
          const ts = layers(getComputedStyle(c.querySelector('.cell-en')).textShadow), bs = layers(getComputedStyle(c, '::before').boxShadow);
          return [...(ts.length > 2 ? ['文字の影が3層以上'] : []), ...ts.filter((x) => a(x) > 0.8 || nums(x)[2] > 8).map((x) => `文字の影が上限超え ${x}`),
            ...(bs.length > 1 ? ['板の影が2層以上'] : []), ...bs.filter((x) => !x.includes('inset') || nums(x)[2] > 12 || nums(x)[3] > 6 || a(x) > 0.7).map((x) => `板の滲みが上限超え ${x}`)];
        }));
        assert.deepEqual(bad, []);
      });
      await check(`${tag} 21b 文字と板の比: 英字（段階10でも）が滲みを含む実際の画素の上で 4.5:1 以上（英字を透明にして、字の範囲の最も明るい画素を実測）。実測値を出力`, async () => {
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const out = [];
        await page.addStyleTag({ content: '.cell-en { color: transparent !important; }' }); // 影は残す（字の下にある画素そのもの）
        for (let lv = 0; lv <= 10; lv++) {
          const box = await page.$eval(found[lv], (e) => { const r = document.createRange(); r.selectNodeContents(e.querySelector('.cell-en')); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
          const png = await page.screenshot({ clip: box });
          const maxPx = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data; let best = [0, 0, 0], bl = -1;
            const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]); if (l > bl) { bl = l; best = [d[i], d[i + 1], d[i + 2]]; } }
            return best;
          }, png.toString('base64'));
          const fg = lv ? [234, 255, 240] : [170, 166, 157];
          const r = (lum(fg) + 0.05) / (lum(maxPx) + 0.05);
          out.push(`${lv}:${r.toFixed(2)}`);
          assert.ok(r >= 4.5, `段階${lv}: ${r.toFixed(2)} (最も明るい画素 ${maxPx})`);
        }
        console.log(`e2e: 21b ${tag} 文字と板（滲み込み）の最小比 段階:比 ${out.join(' ')}`);
      });
      await page.reload(); // 透明にした英字を戻す
      await page.waitForSelector('.grid');
      await check(`${tag} 21b 押下中: 板だけが --line になり（即時）、英字の色と滲みは変わらない（段階1・5）`, async () => {
        for (const lv of [1, 5]) {
          const t = page.locator(found[lv]);
          const bb = await t.boundingBox();
          await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
          await page.mouse.down();
          const down = await t.evaluate((e) => [getComputedStyle(e.querySelector('.cell-en')).color, getComputedStyle(e.querySelector('.cell-en')).textShadow, getComputedStyle(e, '::before').backgroundColor, getComputedStyle(e, '::before').boxShadow, getComputedStyle(e, '::before').transitionDuration]);
          await page.mouse.move(0, 0);
          await page.mouse.up();
          assert.deepEqual(down, [want(lv).color, want(lv).shadow, 'rgb(46, 50, 56)', want(lv).glow, '0s'], `段階${lv}`);
        }
      });
      await page.waitForTimeout(700); // 起動時の点灯を終える
      await shot(page, '48-home-levels', width);
      await check(`${tag} 21b 英字がタイルに収まり、横スクロールなし`, async () => {
        assert.deepEqual(await page.$$eval('.cell-en', (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent)), []);
        assert.ok(await noHScroll(page));
      });
      // 最近使ったキャラの英字と、一覧のワードマーク（0件は消灯）
      for (const id of ['ryu', 'luke', 'jamie']) { // ryu=0件、luke=1件、jamie=2件の順に開く。最近使ったキャラは新しい順で [jamie, luke, ryu]
        await page.locator(`.cell[aria-label^="${CHARACTERS.find((c) => c.id === id).name}"]`).click();
        await page.waitForFunction((x) => location.hash === `#/c/${x}`, id);
        await page.waitForSelector('.topbar h1 .wm');
        if (id === 'ryu') {
          await check(`${tag} 21b 一覧のワードマーク: 0件は muted・影なし`, async () => {
            assert.deepEqual(await page.$eval('.wm', (e) => [e.dataset.lv, getComputedStyle(e).color, getComputedStyle(e).textShadow]), ['0', 'rgb(170, 166, 157)', 'none']);
          });
        }
        if (id === 'jamie') {
          await check(`${tag} 21b 一覧のワードマーク: 2件は段階2の緑の色と影`, async () => {
            assert.deepEqual(await page.$eval('.wm', (e) => [e.dataset.lv, getComputedStyle(e).color, getComputedStyle(e).textShadow]), ['2', want(2).tc, want(2).shadow]);
          });
          await shot(page, '52-list-wordmark', width);
        }
        await page.getByRole('button', { name: 'キャラクター選択に戻る' }).click();
        await page.waitForSelector('.grid');
      }
      await check(`${tag} 21b 最近使ったキャラ: data-lv が件数の段階（0件・1件・2件）で、.rc-en は表の緑の色と影（0件は消灯）。板は --key のまま`, async () => {
        const r = await page.$$eval('.rc', (els) => els.map((e) => [e.getAttribute('aria-label'), e.dataset.lv, getComputedStyle(e.querySelector('.rc-en')).color, getComputedStyle(e.querySelector('.rc-en')).textShadow, getComputedStyle(e, '::before').backgroundColor]));
        assert.deepEqual(r, [['ジェイミー', '2', want(2).tc, want(2).shadow, 'rgb(34, 37, 42)'], ['ルーク', '1', want(1).tc, want(1).shadow, 'rgb(34, 37, 42)'], ['リュウ', '0', want(0).tc, 'none', 'rgb(34, 37, 42)']]);
      });
      await shot(page, '49-home-recent-levels', width);
      await check(`${tag} 21b ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 21c ロゴ: キャラ選択の上部バー
    {
      const page = await newPage(width, seedState());
      await check(`${tag} 21c ロゴ: キャラ選択の上部バーに .logo（34×20、aria-hidden、#i-logo）。h1の読み上げ名は「SF6戦略メモ」`, async () => {
        const r = await page.$eval('.topbar h1', (h) => { const l = h.querySelector('svg.logo'); const b = l.getBoundingClientRect(); return [h.querySelectorAll('svg').length, l.getAttribute('aria-hidden'), l.querySelector('use').getAttribute('href'), b.width, b.height, h.textContent]; });
        assert.deepEqual(r, [1, 'true', '#i-logo', 34, 20, 'SF6戦略メモ']);
        assert.equal(await page.getByRole('heading', { name: 'SF6戦略メモ', exact: true, level: 1 }).count(), 1);
        const sym = await page.$eval('#i-logo', (s) => [s.getAttribute('viewBox'), s.querySelectorAll('path').length, s.querySelectorAll('circle').length, s.innerHTML.includes('filter'), s.querySelector('path:last-of-type').getAttribute('stroke')]);
        assert.deepEqual(sym, ['77 152 358 208', 4, 3, false, 'var(--ink)']); // 管2本とP・K、●2つと縁取り
        assert.equal(await page.$eval('.logo', (e) => getComputedStyle(e).filter), 'none');
        assert.equal(await page.$eval('.topbar h1', (h) => getComputedStyle(h).fontFamily.includes('Tilt Neon')), false); // 名前の文字は和文のシステムフォント（併記しない）
      });
      await check(`${tag} 21c ロゴは実際に描かれる（上部バーの .logo の領域に橙の管、黄の●P、水色の●Kの画素がある）`, async () => {
        const bb = await page.locator('.topbar .logo').boundingBox();
        const png = await page.screenshot({ clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height } });
        const px = await page.evaluate(async (b64) => {
          const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data; let orange = 0, yellow = 0, cyan = 0;
          for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 130 && d[i + 2] < 90) orange++; if (d[i] > 200 && d[i + 1] > 190 && d[i + 2] < 150) yellow++; if (d[i] > 110 && d[i] < 180 && d[i + 1] > 180 && d[i + 2] > 210) cyan++; }
          return { orange, yellow, cyan };
        }, png.toString('base64'));
        assert.ok(px.orange >= 15 && px.yellow >= 10 && px.cyan >= 10, JSON.stringify(px));
      });
      await shot(page, '50-home-logo', width);
      await page.context().close();
    }

    // 21d 性能（360幅のみ）: 32キャラ全員が70件（段階10）。CPU 4倍・360×600でキャラ選択をスクロールして55fps以上。発光テキストは35個以下
    if (width === 360) {
      const page = await newPage(width, countsSeed(ids.map((id) => [id, 70])), { viewport: { width: 360, height: 600 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      await check(`${tag} 21d 全員70件: 32タイルすべて段階10、発光テキスト（text-shadowが非noneの要素）は35個以下、filterなし、影のアニメーションなし`, async () => {
        assert.equal(await page.locator('.cell[data-lv="10"]').count(), 32);
        const r = await page.evaluate(() => {
          const all = [...document.querySelectorAll('*')];
          return {
            glow: all.filter((e) => getComputedStyle(e).textShadow !== 'none').length,
            filt: all.filter((e) => getComputedStyle(e).filter !== 'none' || getComputedStyle(e).backdropFilter !== 'none').length,
            anim: [...new Set(document.getAnimations().map((a) => a.animationName ?? ''))],
          };
        });
        assert.ok(r.glow <= 35, `発光テキスト ${r.glow}`);
        assert.equal(r.filt, 0);
        assert.ok(r.anim.every((n) => n === 'flick' || n === 'enter'), JSON.stringify(r.anim));
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.waitForTimeout(800); // 起動時の点灯と画面の入場アニメーションを終える
      await page.evaluate(() => { window.__t = []; window.__rec = true; const f = (t) => { window.__t.push(t); if (window.__rec) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const dist = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      for (let i = 0; i < 8; i++) { // 上下に往復（ゆっくり動かして、スクロール中のフレームを十分に取る）
        await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 400, yDistance: -dist, speed: 300, gestureSourceType: 'touch' });
        await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 200, yDistance: dist, speed: 300, gestureSourceType: 'touch' });
      }
      const t = await page.evaluate(() => { window.__rec = false; return window.__t; });
      const d = t.slice(1).map((x, i) => x - t[i]), sorted = [...d].sort((a, b) => a - b);
      const st = { scrollable: dist, frames: t.length, fps: +(1000 * d.length / (t.at(-1) - t[0])).toFixed(1), p50: +sorted[Math.floor(d.length * 0.5)].toFixed(1), p95: +sorted[Math.floor(d.length * 0.95)].toFixed(1), max: +sorted.at(-1).toFixed(1) };
      console.log(`e2e: 21d フレーム時間（CPU x4、360x600、全員70件、スクロール ${dist}px を往復）`, JSON.stringify(st));
      await check(`${tag} 21d 性能: 全員70件・CPU 4倍・360×600のキャラ選択のスクロールで 55fps 以上（実測 ${st.fps}fps、p95 ${st.p95}ms）`, async () => {
        assert.ok(dist >= 100, `スクロールできる量が足りない ${dist}`);
        assert.ok(st.frames >= 120, `フレーム数が少ない ${st.frames}`);
        assert.ok(st.fps >= 55, JSON.stringify(st));
      });
      await page.context().close();
    }
  }

  // 22. T-015 修正（データ・保存）: 他タブとトースト・設定の読み直し・変更日時・下書き・巻き戻し・200手の上限
  {
    const setting = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('sf6memo.settings') ?? 'null'));
    const addSec = async (p, name) => {
      await p.getByRole('button', { name: 'セクション', exact: true }).click();
      await p.getByRole('button', { name, exact: true }).click();
      await p.waitForSelector('.sheet', { state: 'detached' });
    };
    const tabs = async (seed, hashes, blockStorage = []) => { // 同じコンテキスト（同じlocalStorage）の複数タブ。blockStorage[i] が真ならそのタブは storage イベントを受け取れない
      const ctx = await browser.newContext({ viewport: { width, height: 740 }, acceptDownloads: true });
      const ps = [];
      for (const [i, h] of hashes.entries()) {
        const p = await ctx.newPage();
        p.errors = [];
        p.on('pageerror', (e) => p.errors.push(e.message));
        if (blockStorage[i]) await p.addInitScript(() => addEventListener('storage', (e) => e.stopImmediatePropagation()));
        await p.goto(BASE);
        if (i === 0) { await p.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc(seed)); await p.reload(); } // 起動時に読ませてから画面を移す
        await gotoHash(p, h);
        ps.push(p);
      }
      return [ctx, ...ps];
    };

    // 22a A-M1: 他タブが書いたら、取り消しトーストを閉じる。残すと古いスナップショットを書き戻して他タブの変更を消す
    {
      const [ctx, a, b] = await tabs(seedState(), ['#/c/ryu/r/c3', '#/c/ryu']);
      await a.getByRole('button', { name: 'その他…' }).click();
      await a.getByRole('button', { name: '削除' }).click();
      await a.waitForSelector('#toast .toast');
      await addSec(b, 'スタン');
      await check(`${tag} 22a 他タブの変更でトースト（［元に戻す］）が閉じ、他タブの追加も削除も残る`, async () => {
        await a.waitForFunction(() => document.querySelectorAll('#toast .toast').length === 0);
        assert.equal(await a.getByRole('button', { name: '元に戻す' }).count(), 0);
        const d = await stored(a);
        assert.equal(d.sections.some((s) => s.name === 'スタン'), true);
        assert.equal(d.combos.some((c) => c.id === 'c3'), false);
      });
      await check(`${tag} 22a ページエラーなし`, async () => assert.deepEqual([...a.errors, ...b.errors], []));
      await ctx.close();
    }

    // 22b A-M3: 他タブの settings を読み直す（storageイベント）。さらに、イベントを取りこぼした古いタブの保存も、他タブが書いたキーを消さない
    {
      const [ctx, a, b, stale] = await tabs(seedState(), ['#/settings', '#/c/ryu/r/c1', '#/settings'], [false, false, true]);
      await a.getByRole('radio', { name: '数字' }).check();
      const [dl] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'JSONを書き出す' }).click()]);
      await dl.path();
      await a.waitForSelector('#toast .toast');
      await check(`${tag} 22b 他タブの表示設定が、再読み込みなしで次の描画から反映される`, async () => {
        await b.waitForTimeout(300);
        await gotoHash(b, '#/c/ryu/r/c1/edit'); // 一覧は描画のたびに settings を書き、そのとき最新を読むので、書かない画面で確かめる
        assert.ok((await b.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label')))).some((l) => /236/.test(l)), '数字表記になっている');
      });
      await stale.getByRole('radio', { name: 'オン' }).check(); // 古いタブ（表記=矢印、書き出し日なしの状態で開いたまま）が別のキーを変える
      await check(`${tag} 22b 古いタブの保存が、他タブの表記と最終書き出し日を消さない（変えたキーだけ書く）`, async () => {
        const s = await setting(a);
        assert.equal(s.strengthLabels, true);
        assert.equal(s.notation, 'numpad');
        assert.ok(Number.isSafeInteger(s.lastExportAt), String(s.lastExportAt));
      });
      await check(`${tag} 22b ページエラーなし`, async () => assert.deepEqual([...a.errors, ...b.errors, ...stale.errors], []));
      await ctx.close();
    }

    // 22c A-M4: 保存操作で settings の lastChangeAt（毎回）と firstChangeAt（初回のみ）が時刻で入る
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu');
      const t0 = Date.now();
      await addSec(page, 'スタン');
      const s1 = await setting(page);
      await page.waitForTimeout(30);
      await addSec(page, 'カウンター');
      const s2 = await setting(page);
      await check(`${tag} 22c 保存操作で lastChangeAt・firstChangeAt が現在時刻で入る`, async () => {
        assert.ok(s1.lastChangeAt >= t0 && s1.lastChangeAt <= Date.now(), String(s1.lastChangeAt));
        assert.equal(s1.firstChangeAt, s1.lastChangeAt);
      });
      await check(`${tag} 22c 2回目以降は lastChangeAt だけ進み、firstChangeAt は初回のまま`, async () => {
        assert.ok(s2.lastChangeAt > s1.lastChangeAt, `${s2.lastChangeAt} > ${s1.lastChangeAt}`);
        assert.equal(s2.firstChangeAt, s1.firstChangeAt);
      });
      await page.context().close();
    }

    // 22d A-M2: 下書きを書けなかったときは、離れても「残しました」と言わず、エラー帯も消さない
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/new?s=s1');
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
      await page.getByRole('button', { name: '中P', exact: true }).click();
      await check(`${tag} 22d 下書きの書き込みに失敗するとエラー帯が出る`, async () => assert.equal(await page.locator('.err').count(), 1));
      await gotoHash(page, '#/c/ryu');
      await check(`${tag} 22d 離れると「下書きを保存できませんでした」が出て、「下書きを残しました」は出ず、エラー帯が残る`, async () => {
        const t = await page.locator('#toast').innerText();
        assert.match(t, /下書きを保存できませんでした/);
        assert.doesNotMatch(t, /下書きを残しました/);
        assert.equal(await page.locator('.err').count(), 1);
        assert.match(await page.locator('.err').innerText(), /変更は保存されませんでした/);
        assert.equal(await storedRaw(page, 'sf6memo.drafts'), null);
      });
      await page.context().close();
    }

    // 22e A-L1: 壊れた下書きは空の記録として復元しない。形の違う項目は保存済みの値で補う
    {
      const seed = seedState();
      seed.combos[0].position = 'corner';
      const page = await newPage(width, seed);
      const putDrafts = (o) => page.evaluate((d) => localStorage.setItem('sf6memo.drafts', JSON.stringify(d)), o);
      await putDrafts({ 'new:s1': { tokens: 'x' }, 'edit:c1': { tokens: [N('stand', 'L', 'P')], title: 5, position: 'zzz', tags: 'x', memo: null } });
      await gotoHash(page, '#/c/ryu/new?s=s1');
      await check(`${tag} 22e tokens が配列でない下書きは捨てる（お知らせなし・空の編集画面）`, async () => {
        assert.equal(await page.locator('.notice').count(), 0);
        assert.equal(await page.locator('.cmd .chip').count(), 0);
        assert.equal(await page.getByLabel('タイトル（任意）').inputValue(), '');
      });
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      await check(`${tag} 22e 形の違う項目は保存済みの値（タイトル・位置・タグ）で補い、tokens は下書きのまま`, async () => {
        assert.equal(await page.locator('.notice').count(), 1);
        assert.equal(await page.getByLabel('タイトル（任意）').inputValue(), '基本コンボ');
        assert.deepEqual(await page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label'))), ['立ち弱P']);
        assert.equal(await page.getByRole('radio', { name: '画面端', exact: true }).isChecked(), true);
        assert.deepEqual(await page.$$eval('.tag-list .pill', (els) => els.map((e) => e.textContent.trim())), ['基本']);
      });
      await page.context().close();
    }

    // 22f A-L5: 保存に失敗した操作はすべて巻き戻す（画面からも消え、リロードとの食い違いがない）
    {
      const fail = (p) => p.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
      const listCount = async (p) => { await gotoHash(p, '#/c/ryu'); return p.locator('.item').count(); };
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/r/c1');
      await fail(page);
      await page.getByRole('button', { name: '複製' }).click();
      await check(`${tag} 22f 複製の保存に失敗: 詳細のまま、エラー帯が出て、一覧に複製が残らない`, async () => {
        await page.waitForSelector('.err');
        assert.equal(await hash(page), '#/c/ryu/r/c1');
        assert.equal(await listCount(page), 3);
      });
      await gotoHash(page, '#/c/ryu/r/c1');
      await page.getByRole('button', { name: 'その他…' }).click();
      await page.getByRole('button', { name: '削除' }).click();
      await check(`${tag} 22f 削除の保存に失敗: 記録が消えず、［元に戻す］も出ない`, async () => {
        await page.waitForSelector('.err');
        assert.equal(await page.locator('#toast .toast').count(), 0);
        assert.equal(await listCount(page), 3);
      });
      await gotoHash(page, '#/c/ryu/new?s=s1');
      await page.getByRole('button', { name: '中K', exact: true }).click();
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await check(`${tag} 22f 記録の保存に失敗: 入力は画面に残り、一覧には新しい記録が出ない`, async () => {
        await page.waitForSelector('.err');
        assert.equal(await page.locator('.cmd .chip').count(), 1);
        assert.equal(await listCount(page), 3);
      });
      await page.context().close();
    }

    // 22g A-L5・A-Nit: 取り込みの保存に失敗: 専用の文言で、データは変わらない
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/settings');
      const incoming = exportDoc({ sections: [...seedState().sections, sec('s4', 'ryu', '新しい状況', 3)], combos: seedState().combos });
      await page.locator('input[type=file]').setInputFiles({ name: 'in.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
      await page.waitForSelector('.sheet');
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
      await page.getByRole('button', { name: '取り込む', exact: true }).click();
      await page.waitForSelector('.err');
      await check(`${tag} 22g 取り込みの保存に失敗: 「取り込みは保存されませんでした」と出て（入力内容の文言は出ない）、追加したセクションは残らない`, async () => {
        const t = await page.locator('.banners').innerText();
        assert.match(t, /端末の保存領域がいっぱいです。取り込みは保存されませんでした。保存領域を確認してください。/);
        assert.doesNotMatch(t, /入力内容/);
        await gotoHash(page, '#/c/ryu');
        assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め']);
      });
      await page.context().close();
    }

    // 22h A-L7: 編集画面のトークンは200手まで。201手目はトーストで断り、列は変わらない
    {
      const full = seedState();
      full.combos.push(combo('c9', 's1', '200手', Array.from({ length: 200 }, () => N('stand', 'L', 'P'))));
      const page = await newPage(width, full);
      await gotoHash(page, '#/c/ryu/r/c9/edit');
      const n = () => page.locator('.cmd .chip').count();
      await page.getByRole('button', { name: '中K', exact: true }).click();
      await check(`${tag} 22h 200手のときに足すと「1つの記録に入れられるのは200手までです」が出て、手数は200のまま`, async () => {
        assert.equal(await n(), 200);
        assert.match(await page.locator('#toast').innerText(), /1つの記録に入れられるのは200手までです/);
        assert.equal(await page.locator('.cmd .chip').last().getAttribute('aria-label'), '立ち弱P');
      });
      await check(`${tag} 22h ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }
  }

  // 23. T-015 修正2段目（UI）: 凡例のキーボード・（レベルメーターはT-021で廃止）・詳細のチップの正式名称・タップ領域・入力欄・姿勢キー・削除後のフォーカス・640px・禁止事項（D-015）
  {
    const seed23 = () => {
      const st = seedState();
      st.combos.push(combo('c4', 's1', '移動', [{ type: 'move', id: 'FWD_STEP' }, { type: 'move', id: 'BACK_STEP' }, N('stand', 'N', 'P')]));
      return st;
    };
    const ratioIn = (page, fg, bg) => page.evaluate(([a, b]) => {
      const lum = (c) => { const [r, g, bl] = c.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    }, [fg, bg]);

    // 23a 凡例シート: スクロール領域をキーボードで操作できる（B-Med1）。意味の列の幅（B-Low2）
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/r/c1');
      await page.locator('button[aria-label="凡例を開く"]').click();
      await page.waitForSelector('.sheet.tall');
      await check(`${tag} 23a 凡例: スクロール領域は tabindex=0・role=region で、開いた直後にフォーカスがあり、キーボード（PageDown）でスクロールできる`, async () => {
        const r = await page.evaluate(() => { const b = document.querySelector('.sheet-body'); return [b.tabIndex, b.getAttribute('role'), b.getAttribute('aria-label'), document.activeElement === b, b.scrollHeight > b.clientHeight]; });
        assert.deepEqual(r, [0, 'region', '凡例の表', true, true]);
        await page.keyboard.press('PageDown');
        await page.waitForFunction(() => document.querySelector('.sheet-body').scrollTop > 100);
      });
      await check(`${tag} 23a 凡例: Tab は［閉じる］とスクロール領域を巡回し（シートの外へ出ない）、フォーカスリングが見える`, async () => {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), '閉じる');
        await page.keyboard.press('Tab');
        assert.deepEqual(await page.evaluate(() => { const a = document.activeElement; return [a.classList.contains('sheet-body'), getComputedStyle(a).outlineStyle, getComputedStyle(a).outlineWidth]; }), [true, 'solid', '2px']);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), '閉じる');
      });
      await check(`${tag} 23a 凡例: 意味の列は170px以上あり、書き出し時の表記は意味の下の行（.leg-out）にある`, async () => {
        const r = await page.evaluate(() => [...document.querySelectorAll('.leg tbody tr')].filter((tr) => tr.children.length === 2).map((tr) => [tr.children[1].getBoundingClientRect().width, tr.children[1].lastElementChild.className, getComputedStyle(tr.querySelector('.leg-out'), '::before').content]));
        assert.ok(r.length > 20, String(r.length));
        assert.ok(r.every(([w, cls, before]) => w >= 170 && cls === 'leg-out' && before === '"書き出し "'), JSON.stringify(r.find(([w, cls]) => w < 170 || cls !== 'leg-out')));
        assert.ok(await noHScroll(page));
      });
      await page.context().close();
    }

    // 23c 詳細のチップ: 正式名称を出す。出す情報がないチップ（通常技）はボタンにしない（B-Med3）
    {
      const page = await newPage(width, seed23());
      await gotoHash(page, '#/c/ryu/r/c1');
      await check(`${tag} 23c 詳細: 通常技のチップはボタンではなく（role=img）、必殺技・システム技はボタン`, async () => {
        assert.deepEqual(await page.$$eval('.d-cmd .chip', (cs) => cs.map((c) => [c.tagName, c.getAttribute('aria-label'), c.getAttribute('role')])),
          [['SPAN', '屈中K', 'img'], ['BUTTON', '波動 ↓↘→ 強P、強波動拳', null], ['BUTTON', 'CDR', null], ['SPAN', '屈中K', 'img'], ['BUTTON', '波動 ↓↘→ 強P、強波動拳', null]]);
      });
      const pop = page.locator('.popover');
      const popText = async (sel) => {
        await page.locator(sel).click();
        await pop.waitFor();
        const t = await pop.innerText();
        await page.keyboard.press('Escape');
        await pop.waitFor({ state: 'detached' });
        return t;
      };
      await check(`${tag} 23c 詳細: CDRのポップオーバーは正式名称「キャンセルドライブラッシュ（CDR）」。必殺技はモーションの対応表示`, async () => {
        assert.equal(await popText('.d-cmd button[aria-label="CDR"]'), 'キャンセルドライブラッシュ（CDR）');
        assert.match(await popText('.d-cmd button[aria-label^="波動"] >> nth=0'), /＝ 236（波動）/);
      });
      await gotoHash(page, '#/c/ryu/r/c3');
      await check(`${tag} 23c 詳細: 注記CHはボタンで「カウンターヒット（CH）」、SA3は「スーパーアーツ3（SA3）」`, async () => {
        assert.equal(await page.locator('.d-cmd button.tag').count(), 1);
        assert.equal(await popText('.d-cmd button.tag'), 'カウンターヒット（CH）');
        assert.equal(await popText('.d-cmd button[aria-label="SA3"]'), 'スーパーアーツ3（SA3）');
      });
      await gotoHash(page, '#/c/ryu/r/c4');
      await check(`${tag} 23c 詳細: 前ステ・バクステは「前ステップ（前ステ）」「バックステップ（バクステ）」。強度なしの通常技はボタンでない`, async () => {
        assert.equal(await popText('.d-cmd button[aria-label="前ステ"]'), '前ステップ（前ステ）');
        assert.equal(await popText('.d-cmd button[aria-label="バクステ"]'), 'バックステップ（バクステ）');
        assert.deepEqual(await page.$$eval('.d-cmd .chip', (cs) => cs.map((c) => c.tagName)), ['BUTTON', 'BUTTON', 'SPAN']);
      });
      await check(`${tag} 23c 詳細: ポップオーバーの正式名称は fg・700で、下に余白を余らせない`, async () => {
        await page.locator('.d-cmd button[aria-label="前ステ"]').click();
        await pop.waitFor();
        const r = await page.$eval('.popover .pop-name', (e) => [getComputedStyle(e).fontWeight, getComputedStyle(e).color, getComputedStyle(e).marginBottom]);
        assert.deepEqual(r, ['700', 'rgb(242, 238, 230)', '0px']);
        await page.keyboard.press('Escape');
      });
      await page.context().close();
    }

    // 23d 編集: 長いタグ（B-Low3）、CH・PCのタップ領域（B-Low4）、入力欄の枠（B-Low5）
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/r/c3/edit');
      await check(`${tag} 23d 編集: CH・PCのタグの当たり領域は44×44以上で、隣の技の当たり領域（左5px）とは重ならない`, async () => {
        const r = await page.$eval('.cmd button.tag', (t) => {
          const b = t.getBoundingClientRect(), cy = b.top + b.height / 2, cx = b.left + b.width / 2;
          const hit = (x, y) => document.elementFromPoint(x, y)?.closest('button');
          const chip = t.parentElement.querySelector('button.chip'), cb = chip.getBoundingClientRect();
          return {
            w: b.width + 11 >= 44, h: b.height + 24 >= 44,
            hits: [hit(b.left - 8, cy), hit(b.right + 1.5, cy), hit(cx, b.top - 11), hit(cx, b.bottom + 11)].map((e) => e === t),
            chipLeft: hit(cb.left - 4, cy) === chip,
          };
        });
        assert.deepEqual(r, { w: true, h: true, hits: [true, true, true, true], chipLeft: true });
      });
      await check(`${tag} 23d 編集: 30文字の区切りのないタグは画面幅に収まる（.pill の max-width と overflow-wrap）。横スクロールなし`, async () => {
        await page.locator('#f-tag').fill('W'.repeat(30));
        await page.locator('#f-tag').press('Enter');
        const r = await page.$eval('.tag-list .pill', (p) => {
          const b = p.getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(p.firstChild);
          return [b.left >= 0, b.right <= innerWidth, getComputedStyle(p).maxWidth, getComputedStyle(p).overflowWrap, range.getClientRects().length >= 2, p.scrollWidth <= p.clientWidth]; // 文字は2行以上に折り返され、枠から出ない
        });
        assert.deepEqual(r, [true, true, '100%', 'anywhere', true, true]);
        assert.ok(await noHScroll(page));
      });
      await check(`${tag} 23d 編集: 入力欄・選択肢の枠は #6B727C（地との比3:1以上）`, async () => {
        const r = await page.evaluate(() => ['#f-title', '#f-memo', '#f-sec', '.seg-item span'].map((s) => [getComputedStyle(document.querySelector(s)).borderTopColor, getComputedStyle(document.body).backgroundColor]));
        for (const [c, bg] of r) {
          assert.equal(c, 'rgb(107, 114, 124)');
          assert.ok(await ratioIn(page, c, bg) >= 3, `${c} ${bg}`);
        }
        assert.ok(await ratioIn(page, 'rgb(107, 114, 124)', 'rgb(23, 25, 28)') >= 3); // シートの中（surface）の入力欄
      });
      await page.context().close();
    }

    // 23e 姿勢キー: ラジオグループの矢印キー操作（roving tabindex。B-Low6）
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/new?s=s1');
      const st = () => page.$$eval('[aria-label="姿勢"] [role=radio]', (ks) => ks.map((k) => [k.getAttribute('aria-label'), k.getAttribute('aria-checked'), k.tabIndex]));
      const on = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
      await check(`${tag} 23e 姿勢: Tab停止は選択中の1つだけ（立ち）`, async () => {
        assert.deepEqual(await st(), [['立ち', 'true', 0], ['しゃがみ', 'false', -1], ['ジャンプ', 'false', -1]]);
      });
      await check(`${tag} 23e 姿勢: 矢印キーで隣へ移って選ぶ（右・下は次、左・上は前、端で巡回）。Tab停止も移る`, async () => {
        await page.getByRole('radio', { name: '立ち', exact: true }).focus();
        const seq = [['ArrowRight', 'しゃがみ'], ['ArrowDown', 'ジャンプ'], ['ArrowRight', '立ち'], ['ArrowLeft', 'ジャンプ'], ['ArrowUp', 'しゃがみ'], ['ArrowDown', 'ジャンプ']];
        for (const [key, want] of seq) {
          await page.keyboard.press(key);
          assert.equal(await on(), want, key);
          assert.deepEqual(await st(), ['立ち', 'しゃがみ', 'ジャンプ'].map((n) => [n, String(n === want), n === want ? 0 : -1]), key);
        }
      });
      await check(`${tag} 23e 姿勢: 矢印で選ぶと入力にも反映され（ジャンプ→Pで ジャンプ弱P）、Tab は姿勢の次（消す）へ進む`, async () => {
        await page.getByRole('button', { name: '弱P', exact: true }).click();
        assert.equal(await page.locator('.cmd .chip').last().getAttribute('aria-label'), 'ジャンプ弱P');
        await page.getByRole('radio', { name: 'ジャンプ', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await on(), '直前の入力を取り消す');
      });
      await check(`${tag} 23e 姿勢: ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }

    // 23f 記録の削除後は［元に戻す］へフォーカス（B-Low7）。履歴を戻す経路と、置き換える経路の両方
    for (const [label, route] of [['一覧から詳細へ（履歴を戻す）', true], ['詳細を直接開いた（履歴を置き換える）', false]]) {
      const page = await newPage(width, seedState());
      if (route) {
        await gotoHash(page, '#/c/ryu');
        await page.locator('a.item', { hasText: '基本コンボ' }).click();
        await page.waitForSelector('.d-cmd');
      } else await gotoHash(page, '#/c/ryu/r/c1');
      await page.getByRole('button', { name: 'その他…' }).click();
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await check(`${tag} 23f 記録の削除（${label}）: 一覧へ移ったあと、フォーカスは［元に戻す］にある`, async () => {
        await page.waitForFunction(() => location.hash === '#/c/ryu' && document.activeElement?.classList.contains('toast-act'));
        assert.equal(await page.evaluate(() => document.activeElement.textContent), '元に戻す');
        await page.keyboard.press('Enter');
        await page.waitForSelector('a.item:has-text("基本コンボ")');
        assert.equal((await stored(page)).combos.length, 3);
      });
      await page.context().close();
    }

    // 23g 高さ640px以下では、パッドをコマンド列の下の通常の流れに置く（要件の矛盾の解消。閾値 max-height:640px）
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/new?s=s1');
      const lay = () => page.evaluate(() => {
        const s = document.querySelector('.screen.edit'), p = document.querySelector('.pad').getBoundingClientRect(), c = document.querySelector('.cmd').getBoundingClientRect();
        return { overflow: getComputedStyle(s).overflow, padBelowCmd: p.top >= c.bottom - 1, padAtBottom: Math.abs(p.bottom - innerHeight) < 2 };
      });
      await page.setViewportSize({ width, height: 640 });
      await check(`${tag} 23g 高さ640px: パッドは通常の流れ（.screen.edit は overflow:visible、パッドはコマンド列の下）`, async () => {
        assert.deepEqual(await lay(), { overflow: 'visible', padBelowCmd: true, padAtBottom: false });
      });
      await page.setViewportSize({ width, height: 641 });
      await check(`${tag} 23g 高さ641px: パッドは画面下端に固定（.screen.edit は overflow:hidden）`, async () => {
        assert.deepEqual(await lay(), { overflow: 'hidden', padBelowCmd: true, padAtBottom: true });
      });
      await page.context().close();
    }

    // 23h ▶は読み上げで「次」（B-Test1）。常時の明滅（無限ループのアニメーション）・グラデーション・filter がない（design-spec-v2 2.6、B-Test1）
    {
      const page = await newPage(width, seedState());
      await gotoHash(page, '#/c/ryu/r/c1');
      await check(`${tag} 23h 詳細・一覧: ▶（.conn）は aria-hidden で、直前に読み上げ用の「、次、」（.sr-only）がある（5手で4つ）`, async () => {
        const r = await page.$$eval('.d-cmd .conn', (cs) => cs.map((c) => [c.getAttribute('aria-hidden'), c.previousElementSibling?.className, c.previousElementSibling?.textContent]));
        assert.deepEqual(r, Array(4).fill(['true', 'sr-only', '、次、']));
        await gotoHash(page, '#/c/ryu');
        assert.equal(await page.locator('a.item', { hasText: '基本コンボ' }).locator('.sr-only', { hasText: '、次、' }).count(), 4);
      });
      await check(`${tag} 23h 一覧: 記録のリンクの読み上げ名に「次」が4回入る（チップ名と次が交互）`, async () => {
        const link = page.locator('a.item', { hasText: '基本コンボ' });
        const snap = await link.ariaSnapshot();
        assert.equal((snap.split('\n')[0].match(/次/g) ?? []).length, 4, snap); // 1行目 = リンクの名前
        assert.ok(snap.includes('屈中K') && snap.includes('CDR'), snap);
      });
      const css = await page.evaluate(async () => (await (await fetch('./styles.css')).text()).split('\n').filter((l) => !l.includes('data:font/')).join('\n'));
      await check(`${tag} 23h styles.css に gradient( と infinite（無限ループ）がない`, async () => {
        assert.ok(css.length > 10000);
        assert.ok(!/gradient\(/.test(css) && !/infinite/.test(css));
      });
      const forbidden = () => page.evaluate(() => {
        const bad = [];
        for (const e of document.querySelectorAll('*')) for (const ps of [null, '::before', '::after']) {
          const cs = getComputedStyle(e, ps);
          if (/gradient/.test(cs.backgroundImage) || /gradient/.test(cs.borderImageSource)) bad.push(`gradient ${e.className}${ps ?? ''}`);
          if (cs.animationIterationCount.split(',').some((v) => v.trim() === 'infinite')) bad.push(`infinite ${e.className}${ps ?? ''}`);
          if (cs.filter !== 'none' || cs.backdropFilter !== 'none') bad.push(`filter ${e.className}${ps ?? ''}`);
        }
        if (document.getAnimations().some((a) => a.effect?.getComputedTiming().iterations === Infinity)) bad.push('動いている無限アニメーション');
        return bad;
      });
      for (const h of ['#/', '#/c/ryu', '#/c/ryu/r/c1', '#/c/ryu/r/c1/edit', '#/settings']) {
        await gotoHash(page, h);
        await check(`${tag} 23h ${h}: グラデーション・無限ループのアニメーション・filter がない（疑似要素を含む）`, async () => assert.deepEqual(await forbidden(), []));
      }
      await gotoHash(page, '#/c/ryu/r/c1');
      await page.locator('button[aria-label="凡例を開く"]').click();
      await page.waitForSelector('.sheet.tall');
      await check(`${tag} 23h 凡例シート: グラデーション・無限ループのアニメーション・filter がない`, async () => assert.deepEqual(await forbidden(), []));
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
      await page.locator('.d-cmd button[aria-label^="波動"]').first().click();
      await check(`${tag} 23h ポップオーバー: グラデーション・無限ループのアニメーション・filter がない`, async () => assert.deepEqual(await forbidden(), []));
      await check(`${tag} 23h ページエラーなし`, async () => assert.deepEqual(page.errors, []));
      await page.context().close();
    }
  }

  // 5. 横スクロールなし（各画面）
  {
    const page = await newPage(width, seedState());
    for (const h of ['#/', '#/c/ryu', '#/c/ehonda', '#/c/ryu/r/c1', '#/c/ryu/r/c1/edit', '#/c/ryu/new?s=s2', '#/settings']) {
      await gotoHash(page, h);
      await check(`${tag} 5 横スクロールなし ${h}`, async () => assert.ok(await noHScroll(page)));
    }
    await gotoHash(page, '#/c/ryu');
    await page.getByRole('button', { name: '通常のメニュー' }).click();
    await check(`${tag} 5 横スクロールなし（シート）`, async () => assert.ok(await noHScroll(page)));
    await page.context().close();
  }
}

// ===== SECTION: 24 必殺技の技名（T-023。D-017・D-018、design-spec-v2.2 6章の3〜13・16） =====
// 360・390・430幅。リュウ（派生なし）・アルジュン（派生）・ケン（強さで名前が変わる派生）・ルーク（方向のない派生）・ジェイミー（複数の技が当たる）・キャミィ（最長の技名）で確かめる。
for (const width of [360, 390, 430]) {
  const tag = `[${width}]`;
  const NN = (stance, str, key, dir) => ({ type: 'normal', stance, key, str, ...(dir && { dir }) });
  const MV = (id) => ({ type: 'move', id });
  const SYS = (id) => ({ type: 'system', id });
  const seed24 = () => ({
    sections: [sec('s1', 'ryu', '通常', 0), sec('sa', 'arjun', '通常', 0), sec('sk', 'ken', '通常', 0), sec('sl', 'luke', '通常', 0), sec('sj', 'jamie', '通常', 0), sec('sc', 'cammy', '通常', 0), sec('sx', 'kimberly', '通常', 0)],
    combos: [
      combo('c1', 's1', 'リュウの基本', [N('crouch', 'M', 'K'), SP('236', 'M', 'P'), SYS('CDR'), SP('623', 'H', 'P'), SP('214', 'OD', 'K'), SP('236', 'N', 'P'), SP('360', 'H', 'P')]),
      combo('c2', 's1', '236P▶6P', [SP('236', 'L', 'P'), NN('stand', 'N', 'P', 6)]),
      combo('a1', 'sa', '派生', [SP('236', 'L', 'P'), NN('stand', 'N', 'P', 6)], { characterId: 'arjun' }),
      combo('a2', 'sa', '親が当たらない', [
        NN('stand', 'N', 'P', 6), SP('22', 'H', 'P'), NN('stand', 'N', 'P', 6), SP('214', 'H', 'K'), SP('236', 'M', 'P'), MV('FWD_STEP'), NN('stand', 'N', 'P', 6),
        SP('236', 'M', 'P'), SYS('CDR'), NN('stand', 'N', 'P', 6), SP('236', 'M', 'P'), { type: 'sa', level: 1 }, NN('stand', 'N', 'P', 6),
        SP('236', 'M', 'P'), { type: 'note', id: 'CH' }, NN('stand', 'N', 'P', 6),
      ], { characterId: 'arjun' }),
      combo('a3', 'sa', '親の強度条件', [SP('22', 'H', 'K'), NN('stand', 'N', 'P')], { characterId: 'arjun' }),
      combo('k1', 'sk', '強さで変わる派生', [SP('236', 'M', 'K'), NN('stand', 'M', 'K', 6), SP('236', 'M', 'K'), NN('stand', 'N', 'K', 6)], { characterId: 'ken' }),
      combo('l1', 'sl', '方向のない派生', [SP('236', 'M', 'K'), NN('stand', 'N', 'P')], { characterId: 'luke' }),
      combo('j1', 'sj', '複数', [SP('236', 'M', 'P'), SP('236', 'N', 'P')], { characterId: 'jamie' }),
      combo('m1', 'sc', '最長', [SP('236', 'OD', 'P'), SP('236', 'H', 'P')], { characterId: 'cammy' }),
    ],
  });
  // 設定が未保存のときだけ「技名」で始める（再読み込みで保存済みの設定を上書きしない）
  const nameInit = () => { if (!localStorage.getItem('sf6memo.settings')) localStorage.setItem('sf6memo.settings', JSON.stringify({ specialNotation: 'name' })); };
  const named = (seed = seed24()) => newPage(width, seed, {}, nameInit);
  const aria = (page, name) => page.getByRole('button', { name, exact: true });
  const FG = 'rgb(242, 238, 230)', MUTED = 'rgb(170, 166, 157)', CONN = 'rgb(140, 138, 133)'; // --fg --fg-muted --conn
  // チップごとの表示。name = 技名の文字（なければ null）、cmd = 矢印・数字が出ているか、dots = ●の色クラス
  const chipsInfo = (page, sel) => page.$$eval(`${sel} .chip`, (els) => els.map((e) => ({
    name: e.querySelector('.sname')?.textContent ?? null,
    cmd: !!e.querySelector('.arrow, .cw, .num, .charge'),
    dots: [...e.querySelectorAll('.dot')].map((d) => [...d.classList].find((c) => /^(str-|od)/.test(c))),
    label: e.getAttribute('aria-label'),
  })));
  const namesOf = async (page, sel) => (await chipsInfo(page, sel)).map((c) => c.name);
  const forbidden = (page) => page.evaluate(() => {
    const bad = [];
    for (const e of document.querySelectorAll('*')) for (const ps of [null, '::before', '::after']) {
      const cs = getComputedStyle(e, ps);
      if (/gradient/.test(cs.backgroundImage) || cs.filter !== 'none' || cs.backdropFilter !== 'none') bad.push(`${e.className}${ps ?? ''}`);
    }
    return bad;
  });
  const glowCount = (page, sel) => page.$eval(sel, (root) => [root, ...root.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return cs.textShadow !== 'none' || cs.boxShadow !== 'none'; }).length);
  const RYU_C1 = [null, '中波動拳', null, '強昇龍拳', 'OD竜巻旋風脚', '波動拳', null];

  // 24a 設定: 「必殺技の表記」の節・見本・保存・免責（受け入れ基準5）
  {
    const page = await newPage(width, seed24());
    await gotoHash(page, '#/settings');
    await check(`${tag} 24a 設定の「表示」の節: 方向の表記 → 必殺技の表記［コマンド｜技名］（初期はコマンド）→ ボタンの補助文字 → メモの文字サイズ。見本の下に注記`, async () => {
      assert.deepEqual(await page.locator('.set-body legend').allInnerTexts(), ['方向の表記', '必殺技の表記', 'ボタンの補助文字', 'メモの文字サイズ']); // メモの文字サイズは25章（T-025）
      assert.deepEqual(await page.locator('fieldset:has(legend:text("必殺技の表記")) .seg-item').allInnerTexts(), ['コマンド', '技名']);
      assert.equal(await page.getByRole('radio', { name: 'コマンド' }).isChecked(), true);
      const sample = page.locator('.fld:has(legend:text("必殺技の表記")) .set-sample');
      assert.equal(await sample.locator('.sname').count(), 0);
      assert.ok(await sample.locator('.arrow').count() >= 6); // 236 ▶ 623 ▶ 214
      const note = sample.locator('.set-note');
      assert.equal(await note.innerText(), '例はリュウ。技名がない入力はコマンドのまま表示します');
      assert.deepEqual(await note.evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).color]), ['12px', MUTED]);
      assert.ok(await noHScroll(page));
    });
    await page.getByRole('radio', { name: '技名' }).check();
    await check(`${tag} 24a 技名にすると見本が「中波動拳 ▶ 弱昇龍拳 ▶ OD竜巻旋風脚」。方向の表記の見本は辞書を渡さずコマンドのまま`, async () => {
      const own = page.locator('.fld:has(legend:text("必殺技の表記")) .set-sample');
      assert.deepEqual(await own.locator('.sname').allInnerTexts(), ['中波動拳', '弱昇龍拳', 'OD竜巻旋風脚']);
      assert.equal(await own.locator('.arrow').count(), 0);
      assert.equal(await own.locator('.dot').count(), 0); // 技名の見本に●は出ない（D-019）
      const dir = page.locator('.fld:has(legend:text("方向の表記")) .set-sample');
      assert.equal(await dir.locator('.sname').count(), 0);
      assert.ok(await dir.locator('.arrow').count() >= 3);
      assert.ok(await dir.locator('.dot').count() >= 3); // コマンドの見本は●を出す
      assert.ok(await noHScroll(page));
    });
    await shot(page, '24-settings-name', width);
    await check(`${tag} 24a 選んだ値が保存され、再読み込みしても残る。ほかの設定のキーは保たれる`, async () => {
      const before = JSON.parse(await storedRaw(page, 'sf6memo.settings'));
      assert.equal(before.specialNotation, 'name');
      assert.equal(before.notation, 'arrow');
      await page.reload();
      assert.equal(await page.getByRole('radio', { name: '技名' }).isChecked(), true);
      assert.equal(JSON.parse(await storedRaw(page, 'sf6memo.settings')).specialNotation, 'name');
      await page.getByRole('radio', { name: '数字' }).check();
      const after = JSON.parse(await storedRaw(page, 'sf6memo.settings'));
      assert.deepEqual([after.notation, after.specialNotation], ['numpad', 'name']);
    });
    await check(`${tag} 24a 設定の下部に免責（D-018の文面）。12px・muted の段落で、「©」を含まない`, async () => {
      const p = page.locator('.set-foot .set-legal');
      assert.equal(await p.innerText(), LEGAL);
      assert.deepEqual(await p.evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).color, e.tagName]), ['12px', MUTED, 'P']);
      assert.ok(!(await page.locator('body').innerText()).includes('©'));
      assert.ok(await noHScroll(page));
    });
    await check(`${tag} 24a 壊れた specialNotation は既定のコマンドに戻る`, async () => {
      const q = await newPage(width, seed24(), {}, () => localStorage.setItem('sf6memo.settings', JSON.stringify({ specialNotation: 'x', notation: 'numpad' })));
      await gotoHash(q, '#/settings');
      assert.equal(await q.getByRole('radio', { name: 'コマンド' }).isChecked(), true);
      assert.equal(await q.getByRole('radio', { name: '数字' }).isChecked(), true);
      await q.context().close();
    });
    await check(`${tag} 24a 他タブが書いた別キーの設定を、技名の保存で潰さない（キー単位のマージ。D-014）`, async () => {
      const q = await newPage(width, seed24());
      await gotoHash(q, '#/settings');
      await q.evaluate(() => { const s = JSON.parse(localStorage.getItem('sf6memo.settings') ?? '{}'); s.strengthLabels = true; localStorage.setItem('sf6memo.settings', JSON.stringify(s)); });
      await q.getByRole('radio', { name: '技名' }).check();
      const s = JSON.parse(await storedRaw(q, 'sf6memo.settings'));
      assert.deepEqual([s.strengthLabels, s.specialNotation], [true, 'name']);
      await q.context().close();
    });
    await check(`${tag} 24a ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 24b 表示: 一覧・詳細・編集・直近の技・凡例。コマンド表記と技名表記（受け入れ基準5・8）
  {
    const page = await newPage(width, seed24());
    await gotoHash(page, '#/c/ryu/r/c1');
    await check(`${tag} 24b コマンド表記（初期値）: 236中P は矢印と .dot.str-m、技名の文字なし。読み上げ名は「コマンド、技名」の順`, async () => {
      const c = await chipsInfo(page, '.d-cmd');
      assert.equal(c[1].name, null);
      assert.equal(c[1].cmd, true);
      assert.deepEqual(c[1].dots, ['str-m']);
      assert.equal(c[1].label, '波動 ↓↘→ 中P、中波動拳');
      assert.equal(c[0].label, '屈中K'); // 通常技は今のまま
      assert.deepEqual(c.map((x) => x.name), Array(7).fill(null));
      assert.equal(c[6].label, '一回転 ↻ 強P'); // 辞書にない360はコマンドのまま、技名を足さない
    });
    const cmdGlow = await glowCount(page, '.d-cmd');
    await gotoHash(page, '#/settings');
    await page.getByRole('radio', { name: '技名' }).check();
    await gotoHash(page, '#/c/ryu/r/c1');
    await check(`${tag} 24b 技名表記: 236中P は「中波動拳」の文字だけ（矢印も●もない）、強P→強昇龍拳、OD→OD竜巻旋風脚、強度なし→波動拳。360は辞書にないのでコマンドのまま●が残る（D-019）`, async () => {
      const c = await chipsInfo(page, '.d-cmd');
      assert.deepEqual(c.map((x) => x.name), RYU_C1);
      assert.deepEqual(c.map((x) => x.cmd), [true, false, false, false, false, false, true]);
      for (const i of [1, 2, 3, 4, 5]) assert.deepEqual(c[i].dots, [], `技名のチップ ${i} に ●（.dot）が出ている`);
      assert.equal(await page.locator('.d-cmd .chip:has(.sname) .dot, .d-cmd .chip:has(.sname) .badge').count(), 0);
      assert.deepEqual(c[0].dots, ['str-m']); // 通常技（屈中K）と辞書にない360は今のまま●を出す
      assert.deepEqual(c[6].dots, ['str-h']);
      assert.equal(c[1].label, '中波動拳、波動 ↓↘→ 中P');
      assert.equal(c[4].label, 'OD竜巻旋風脚、OD 竜巻 ↓↙← K');
      assert.equal(c[5].label, '波動拳、波動 ↓↘→ P');
      assert.equal(c[6].label, '一回転 ↻ 強P');
    });
    await check(`${tag} 24b 技名の文字: 接頭辞と技名は1つの文字列（L15px・700・fg）。枠・塗りなし。折り返さない`, async () => {
      const r = await page.$$eval('.d-cmd .sname', (els) => els.map((e) => { const cs = getComputedStyle(e); return [e.textContent, cs.fontSize, cs.fontWeight, cs.color, cs.backgroundColor, cs.borderTopWidth, cs.whiteSpace]; }));
      assert.deepEqual(r.map((x) => x[0]), ['中波動拳', '強昇龍拳', 'OD竜巻旋風脚', '波動拳']);
      for (const x of r) assert.deepEqual(x.slice(1), ['15px', '700', FG, 'rgba(0, 0, 0, 0)', '0px', 'nowrap']);
    });
    // 技名表記のODは「OD」の文字だけ。発光（L寸法の --glow-od・--tx-od）は●●と橙の「OD」に付いていたので、技名表記のほうが少ない（D-019）
    await check(`${tag} 24b 技名表記の発光する要素（text-shadow・box-shadow）の数は、コマンド表記以下。技名のチップ自身は発光しない`, async () => {
      assert.ok(await glowCount(page, '.d-cmd') <= cmdGlow);
      assert.equal(await page.locator('.d-cmd .sname').evaluateAll((els) => els.filter((e) => [e, ...e.querySelectorAll('*')].some((x) => { const cs = getComputedStyle(x); return cs.textShadow !== 'none' || cs.boxShadow !== 'none'; })).length), 0);
    });
    await check(`${tag} 24b 保存したJSON（データ・設定）に技名の文字列がない。トークンは既存の形`, async () => {
      const raw = (await storedRaw(page)) + (await storedRaw(page, 'sf6memo.settings'));
      for (const n of ['波動拳', '昇龍拳', '竜巻旋風脚', '追撃', '大義の巨腕']) assert.ok(!raw.includes(n), n);
      const d = await stored(page);
      assert.deepEqual(d.combos.find((c) => c.id === 'c1').tokens[1], { type: 'special', motion: '236', key: 'P', str: 'M' });
      assert.equal(d.schemaVersion, 2);
    });
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 24b 一覧のプレビュー（S）も技名表記。S寸法は12px`, async () => {
      assert.deepEqual(await namesOf(page, 'a.item:has-text("リュウの基本") .preview'), RYU_C1);
      assert.equal(await page.locator('.preview .sname').first().evaluate((e) => getComputedStyle(e).fontSize), '12px');
      assert.equal(await page.locator('a.item:has-text("リュウの基本") .preview .chip:has(.sname) .dot').count(), 0);
      assert.ok(await page.locator('a.item:has-text("リュウの基本") .preview .chip:not(:has(.sname)) .dot').count() >= 1); // 技名のないチップは●のまま
      assert.ok(await noHScroll(page));
    });
    await shot(page, '24-list-name', width);
    await gotoHash(page, '#/c/ryu/r/c1');
    await shot(page, '24-detail-name', width);
    await gotoHash(page, '#/c/ryu/r/c1/edit');
    await check(`${tag} 24b 編集の列・直近の技（S）も技名表記。編集中の仮チップは常にコマンド`, async () => {
      assert.deepEqual(await namesOf(page, '.cmd'), RYU_C1);
      await page.getByRole('button', { name: '技名の候補', exact: true }).click(); // 設定が技名なので初期はオン。オフにして直近の技を出す
      const labels = await page.locator('.recent-keys .key').evaluateAll((ks) => ks.map((k) => k.getAttribute('aria-label')));
      assert.ok(labels.includes('中波動拳、波動 ↓↘→ 中Pを追加'), labels.join('|')); // 技名表記は技名が先
      assert.ok((await page.locator('.recent-keys .sname').allInnerTexts()).includes('中波動拳'));
      assert.equal(await page.locator('.cmd .chip:has(.sname) .dot, .recent-keys .chip:has(.sname) .dot').count(), 0); // 編集の列・直近の技
      await aria(page, '波動 236').click();
      assert.equal(await page.locator('.cmd .pending .sname').count(), 0);
      assert.ok(await page.locator('.cmd .pending .arrow').count() >= 3);
      await aria(page, '直前の入力を取り消す').click();
    });
    await page.locator('button[aria-label="凡例を開く"]').click();
    await page.waitForSelector('.sheet.tall');
    await check(`${tag} 24b 凡例: 「必殺技」の群に1行（236中Pを技名で）。意味と書き出し`, async () => {
      const g = page.locator('.leg tbody:has(th:text("必殺技"))');
      assert.equal(await g.locator('.sname').innerText(), '中波動拳');
      assert.equal(await g.locator('.dot').count(), 0);
      assert.equal(await g.locator('tr').count(), 2);
      assert.equal(await g.locator('td').last().innerText(), '必殺技（技名で表示。設定で切り替え）。派生は直前の技に▶でつながる\n236 中P'); // 「書き出し 」は ::before の飾り
      assert.ok(await noHScroll(page));
    });
    await shot(page, '24-legend', width);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await check(`${tag} 24b 凡例の行は設定がコマンドでも技名で描く`, async () => {
      await gotoHash(page, '#/settings');
      await page.getByRole('radio', { name: 'コマンド' }).check();
      await page.getByRole('button', { name: '凡例を見る' }).click();
      await page.waitForSelector('.sheet.tall');
      assert.equal(await page.locator('.leg .sname').innerText(), '中波動拳');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
    });
    await check(`${tag} 24b ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 24c ポップオーバー: 設定にかかわらず、技名とコマンドの両方（受け入れ基準9・11・12）
  {
    const page = await newPage(width, seed24()); // 設定はコマンド表記（初期値）
    const pop = page.locator('.popover');
    const open = async (hashTo, i) => {
      await gotoHash(page, hashTo);
      await page.locator('.d-cmd .chip').nth(i).click();
      await pop.waitFor();
    };
    const close = async () => { await page.keyboard.press('Escape'); await pop.waitFor({ state: 'detached' }); };
    const notes = () => pop.locator('.pop-note').allInnerTexts();
    await open('#/c/ryu/r/c1', 1);
    await check(`${tag} 24c コマンド表記でも、1行目に強度付きの技名「中波動拳」、続けてコマンド（既存の motionNote）`, async () => {
      assert.equal(await pop.locator('.pop-name').innerText(), '中波動拳');
      assert.deepEqual(await notes(), ['中波動拳', '＝ 236（波動）']);
      const b = await pop.boundingBox();
      assert.ok(b.width <= 320 && b.x >= 0 && b.x + b.width <= width, JSON.stringify(b));
    });
    await shot(page, '24-popover-name', width);
    await close();
    await check(`${tag} 24c 強度なしは「波動拳」。辞書にない360は「技名なし（技の一覧にない入力）」とコマンド`, async () => {
      await page.locator('.d-cmd .chip').nth(5).click();
      await pop.waitFor();
      assert.deepEqual(await notes(), ['波動拳', '＝ 236（波動）']);
      await close();
      await page.locator('.d-cmd .chip').nth(6).click();
      await pop.waitFor();
      assert.deepEqual(await notes(), ['技名なし（技の一覧にない入力）', '＝ 360（一回転）']);
      await close();
    });
    await check(`${tag} 24c 複数の技が当たる入力（ジェイミーの236P）は「流酔拳／流酔脚 のどちらか」`, async () => {
      await open('#/c/jamie/r/j1', 0);
      assert.deepEqual(await notes(), ['流酔拳／流酔脚 のどちらか', '＝ 236（波動）']);
      await close();
    });
    await check(`${tag} 24c 強さで名前が変わる技は、強度なしだと「技名は強さで変わります」`, async () => {
      // 強度ごとに別の技名の技（ケンの 迅雷脚▶6K）。強度なしの6Kは通常技の形なので詳細ではボタンにならない（編集のポップオーバーで確かめる 24e）
      await gotoHash(page, '#/c/ken/r/k1');
      assert.deepEqual(await page.$$eval('.d-cmd .chip', (cs) => cs.map((c) => c.tagName)), ['BUTTON', 'BUTTON', 'BUTTON', 'SPAN']);
    });
    await check(`${tag} 24c 派生（アルジュンの236P▶6P）: 1行目に派生名、2行目に「〈親の技名〉の派生」、続けてコマンド「→ ＝ 6」。親は強度付きの技名`, async () => {
      await open('#/c/arjun/r/a1', 1);
      assert.deepEqual(await notes(), ['追撃', '大義の巨腕の派生', '＝ 6']);
      assert.equal(await pop.locator('.pop-note').last().locator('.arrow').count(), 1);
      await close();
      await page.locator('.d-cmd .chip').nth(0).click();
      await pop.waitFor();
      assert.deepEqual(await notes(), ['弱大義の巨腕', '＝ 236（波動）']);
      await close();
    });
    await check(`${tag} 24c 方向のない派生（ルークのアベンジャー▶P）は「ボタンのみ」。強さで変わる派生（ケンの迅雷脚▶6K）は強度の名前`, async () => {
      await open('#/c/luke/r/l1', 1);
      assert.deepEqual(await notes(), ['ノーチェイサー', 'アベンジャーの派生', 'ボタンのみ']);
      await close();
      await open('#/c/ken/r/k1', 1);
      assert.deepEqual(await notes(), ['轟雷落とし', '迅雷脚の派生', '＝ 6']);
      await close();
    });
    await check(`${tag} 24c 既知の限界: 親の直後の同じ形の通常技（CHをはさんだ6P）にも技名が付くが、ポップオーバーの「〜の派生」で内容を確かめられる`, async () => {
      await open('#/c/arjun/r/a2', 14);
      assert.deepEqual(await notes(), ['追撃', '大義の巨腕の派生', '＝ 6']);
      await close();
    });
    await check(`${tag} 24c 詳細の canTap: 派生と判定された通常技の形はボタン、そうでない通常技（行頭の6P・親が当たらない6P）は読み上げ用の span`, async () => {
      await gotoHash(page, '#/c/arjun/r/a2');
      const tags = await page.$$eval('.d-cmd .chip', (cs) => cs.map((c) => c.tagName));
      assert.deepEqual(tags.map((t, i) => (t === 'BUTTON' ? i : null)).filter((x) => x !== null), [1, 3, 4, 5, 7, 8, 10, 11, 13, 14]); // 必殺技（22HPを含む）・移動・CDR・SA（正式名称あり）と派生。通常技の6P（0・2・6・9・12）はspan
    });
    await check(`${tag} 24c ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 24d 編集パッドのR1: ［技名］キー・候補・選択・打つ回数（受け入れ基準3・10）
  {
    const cand = (page, n) => page.locator('#r1-scroll .key.cand').filter({ has: page.locator('.cand-name', { hasText: new RegExp(`^${n}$`) }) });
    const candNames = (page) => page.$$eval('#r1-scroll .cand-name', (e) => e.map((x) => x.textContent));
    const draft = async (page) => JSON.parse(await storedRaw(page, 'sf6memo.drafts'))['new:s1'].tokens;
    const live = (page) => page.evaluate(() => document.getElementById('live').textContent);
    const pressed = (page) => page.$$eval('#r1-scroll .key.cand', (ks) => ks.filter((k) => k.getAttribute('aria-pressed') === 'true').map((k) => k.querySelector('.cand-name').textContent));
    const page = await named();
    await gotoHash(page, '#/c/ryu/new?s=s1');
    const nk = page.locator('.name-key');
    await check(`${tag} 24d ［技名］: 52×44、文字「技名」、aria-label「技名の候補」、aria-pressed（設定が技名なので初期はオン）、aria-controls は候補の領域`, async () => {
      const r = await nk.evaluate((k) => { const b = k.getBoundingClientRect(); const cs = getComputedStyle(k); return { w: b.width, h: b.height, t: k.textContent, al: k.getAttribute('aria-label'), p: k.getAttribute('aria-pressed'), ctl: k.getAttribute('aria-controls'), fs: cs.fontSize, fw: cs.fontWeight, c: cs.color, tag: k.tagName, order: [...k.parentElement.children].map((x) => x.className.split(' ')[0]) }; });
      assert.deepEqual([r.w, r.h, r.t, r.al, r.p, r.ctl, r.fs, r.fw, r.c, r.tag], [52, 44, '技名', '技名の候補', 'true', 'r1-scroll', '14px', '700', FG, 'BUTTON']);
      assert.deepEqual(r.order, ['key', 'recent-keys', 'key']); // ［技名］・候補・［完了］
      assert.equal(await page.locator('#r1-scroll').getAttribute('role'), 'group');
      assert.equal(await page.locator('#r1-scroll').getAttribute('aria-label'), '技名の候補 7件');
    });
    await check(`${tag} 24d 方向なしの候補はリュウの全必殺技（辞書の順。空中の技も）。候補は64以上×44以上。名前（13px・700・fg）・コマンド・P/K（12px・muted）。空中は先頭にJ。強度の●はない`, async () => {
      assert.deepEqual(await candNames(page), ['波動拳', '昇龍拳', '竜巻旋風脚', '空中竜巻旋風脚', '上段足刀蹴り', '波掌撃', '電刃錬気']);
      const r = await page.$$eval('#r1-scroll .key.cand', (ks) => ks.map((k) => { const b = k.getBoundingClientRect(); const n = getComputedStyle(k.querySelector('.cand-name')); const bt = getComputedStyle(k.querySelector('.cand-btn')); return [b.width >= 64, b.height === 44, n.fontSize, n.fontWeight, n.color, bt.fontSize, bt.fontWeight, bt.color, k.querySelectorAll('.dot').length, k.querySelector('.cand-cmd .ltr')?.textContent ?? null, k.getAttribute('aria-pressed'), k.tagName]; }));
      for (const x of r) assert.deepEqual(x.slice(0, 9), [true, true, '13px', '700', FG, '12px', '700', MUTED, 0]);
      assert.deepEqual(r.map((x) => x[9]), [null, null, null, 'J', null, null, null]);
      assert.deepEqual([...new Set(r.map((x) => x[10] + x[11]))], ['falseBUTTON']);
      const first = page.locator('#r1-scroll .key.cand').first();
      assert.equal(await first.getAttribute('aria-label'), '波動拳、波動 ↓↘→ P');
      assert.equal(await first.locator('.cand-cmd .arrow').count(), 3);
      assert.equal(await first.locator('.cand-cmd .cand-btn').innerText(), 'P');
      assert.equal(await cand(page, '空中竜巻旋風脚').getAttribute('aria-label'), '空中竜巻旋風脚、ジャンプ 竜巻 ↓↙← K');
    });
    await shot(page, '24-edit-cands', width);
    let taps = 0;
    const tap = async (loc) => { taps++; await loc.click(); };
    await tap(aria(page, '波動 236'));
    await check(`${tag} 24d 方向を入れると候補が絞られる（入力と一致する技）。スクロール位置は先頭`, async () => {
      assert.deepEqual(await candNames(page), ['波動拳', '上段足刀蹴り']);
      assert.equal(await page.locator('#r1-scroll').getAttribute('aria-label'), '技名の候補 2件');
      assert.equal(await page.locator('#r1-scroll').evaluate((e) => e.scrollLeft), 0);
    });
    await tap(aria(page, '中P'));
    await check(`${tag} 24d 打つ回数: ［技名］オンで 236（プリセット）→中P の2タップで {special,236,P,M}。読み上げは「追加: 〈チップの読み上げ名〉」`, async () => {
      assert.equal(taps, 2);
      assert.deepEqual(await draft(page), [{ type: 'special', motion: '236', key: 'P', str: 'M' }]);
      await page.waitForFunction(() => document.getElementById('live').textContent === '追加: 中波動拳、波動 ↓↘→ 中P');
      assert.equal(await page.locator('.cmd .pending').count(), 0);
      assert.equal((await candNames(page)).length, 7); // 確定後は［技名］の状態に応じた中身へ戻る
    });
    taps = 0;
    await tap(cand(page, '昇龍拳'));
    await check(`${tag} 24d 候補を押すと選択中（aria-pressed）になり、方向がその技のコマンドに入って仮チップに出る。読み上げ「昇龍拳を選びました。Pの強さを押してください」`, async () => {
      assert.deepEqual(await pressed(page), ['昇龍拳']);
      assert.equal(await page.locator('.cmd .pending .arrow').count(), 3);
      assert.equal(await page.locator('.cmd .pending .ghost').count(), 1);
      assert.equal(await aria(page, '昇龍 623').getAttribute('aria-pressed'), 'true');
      assert.equal(await cand(page, '昇龍拳').getAttribute('aria-label'), '昇龍拳、昇龍 →↓↘ P');
      await page.waitForFunction(() => document.getElementById('live').textContent === '昇龍拳を選びました。Pの強さを押してください');
      assert.equal((await draft(page)).length, 1); // まだ確定していない
    });
    await shot(page, '24-edit-selected', width);
    await tap(aria(page, '弱P'));
    await check(`${tag} 24d 「昇龍拳」→弱P の2タップで {special,623,P,L}。確定すると選択は外れる`, async () => {
      assert.equal(taps, 2);
      assert.deepEqual((await draft(page)).at(-1), { type: 'special', motion: '623', key: 'P', str: 'L' });
      assert.deepEqual(await pressed(page), []);
      await page.waitForFunction(() => document.getElementById('live').textContent === '追加: 弱昇龍拳、昇龍 →↓↘ 弱P');
      assert.equal((await draft(page)).length, 2);
    });
    await check(`${tag} 24d リュウに派生はないので、親の直後でも▶付きの候補は出ない`, async () => assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 0));
    await cand(page, '波動拳').click();
    await cand(page, '波動拳').click();
    await check(`${tag} 24d 選択中をもう一度押すと選択と方向が外れる`, async () => {
      assert.deepEqual(await pressed(page), []);
      assert.equal(await page.locator('.cmd .pending').count(), 0);
      assert.equal((await draft(page)).length, 2);
    });
    await cand(page, '昇龍拳').click();
    await aria(page, '直前の入力を取り消す').click();
    await check(`${tag} 24d 候補を選んだあとの［消す］1回で、候補で入れたコマンドがまとめて消える（記録した技は消えない）`, async () => {
      assert.equal(await page.locator('.cmd .pending').count(), 0);
      assert.deepEqual(await pressed(page), []);
      assert.equal((await draft(page)).length, 2);
      assert.equal((await candNames(page)).length, 7);
    });
    await cand(page, '昇龍拳').click();
    await aria(page, '弱K').click();
    await check(`${tag} 24d 選んだ技と違うボタン（弱K）を押してもそのまま入る（{special,623,K,L}）`, async () => {
      assert.deepEqual((await draft(page)).at(-1), { type: 'special', motion: '623', key: 'K', str: 'L' });
      assert.deepEqual(await pressed(page), []);
    });
    await cand(page, '波動拳').click();
    await aria(page, '右').click();
    await check(`${tag} 24d 選択中に他の方向キーを押すと選択が外れる`, async () => assert.deepEqual(await pressed(page), []));
    await aria(page, '直前の入力を取り消す').click();
    await aria(page, '直前の入力を取り消す').click();
    await check(`${tag} 24d ［技名］オフ: R1は直近の技のまま（何も変えない）。もう一度押すと候補`, async () => {
      await nk.click();
      assert.equal(await nk.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#r1-scroll').getAttribute('aria-label'), '直近の技');
      assert.equal(await page.locator('#r1-scroll .key.cand').count(), 0);
      assert.ok(await page.locator('#r1-scroll .key').count() > 0);
      await nk.click();
      assert.equal(await nk.getAttribute('aria-pressed'), 'true');
      assert.equal((await candNames(page)).length, 7);
    });
    await check(`${tag} 24d 当てはまる技名がない（方向9）: 「当てはまる技名がありません」（12px・muted・高さ44）`, async () => {
      await aria(page, '右上').click();
      const e = page.locator('#r1-scroll');
      assert.equal(await e.innerText(), '当てはまる技名がありません');
      assert.deepEqual(await e.evaluate((x) => [x.className, getComputedStyle(x).fontSize, getComputedStyle(x).color, x.getBoundingClientRect().height]), ['recent-empty', '12px', MUTED, 44]);
      await aria(page, '直前の入力を取り消す').click();
      assert.equal((await candNames(page)).length, 7);
    });
    await check(`${tag} 24d ジャンプ選択中は空中の技だけ。候補を押すとジャンプ姿勢になり、{special,214,K,L,jump}`, async () => {
      await page.getByRole('radio', { name: 'ジャンプ', exact: true }).click();
      assert.deepEqual(await candNames(page), ['空中竜巻旋風脚']);
      await cand(page, '空中竜巻旋風脚').click();
      assert.equal(await page.getByRole('radio', { name: 'ジャンプ', exact: true }).getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('.cmd .pending .ltr').first().innerText(), 'J');
      await aria(page, '弱K').click();
      assert.deepEqual((await draft(page)).at(-1), { type: 'special', motion: '214', key: 'K', str: 'L', stance: 'jump' });
      assert.equal(await page.locator('.cmd .chip').last().evaluate((c) => c.querySelector('.sname').textContent), '弱空中竜巻旋風脚'); // 空中の技は名前だけ（Jを付けない）
      assert.equal(await page.locator('.cmd .chip').last().locator('.ltr:not(.sname)').count(), 0);
    });
    await check(`${tag} 24d 候補の領域の中身が変わるとスクロール位置が先頭に戻る`, async () => {
      assert.equal((await candNames(page)).length, 7);
      const before = await page.locator('#r1-scroll').evaluate((e) => { e.scrollLeft = 80; return e.scrollLeft; });
      assert.ok(before > 0, `scrollLeft ${before}`);
      await aria(page, '昇龍 623').click();
      assert.equal(await page.locator('#r1-scroll').evaluate((e) => e.scrollLeft), 0);
      await aria(page, '直前の入力を取り消す').click();
    });
    await check(`${tag} 24d キーボード: Tab で［技名］→ 候補 → ［完了］の順。Enter で候補を選べて aria-pressed="true"`, async () => {
      const names = await candNames(page);
      await nk.focus();
      const seen = [];
      for (let i = 0; i < names.length + 1; i++) {
        await page.keyboard.press('Tab');
        seen.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
      }
      assert.deepEqual(seen.slice(0, -1).map((l) => l.split('、')[0]), names);
      assert.equal(seen.at(-1), 'パッドを閉じて項目の入力へ');
      await nk.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      assert.deepEqual(await pressed(page), ['波動拳']);
      assert.equal(await page.locator('#r1-scroll .key.cand[aria-pressed="true"]').evaluate((k) => k === document.activeElement), true);
      await aria(page, '直前の入力を取り消す').click();
    });
    await check(`${tag} 24d ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();

    // 設定がコマンドなら［技名］は初期オフ。直近の技のまま
    const q = await newPage(width, seed24());
    await gotoHash(q, '#/c/ryu/new?s=s1');
    await check(`${tag} 24d 設定がコマンドなら［技名］は初期オフで R1 は直近の技。押すと候補、記録を離れて戻ると設定の初期値に戻る`, async () => {
      assert.equal(await q.locator('.name-key').getAttribute('aria-pressed'), 'false');
      assert.equal(await q.locator('#r1-scroll').getAttribute('aria-label'), '直近の技');
      await q.locator('.name-key').click();
      assert.equal(await q.locator('#r1-scroll .key.cand').count(), 7);
      await gotoHash(q, '#/c/ryu');
      await gotoHash(q, '#/c/ryu/new?s=s1');
      assert.equal(await q.locator('.name-key').getAttribute('aria-pressed'), 'false'); // ［技名］の状態は保存しない
      assert.ok(!(await storedRaw(q, 'sf6memo.settings') ?? '').includes('nameOn'));
    });
    await q.context().close();
  }

  // 24e 派生: 表示・読み上げ名・親が当たらないとき・引き直し・入力（受け入れ基準11・12・13・16）
  {
    const page = await named();
    await gotoHash(page, '#/c/arjun/r/a1');
    await check(`${tag} 24e アルジュンの236P▶6P（技名表示）: 「弱大義の巨腕」▶「追撃」。どちらも文字だけで●は出ない。読み上げ名は「〈派生名〉、〈親の技名〉の派生、→P」の形（通常技の形は「前P」）`, async () => {
      const c = await chipsInfo(page, '.d-cmd');
      assert.deepEqual(c.map((x) => x.name), ['弱大義の巨腕', '追撃']);
      assert.deepEqual(c.map((x) => x.dots), [[], []]);
      assert.deepEqual(c.map((x) => x.cmd), [false, false]);
      assert.deepEqual(c.map((x) => x.label), ['弱大義の巨腕、波動 ↓↘→ 弱P', '追撃、大義の巨腕の派生、前P']);
      assert.equal(await page.locator('.d-cmd .conn').count(), 1); // 親との間は既存の▶のまま
    });
    await shot(page, '24-detail-derived', width);
    await page.locator('.d-cmd .chip').nth(1).click();
    await shot(page, '24-popover-derived', width);
    await page.keyboard.press('Escape');
    await check(`${tag} 24e 親が辞書で技名の決まる必殺技でも、リュウの236P▶6P（派生なし）は6Pに技名が付かない`, async () => {
      await gotoHash(page, '#/c/ryu/r/c2');
      assert.deepEqual(await namesOf(page, '.d-cmd'), ['弱波動拳', null]);
    });
    await gotoHash(page, '#/c/arjun/r/a2');
    await check(`${tag} 24e 親が当たらないとき（行頭の6P・直前が辞書にない技・直前が別の技・移動・システム技・SAをはさむ）は技名なし。CHをはさめば技名が付く`, async () => {
      assert.deepEqual(await namesOf(page, '.d-cmd'), [null, null, null, '強神気の巨巌', '中大義の巨腕', null, null, '中大義の巨腕', null, null, '中大義の巨腕', null, null, '中大義の巨腕', '追撃']);
    });
    await gotoHash(page, '#/settings');
    await page.getByRole('radio', { name: 'コマンド' }).check();
    await gotoHash(page, '#/c/arjun/r/a1');
    await check(`${tag} 24e コマンド表示は今と同じ「↓↘→● ▶ →●」。読み上げ名は「→P、〈派生名〉、〈親の技名〉の派生」`, async () => {
      const c = await chipsInfo(page, '.d-cmd');
      assert.deepEqual(c.map((x) => x.name), [null, null]);
      assert.deepEqual(c.map((x) => x.cmd), [true, true]);
      assert.deepEqual(c.map((x) => x.label), ['波動 ↓↘→ 弱P、弱大義の巨腕', '前P、追撃、大義の巨腕の派生']);
      assert.equal(await page.locator('.d-cmd .chip').nth(1).locator('.arrow').count(), 1);
      assert.equal(await page.locator('.d-cmd .chip').nth(1).locator('.dot.str-n').count(), 1);
    });
    await gotoHash(page, '#/settings');
    await page.getByRole('radio', { name: '技名' }).check();

    // 引き直し（13）: 親の削除と取り消し、間への挿入、親の強度条件、複製
    await gotoHash(page, '#/c/arjun/r/a1/edit');
    const pop = page.locator('.popover');
    const opt = (n) => pop.getByRole('button', { name: n, exact: true });
    await check(`${tag} 24e 引き直し: 親を削除すると派生の技名が外れ、［元に戻す］で戻る`, async () => {
      assert.deepEqual(await namesOf(page, '.cmd'), ['弱大義の巨腕', '追撃']);
      await page.locator('.cmd .chip').first().click();
      await opt('削除').click();
      await pop.waitFor({ state: 'detached' });
      assert.deepEqual(await namesOf(page, '.cmd'), [null]);
      await page.locator('.toast-act').click();
      assert.deepEqual(await namesOf(page, '.cmd'), ['弱大義の巨腕', '追撃']);
    });
    await check(`${tag} 24e 引き直し: 親と派生の間に別の技を挿入すると外れる（取り消すと戻る）`, async () => {
      await page.locator('.cmd .chip').nth(1).click();
      await opt('この前に挿入').click();
      await pop.waitFor({ state: 'detached' });
      await aria(page, '中K').click();
      assert.deepEqual(await namesOf(page, '.cmd'), ['弱大義の巨腕', null, null]);
      await aria(page, '直前の入力を取り消す').click();
      assert.deepEqual(await namesOf(page, '.cmd'), ['弱大義の巨腕', '追撃']);
    });
    await check(`${tag} 24e 引き直し: 親の強度を条件の外へ変えると外れ、戻すと付く（不撓の警衛 強K▶P。親は強だけ）`, async () => {
      await gotoHash(page, '#/c/arjun/r/a3/edit');
      assert.deepEqual(await namesOf(page, '.cmd'), ['不撓の警衛', '倫理の崩壊']);
      await page.locator('.cmd .chip').first().click();
      await opt('弱').click();
      await pop.waitFor({ state: 'detached' });
      assert.deepEqual(await namesOf(page, '.cmd'), [null, null]);
      await page.locator('.cmd .chip').first().click();
      assert.deepEqual(await pop.locator('.pop-note').allInnerTexts(), ['技名なし（技の一覧にない入力）', '＝ 22（下下）']);
      await opt('強').click();
      await pop.waitFor({ state: 'detached' });
      assert.deepEqual(await namesOf(page, '.cmd'), ['不撓の警衛', '倫理の崩壊']);
    });
    await check(`${tag} 24e 編集で強度を変えると技名が引き直される（ポップオーバーで強度なし→「波動拳」、OD→「OD波動拳」）`, async () => {
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      await page.locator('.cmd .chip').nth(1).click();
      assert.equal(await pop.locator('.pop-name').innerText(), '中波動拳');
      await opt('強度なし').click();
      await pop.waitFor({ state: 'detached' });
      assert.equal((await namesOf(page, '.cmd'))[1], '波動拳');
      await page.locator('.cmd .chip').nth(1).click();
      assert.equal(await pop.locator('.pop-name').innerText(), '波動拳');
      await opt('OD').click();
      await pop.waitFor({ state: 'detached' });
      assert.equal((await namesOf(page, '.cmd'))[1], 'OD波動拳');
      assert.equal(await page.locator('.cmd .chip').nth(1).getAttribute('aria-label'), 'OD波動拳、OD 波動 ↓↘→ P');
    });
    await check(`${tag} 24e 複製した記録でも同じ技名`, async () => {
      await gotoHash(page, '#/c/arjun/r/a1');
      await page.getByRole('button', { name: '複製', exact: true }).click();
      await page.waitForFunction(() => /\/r\/(?!a1$)[\w-]+$/.test(location.hash));
      assert.deepEqual(await namesOf(page, '.d-cmd'), ['弱大義の巨腕', '追撃']);
    });
    await check(`${tag} 24e ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 24f 派生の入力（R1。受け入れ基準16）
  {
    const cand = (page, n) => page.locator('#r1-scroll .key.cand').filter({ has: page.locator('.cand-name', { hasText: new RegExp(`^${n}$`) }) });
    const draft = async (page, key) => JSON.parse(await storedRaw(page, 'sf6memo.drafts'))[key].tokens;
    const pressed = (page) => page.$$eval('#r1-scroll .key.cand', (ks) => ks.filter((k) => k.getAttribute('aria-pressed') === 'true').map((k) => k.querySelector('.cand-name').textContent));
    const page = await named();
    await gotoHash(page, '#/c/arjun/new?s=sa');
    await aria(page, '波動 236').click();
    await aria(page, '弱P').click();
    await check(`${tag} 24f 236Pの直後（カーソルがその後ろ）、［技名］オン: R1の先頭に▶付きの派生の候補「追撃」。読み上げ名は「追撃、大義の巨腕の派生、→ P」`, async () => {
      const first = page.locator('#r1-scroll .key.cand').first();
      assert.equal(await first.locator('.cand-name').innerText(), '追撃');
      assert.equal(await first.getAttribute('aria-label'), '追撃、大義の巨腕の派生、→ P');
      assert.equal(await first.locator('.cand-cmd .conn').count(), 1);
      assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 1); // 派生は1つだけ。残りは通常の必殺技
      const names = await page.$$eval('#r1-scroll .cand-name', (e) => e.map((x) => x.textContent));
      assert.deepEqual(names.slice(0, 3), ['追撃', '大義の巨腕', '厳酷な岩肩']);
      const conn = await first.locator('.conn').evaluate((c) => [getComputedStyle(c).color, c.getBoundingClientRect().width, c.getBoundingClientRect().height]);
      assert.deepEqual(conn, [CONN, 6, 8]);
    });
    await shot(page, '24-edit-derived-cands', width);
    await check(`${tag} 24f 強さの区別がない派生は1タップで入る（{normal, stand, dir:6, P, N}）。カーソルは派生の後ろへ移り、読み上げは「追加: …」`, async () => {
      await cand(page, '追撃').click();
      assert.deepEqual((await draft(page, 'new:sa')).at(-1), { type: 'normal', stance: 'stand', dir: 6, key: 'P', str: 'N' });
      assert.equal((await draft(page, 'new:sa')).length, 2);
      await page.waitForFunction(() => document.getElementById('live').textContent === '追加: 追撃、大義の巨腕の派生、前P');
      assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 0); // 追撃の派生はない
      assert.deepEqual(await namesOf(page, '.cmd'), ['弱大義の巨腕', '追撃']);
    });
    await check(`${tag} 24f カーソルを親の後ろ以外へ動かすと派生の候補は消える。親の後ろへ戻すと現れる`, async () => {
      await page.locator('.cmd .chip').nth(1).click(); // 追撃
      await page.locator('.popover').getByRole('button', { name: '削除', exact: true }).click();
      await page.locator('.popover').waitFor({ state: 'detached' });
      assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 1); // カーソルは親の後ろ
      await page.locator('.cmd .chip').first().click();
      await page.locator('.popover').getByRole('button', { name: 'この前に挿入', exact: true }).click();
      await page.locator('.popover').waitFor({ state: 'detached' });
      assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 0); // カーソルは親の前
      await page.getByRole('button', { name: '末尾へ', exact: true }).click();
      assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 1);
    });
    await check(`${tag} 24f ［技名］オフのときは何も変えない（直近の技のまま）。オンに戻すと派生の候補が先頭`, async () => {
      await page.locator('.name-key').click();
      assert.equal(await page.locator('#r1-scroll').getAttribute('aria-label'), '直近の技');
      assert.equal(await page.locator('#r1-scroll .cand-cmd .conn').count(), 0);
      await page.locator('.name-key').click();
      assert.equal(await page.locator('#r1-scroll .key.cand').first().locator('.cand-name').innerText(), '追撃');
    });
    await page.context().close();

    const kp = await named();
    await gotoHash(kp, '#/c/ken/new?s=sk');
    await check(`${tag} 24f 強さの区別がある派生（ケンの迅雷脚▶6K）は選択→強度キー。仮チップは矢印＋空の円、確定は {normal, stand, dir:6, K, H} で「閃火脚」`, async () => {
      await cand(kp, '迅雷脚').click();
      await kp.getByRole('button', { name: '中K', exact: true }).click();
      const first = kp.locator('#r1-scroll .key.cand').first();
      assert.equal(await first.locator('.cand-name').innerText(), '風鎌蹴り／轟雷落とし／閃火脚');
      assert.equal(await first.getAttribute('aria-label'), '風鎌蹴り／轟雷落とし／閃火脚、迅雷脚の派生、→ K');
      await first.click();
      assert.deepEqual(await pressed(kp), ['風鎌蹴り／轟雷落とし／閃火脚']);
      assert.equal((await draft(kp, 'new:sk')).length, 1); // 押しただけでは入らない
      assert.equal(await kp.locator('.cmd .pending .arrow').count(), 1);
      assert.equal(await kp.locator('.cmd .pending .ghost').count(), 1);
      await kp.getByRole('button', { name: '強K', exact: true }).click();
      assert.deepEqual((await draft(kp, 'new:sk')).at(-1), { type: 'normal', stance: 'stand', dir: 6, key: 'K', str: 'H' });
      assert.deepEqual(await namesOf(kp, '.cmd'), ['中迅雷脚', '閃火脚']);
      assert.equal(await kp.locator('.cmd .chip').last().getAttribute('aria-label'), '閃火脚、迅雷脚の派生、前強K');
    });
    await kp.context().close();

    const jp = await named();
    await gotoHash(jp, '#/c/kimberly/new?s=sx');
    await check(`${tag} 24f 方向のない区別ありの派生（キンバリーの疾駆け▶K）: 選択すると方向は空のまま、仮チップは空の円だけ。確定は {normal, stand, K, M}`, async () => {
      await cand(jp, '疾駆け').click();
      await jp.getByRole('button', { name: '弱K', exact: true }).click();
      const first = cand(jp, '胴刎ね／影すくい／首狩り'); // 同じ親の派生は「急停止」（強さの区別なし・押すと入る）も並ぶ
      assert.equal(await jp.locator('#r1-scroll .key.cand').first().locator('.cand-name').innerText(), '急停止');
      assert.equal(await first.locator('.cand-cmd .arrow').count(), 0);
      await first.click();
      assert.equal(await jp.locator('.cmd .pending .arrow').count(), 0);
      assert.equal(await jp.locator('.cmd .pending .ghost').count(), 1);
      await jp.getByRole('button', { name: '中K', exact: true }).click();
      assert.deepEqual((await draft(jp, 'new:sx')).at(-1), { type: 'normal', stance: 'stand', key: 'K', str: 'M' });
      assert.equal((await namesOf(jp, '.cmd')).at(-1), '影すくい');
    });
    await jp.context().close();
  }

  // 24j レビュー対応: R1の作り直しとフォーカス、派生のダブルタップ、失敗した強度キー、下書きへの漏れ
  {
    const cand = (page, n) => page.locator('#r1-scroll .key.cand').filter({ has: page.locator('.cand-name', { hasText: new RegExp(`^${n}$`) }) });
    const pressed = (page) => page.$$eval('#r1-scroll .key.cand', (ks) => ks.filter((k) => k.getAttribute('aria-pressed') === 'true').map((k) => k.querySelector('.cand-name').textContent));
    const draft = async (page, key) => JSON.parse(await storedRaw(page, 'sf6memo.drafts'))[key];
    const activeName = (page) => page.evaluate(() => document.activeElement.querySelector?.('.cand-name')?.textContent ?? document.activeElement.className);
    // フォーカス先がスクロール領域の中に見えているか（左右の端が領域の内側）
    const focusVisible = (page) => page.evaluate(() => {
      const a = document.activeElement.getBoundingClientRect(), s = document.getElementById('r1-scroll').getBoundingClientRect();
      return { in: a.left >= s.left - 1 && a.right <= s.right + 1, a: [a.left, a.right], s: [s.left, s.right] };
    });
    const padPos = (page) => page.evaluate(() => ({ top: document.getElementById('pad').getBoundingClientRect().top, y: window.scrollY }));

    const kp = await named();
    await gotoHash(kp, '#/c/ken/new?s=sk');
    await check(`${tag} 24j R1が作り直されてスクロールが先頭に戻っても、フォーカスを復元した候補（6番目の迅雷脚）は領域の中に見える。パッドの上端 y とページのスクロール位置は変わらない`, async () => {
      assert.equal((await kp.$$eval('#r1-scroll .cand-name', (e) => e.map((x) => x.textContent))).indexOf('迅雷脚'), 5);
      await cand(kp, '迅雷脚').click(); // 選択（候補が絞られる）
      const before = await padPos(kp);
      await cand(kp, '迅雷脚').click(); // 解除（全候補に戻り、スクロールは先頭）
      assert.deepEqual(await pressed(kp), []);
      assert.equal(await activeName(kp), '迅雷脚');
      const v = await focusVisible(kp);
      assert.ok(v.in, JSON.stringify(v));
      assert.deepEqual(await padPos(kp), before);
    });
    await check(`${tag} 24j 失敗した強度キー（方向なしの派生にOD）は選択中の候補を外さず、トークンも増えない。通知は出る`, async () => {
      await kp.getByRole('button', { name: '直前の入力を取り消す', exact: true }).click(); // 方向を外す
      await aria(kp, '波動 236').click();
      await aria(kp, '中K').click();
      const d = (await kp.locator('#r1-scroll .key.cand').first().locator('.cand-name').innerText());
      assert.equal(d, '風鎌蹴り／轟雷落とし／閃火脚');
      await kp.locator('#r1-scroll .key.cand').first().click();
      assert.deepEqual(await pressed(kp), [d]);
      await kp.getByRole('button', { name: 'OD K', exact: true }).click();
      assert.deepEqual(await pressed(kp), [d]); // 選択は残る
      assert.equal((await draft(kp, 'new:sk')).tokens.length, 1);
      assert.ok(await kp.locator('#toast').filter({ hasText: '先にモーションを選んでください' }).count());
      await kp.getByRole('button', { name: '強K', exact: true }).click(); // 続けて強度を押せば入る
      assert.equal((await draft(kp, 'new:sk')).tokens.length, 2);
      assert.deepEqual(await pressed(kp), []);
    });
    await check(`${tag} 24j 下書き（sf6memo.drafts）に［技名］の状態（nameOn）と選択中の候補（sel）は書かれない`, async () => {
      await kp.locator('#r1-scroll .key.cand').first().click(); // 候補を選択中にした状態で下書きを書かせる
      await kp.getByRole('button', { name: '強K', exact: true }).click();
      const raw = await storedRaw(kp, 'sf6memo.drafts');
      const dr = (await draft(kp, 'new:sk'));
      assert.deepEqual(Object.keys(dr).sort(), ['memo', 'position', 'savedAt', 'sectionId', 'tags', 'title', 'tokens']);
      assert.ok(!raw.includes('nameOn') && !raw.includes('"sel"'), raw);
    });
    await kp.context().close();

    const ap = await named();
    await gotoHash(ap, '#/c/arjun/new?s=sa');
    await aria(ap, '波動 236').click();
    await aria(ap, '弱P').click();
    await check(`${tag} 24j 派生の候補（追撃）をダブルタップしても、2回目のタップで別の候補が選択されない。約300ms後は通常どおり別の候補を選べる`, async () => {
      await cand(ap, '追撃').dblclick();
      assert.equal((await draft(ap, 'new:sa')).tokens.length, 2);
      assert.deepEqual(await pressed(ap), []);
      assert.equal(await ap.locator('.cmd .pending').count(), 0);
      await ap.waitForTimeout(450);
      await cand(ap, '大義の巨腕').click();
      assert.deepEqual(await pressed(ap), ['大義の巨腕']);
      await ap.getByRole('button', { name: '直前の入力を取り消す', exact: true }).click();
    });
    await check(`${tag} 24j Enter押しっぱなし（キーリピート）でも、派生の候補が続けて入らない`, async () => {
      await ap.getByRole('button', { name: '直前の入力を取り消す', exact: true }).click(); // 追撃を消して親の直後に戻る
      await ap.waitForTimeout(450);
      await cand(ap, '追撃').focus();
      await ap.keyboard.down('Enter');
      await ap.waitForTimeout(450); // 300msの受け付けない時間を過ぎてからのリピート
      await ap.keyboard.down('Enter'); // リピート（選択と解除の組にならないよう1回）
      await ap.keyboard.up('Enter');
      assert.equal((await draft(ap, 'new:sa')).tokens.length, 2);
      assert.deepEqual(await pressed(ap), []);
    });
    await ap.context().close();

    const rp = await named();
    await gotoHash(rp, '#/c/ryu/new?s=s1');
    await check(`${tag} 24j フォーカス復元: 候補にフォーカスがあれば同じ候補へ戻る（Enterで昇龍拳を選ぶ → 昇龍拳）`, async () => {
      await cand(rp, '昇龍拳').focus();
      await rp.keyboard.press('Enter');
      assert.deepEqual(await pressed(rp), ['昇龍拳']);
      assert.equal(await activeName(rp), '昇龍拳');
      await rp.keyboard.press('Enter'); // 解除
      assert.equal(await activeName(rp), '昇龍拳');
      assert.deepEqual(await pressed(rp), []);
    });
    await check(`${tag} 24j フォーカス復元: 同じ候補がなくなれば先頭の候補へ（アルジュンの追撃 → 先頭は大義の巨腕）。候補自体がなくなれば［技名］へ`, async () => {
      const q = await named();
      await gotoHash(q, '#/c/arjun/new?s=sa');
      await aria(q, '波動 236').click();
      await aria(q, '弱P').click();
      await cand(q, '追撃').focus();
      await q.keyboard.press('Enter'); // 追撃が入る。R1に追撃はなくなる
      assert.equal((await draft(q, 'new:sa')).tokens.length, 2);
      const first = await q.locator('#r1-scroll .key.cand').first().locator('.cand-name').innerText();
      assert.equal(await activeName(q), first);
      // 候補を作らない状態（［技名］オフ）へ、フォーカスを動かさずに切り替える
      await q.evaluate(() => document.querySelector('.name-key').click());
      assert.equal(await q.locator('#r1-scroll').getAttribute('aria-label'), '直近の技');
      assert.equal(await q.evaluate(() => document.querySelector('#r1-scroll.recent-keys button') === document.activeElement), true, '直近の技の先頭'); // 直近の技の先頭
      await q.context().close();
      const e = await named();
      await gotoHash(e, '#/c/kimberly/new?s=sx');
      await e.locator('#r1-scroll .key.cand').first().focus();
      await e.evaluate(() => document.querySelector('.name-key').click());
      assert.equal(await e.locator('#r1-scroll.recent-empty').count(), 1); // 直近の技もない
      assert.equal(await e.evaluate(() => document.activeElement.classList.contains('name-key')), true, '［技名］');
      await e.context().close();
    });
    await rp.context().close();
  }

  // 24g 寸法・色・幅（受け入れ基準4・6・8）
  {
    const page = await named();
    await gotoHash(page, '#/c/arjun/new?s=sa');
    const want = width - 12 - 52 - 64 - 8; // 見える幅: 360で224、390で254、430で294（design-spec-v2.2 1章）
    const snap = (state) => page.evaluate((st) => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const pad = r('.pad'), r1 = r('.r1'), sc = r('#r1-scroll'), nk = r('.name-key'), dn = r('.done');
      return { st, padH: pad.height, padTop: pad.top, r1H: r1.height, scW: sc.width, nk: [nk.width, nk.height], dn: [dn.width, dn.height], h: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        cands: [...document.querySelectorAll('#r1-scroll .key')].map((k) => { const b = k.getBoundingClientRect(); return [Math.round(b.width), b.height]; }) };
    }, state);
    const states = [];
    states.push(await snap('オン・方向なし'));
    await page.locator('.name-key').click();
    states.push(await snap('オフ（直近の技）'));
    await page.locator('.name-key').click();
    await aria(page, '波動 236').click();
    states.push(await snap('オン・方向あり'));
    await page.locator('#r1-scroll .key.cand').first().click();
    states.push(await snap('候補を選択中'));
    await aria(page, '直前の入力を取り消す').click();
    await aria(page, '右上').click();
    states.push(await snap('当てはまるものがない'));
    await aria(page, '直前の入力を取り消す').click();
    await aria(page, '波動 236').click();
    await aria(page, '弱P').click();
    states.push(await snap('派生の候補が先頭'));
    await page.getByRole('radio', { name: 'ジャンプ', exact: true }).click();
    states.push(await snap('ジャンプ（空中の技がない=当てはまるものがない）'));
    await check(`${tag} 24g R1のどの状態でも、パッド414・R1 44・パッド上端 y≥326、［技名］52×44、［完了］64×44、候補は44×44以上、見える幅は${want}`, async () => {
      for (const s of states) {
        assert.equal(s.padH, 414, s.st);
        assert.equal(s.r1H, 44, s.st);
        assert.ok(s.padTop >= 326, `${s.st} ${s.padTop}`);
        assert.equal(s.scW, want, s.st);
        assert.deepEqual([s.nk, s.dn], [[52, 44], [64, 44]], s.st);
        assert.equal(s.h, true, `${s.st} 横スクロール`);
        for (const [w, h] of s.cands) assert.ok(w >= 44 && h >= 44, `${s.st} ${w}x${h}`);
      }
      for (const s of states.filter((x) => /オン|候補|派生/.test(x.st))) for (const [w] of s.cands) assert.ok(w >= 64, `${s.st} 候補の幅 ${w}`);
      assert.equal(states.length, 7);
    });
    await page.getByRole('radio', { name: 'ジャンプ', exact: true }).click(); // 立ちへ戻す
    await check(`${tag} 24g 新しい要素の色は既存のトークンの値（技名のチップ fg、候補の名前 fg、P/K muted、▶ conn、候補の地 key）。▶と地の比は3:1以上。filter・backdrop-filter・gradient なし`, async () => {
      const r = await page.evaluate(() => {
        const cs = (s) => getComputedStyle(document.querySelector(s));
        return { name: cs('.cand-name').color, btn: cs('.cand-btn').color, conn: cs('.cand-cmd .conn').color, key: cs('.key.cand').backgroundColor, border: cs('.key.cand').borderTopColor, sname: cs('.cmd .sname').color, nk: cs('.name-key').color };
      });
      assert.deepEqual([r.name, r.btn, r.conn, r.key, r.border, r.sname, r.nk], [FG, MUTED, CONN, 'rgb(34, 37, 42)', 'rgb(74, 80, 89)', FG, FG]);
      const lum = (c) => { const [a, b, d] = c.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * a + 0.7152 * b + 0.0722 * d; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      assert.ok(ratio(r.conn, r.key) >= 3, `▶/key ${ratio(r.conn, r.key)}`);
      assert.ok(ratio(r.name, r.key) >= 13, `名前/key ${ratio(r.name, r.key)}`);
      assert.ok(ratio(r.btn, r.key) >= 6, `P/K/key ${ratio(r.btn, r.key)}`);
      assert.deepEqual(await forbidden(page), []);
    });
    await check(`${tag} 24g 編集画面（候補が並ぶ状態）は横スクロールなし。ページエラーなし`, async () => {
      assert.ok(await noHScroll(page));
      assert.deepEqual(page.errors, []);
    });
    await page.context().close();
  }

  // 24h 幅: 最長の技名＋ODのLチップが行の幅以下。技名表記の各画面に横スクロールがない
  {
    const page = await named();
    await gotoHash(page, '#/c/cammy/r/m1');
    await check(`${tag} 24h キャミィ「ODフーリガンコンビネーション」（最長の技名＋OD）のLチップが行の clientWidth 以下。折り返さない`, async () => {
      assert.deepEqual(await namesOf(page, '.d-cmd'), ['ODフーリガンコンビネーション', '強フーリガンコンビネーション']);
      const r = await page.$eval('.d-cmd .row', (row) => ({ w: row.clientWidth, chips: [...row.querySelectorAll('.chip')].map((c) => { const b = c.getBoundingClientRect(); return [b.width, b.height]; }) }));
      for (const [w, h] of r.chips) assert.ok(w <= r.w && h <= 36, JSON.stringify(r));
    });
    await shot(page, '24-detail-long', width);
    await check(`${tag} 24h 技名表記で、一覧・詳細・編集・設定・凡例のいずれにも横スクロールがない`, async () => {
      for (const h of ['#/', '#/c/ryu', '#/c/cammy', '#/c/arjun/r/a2', '#/c/cammy/r/m1', '#/c/arjun/r/a2/edit', '#/c/cammy/new?s=sc', '#/settings']) {
        await gotoHash(page, h);
        assert.ok(await noHScroll(page), h);
      }
      await gotoHash(page, '#/c/arjun/r/a2');
      await page.locator('button[aria-label="凡例を開く"]').click();
      await page.waitForSelector('.sheet.tall');
      assert.ok(await noHScroll(page), '凡例');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
    });
    await check(`${tag} 24h ページエラーなし`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 24i 辞書がないとき（辞書を空にした場合。D-018の取り下げ手順）: ［技名］は無効、表示はコマンドのまま
  {
    const page = await named();
    await page.route('**/specials.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const SPECIALS = {};' }));
    await page.reload();
    await gotoHash(page, '#/c/ryu/new?s=s1');
    const nk = page.locator('.name-key');
    await check(`${tag} 24i 辞書がない: ［技名］は aria-disabled="true"（フォーカスは受ける・文字は muted）、押すとトースト、R1は直近の技のまま`, async () => {
      assert.equal(await nk.getAttribute('aria-disabled'), 'true');
      assert.equal(await nk.getAttribute('aria-pressed'), 'false'); // 設定が技名でも辞書がなければオフ
      assert.equal(await nk.evaluate((k) => getComputedStyle(k).color), MUTED);
      await nk.focus();
      assert.equal(await nk.evaluate((k) => k === document.activeElement), true);
      await nk.click({ force: true }); // aria-disabled は Playwright の actionability では無効扱いなので強制する
      assert.equal(await page.locator('#toast').innerText(), 'このキャラの技名はまだ入っていません');
      assert.equal(await nk.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#r1-scroll .key.cand').count(), 0);
      assert.equal(await page.locator('#r1-scroll').getAttribute('aria-label'), '直近の技');
    });
    await check(`${tag} 24i 辞書がなければ設定が「技名」でも一覧・詳細はコマンド表示、ポップオーバーに技名の行がない`, async () => {
      await gotoHash(page, '#/c/ryu/r/c1');
      assert.deepEqual(await namesOf(page, '.d-cmd'), Array(7).fill(null));
      assert.equal((await chipsInfo(page, '.d-cmd'))[1].label, '波動 ↓↘→ 中P');
      await page.locator('.d-cmd .chip').nth(1).click();
      assert.deepEqual(await page.locator('.popover .pop-note').allInnerTexts(), ['＝ 236（波動）']);
    });
    await page.context().close();
  }
}

await finish();
async function finish() {
  await browser.close();
  console.log(`e2e: ${checks - failures.length}/${checks} checks passed`);
  if (failures.length) {
    console.log(failures.map((f) => `FAIL ${f}`).join('\n'));
    process.exit(1);
  }
  process.exit(0);
}
