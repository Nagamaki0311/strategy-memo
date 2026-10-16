// ブラウザ検証（T-008〜T-011）。`npm test` には含めない。依存はリポジトリに入れず、グローバルの Playwright を使う。
// 使い方（リポジトリルートで）:
//   1. python3 -m http.server 8000 &      # リポジトリルートを配信する（BASE で配信先を変えられる。既定 http://localhost:8000/app/index.html）
//   2. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e.mjs
//      - Playwright は /opt/node-tools/node_modules のグローバル版（1.56.1）を使う。リポジトリには依存を足さない。`playwright install` は不要。
//      - FAST=1 を付けると、時間のかかるトーストの一時停止の検証（約30秒）を省く。
//      - SHOTS=<dir> を指定すると360幅（と430幅）のスクリーンショットを保存する（目視用。判定には使わない）。
//      - Service Worker（19章）は、このファイルが立てる専用の静的サーバー（localhost、ルートとサブパス）で検証する。BASE は使わない。
//        SW_APP=<dir> で配信する app/ を差し替えられる（変異テスト用の app/ のコピー）。ONLY_SW=1 で19章だけ、ONLY_24=1 で24章（技名。360・390・430幅）だけ、ONLY_28=1 で28章（一覧のタイトル）だけ、ONLY_25=1 で25章（メモの文字サイズ。360・390・430幅）だけ、ONLY_26=1 で26章（連携・分岐。360・390・430幅）だけ実行する。SHOTS は360幅と430幅を保存する（430幅は名前の末尾に -430）。
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
import { exportDoc, CHARACTERS, neonLevel, childrenOf, descendantTree } from '../app/core.js';

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
    if (process.env.LIVE) console.log(`FAIL ${failures.at(-1)}`); // LIVE=1: 不合格をその場で表示する（長い章の途中経過）
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

for (const width of process.env.ONLY_24 || process.env.ONLY_25 || process.env.ONLY_26 || process.env.ONLY_28 ? [] : [360, 430]) {
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

for (const width of process.env.ONLY_24 || process.env.ONLY_25 || process.env.ONLY_26 || process.env.ONLY_28 ? [] : [360, 430]) {
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
    await page.evaluate(() => { window.__screen = document.querySelector('.screen'); });
    await page.getByRole('button', { name: '複製', exact: true }).click();
    await page.waitForFunction(() => { const s = document.querySelector('.screen'); return location.hash !== '#/c/ryu/r/c1' && s && s !== window.__screen && s.getAnimations().length === 0; }); // 画面の入れ替わりまで待つ（hash が変わっただけでは描画前に .d-title を読む）
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
      await page.evaluate(() => { window.__screen = document.querySelector('.screen'); });
      await page.getByRole('button', { name: '複製' }).click();
      await page.waitForFunction(() => { const s = document.querySelector('.screen'); return location.hash !== '#/c/ryu/r/c1' && s && s !== window.__screen && s.getAnimations().length === 0; });
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
        assert.deepEqual((await toast(page)).filter((t) => /取り込みました/.test(t)), []); // 成功のトーストは出ない（直前の書き出しのトーストは、保存に失敗した操作では消さずに時間で消える）
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
      await check(`${tag} 20b 保存→再読み込みで、詳細のコマンド列が入力直後と同じDOM。保存データは版3`, async () => {
        await page.waitForSelector('.d-cmd .row');
        assert.equal(await page.$eval('.d-cmd .row', normRow), typedDom);
        assert.equal(original.schemaVersion, 3);
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
      await check(`${tag} 20b 書き出し（版3）→全削除→取り込みで、前ステ・バクステを含む記録が一致する`, async () => {
        assert.equal(JSON.parse(text).schemaVersion, 3);
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

    // 20e データの版: 版1はそのまま読めて、保存後は版3。版4は読み込みエラー（読み取り専用、既存値を上書きしない）
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
      await check(`${tag} 20e 編集・保存の後は版3になり、記録は失われない`, async () => {
        const d = await stored(page);
        assert.equal(d.schemaVersion, 3);
        assert.equal(d.combos.length, 3);
        assert.equal(d.combos.find((c) => c.id === 'c1').title, '版1から編集');
        assert.deepEqual(d.combos.find((c) => c.id === 'c2'), seed.combos[1]);
      });
      await page.context().close();

      const v4 = JSON.stringify({ ...exportDoc(seed), schemaVersion: 4 });
      const p3 = await newPage(width, null);
      await p3.evaluate((t) => localStorage.setItem('sf6memo.data', t), v4);
      await p3.reload();
      await check(`${tag} 20e 版4は読み込みエラー（理由を表示、読み取り専用、保存データを上書きしない）`, async () => {
        const t = await p3.locator('.banners').innerText();
        assert.match(t, /保存データを読み込めませんでした/);
        assert.match(t, /新しい版\(schemaVersion 4\)/);
        assert.match(t, /読み取り専用/);
        await gotoHash(p3, '#/c/ryu');
        assert.equal(await p3.locator('.bottombar').count(), 0); // 記録・セクションの追加はできない
        assert.equal(await storedRaw(p3), v4);
        assert.match(await p3.locator('.empty').innerText(), /記録はありません/);
      });
      await check(`${tag} 20e ページエラーなし`, async () => assert.deepEqual(p3.errors, []));
      await p3.context().close();

      // 取り込み: 版1のファイルは受け付け（確認シートが開く）、版4は拒否（データ不変）
      const imp = await newPage(width, seedState());
      await gotoHash(imp, '#/settings');
      const before = await storedRaw(imp);
      await imp.locator('input[type=file]').setInputFiles({ name: 'v4.json', mimeType: 'application/json', buffer: Buffer.from(v4) });
      await check(`${tag} 20e 取り込み: 版4のファイルは「新しい版」で拒否され、データは変わらない`, async () => {
        await imp.waitForFunction(() => /新しい版\(schemaVersion 4\)/.test(document.querySelector('.set-err')?.textContent ?? ''));
        assert.equal(await storedRaw(imp), before);
      });
      const extra = { ...exportDoc({ sections: [sec('x1', 'ken', '通常', 0)], combos: [] }), schemaVersion: 1 };
      await imp.locator('input[type=file]').setInputFiles({ name: 'v1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(extra)) });
      await imp.waitForSelector('.sheet');
      await check(`${tag} 20e 取り込み: 版1のファイルは受け付けられ、取り込み後の保存データは版3`, async () => {
        assert.match(await imp.locator('.sheet').innerText(), /追加 1件/);
        await imp.getByRole('button', { name: '取り込む', exact: true }).click();
        await imp.waitForSelector('.sheet', { state: 'detached' });
        const d = await stored(imp);
        assert.equal(d.schemaVersion, 3);
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
for (const width of process.env.ONLY_25 || process.env.ONLY_26 || process.env.ONLY_28 ? [] : [360, 390, 430]) {
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
      assert.equal(d.schemaVersion, 3);
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

// ===== SECTION: 25 メモの文字サイズ（T-025。D-020、design-spec-v2.3） =====
// 360・390・430幅。設定 memoSize（l・m・s）と、メモの内容（詳細・編集・一覧のコマンド列、メモ本文・ダメージ）だけが縮むこと、それ以外が動かないこと。
// 段階の寸法の期待値は design-spec-v2.3 の表を直接書く（styles.css から読まない）。
for (const width of process.env.ONLY_26 || process.env.ONLY_28 ? [] : [360, 390, 430]) {
  const tag = `[${width}]`;
  const SIZES = ['l', 'm', 's'];
  // コマンド列の寸法（design-spec-v2.3 2章）。dot=丸（幅・高さ）、arrow=矢印、chipH=システム技の高さ（chip-h）、tagH=注記の高さ（tag-h）、fs=Jの文字、ov=ODの重なり（左マージン）、conn=▶の幅×高さ
  const DETAIL = {
    l: { dot: [34, 34], arrow: 22, chipH: 34, tagH: 20, fs: '15px', ov: -8, conn: [8, 10] },
    m: { dot: [29, 29], arrow: 19, chipH: 29, tagH: 18, fs: '13px', ov: -7, conn: [7, 9] },
    s: { dot: [24, 24], arrow: 15, chipH: 24, tagH: 16, fs: '12px', ov: -6, conn: [6, 8] },
  };
  const PREVIEW = {
    l: { dot: [24, 24], arrow: 15, chipH: 24, tagH: 16, fs: '12px', ov: -6, conn: [6, 8], h: 28 },
    m: { dot: [21, 21], arrow: 14, chipH: 21, tagH: 16, fs: '12px', ov: -5, conn: [5, 7], h: 25 },
    s: { dot: [18, 18], arrow: 12, chipH: 18, tagH: 16, fs: '12px', ov: -4, conn: [5, 7], h: 22 },
  };
  const TEXT = { // 詳細の .d-meta・.d-stat-n・.d-memo p、一覧の .dmg b
    l: { meta: '13px', dmg: '20px', memo: '15px', ldmg: '13px' },
    m: { meta: '12px', dmg: '18px', memo: '14px', ldmg: '12px' },
    s: { meta: '12px', dmg: '16px', memo: '13px', ldmg: '12px' },
  };
  const NN = (stance, str, key, dir) => ({ type: 'normal', stance, key, str, ...(dir && { dir }) });
  const ALLK = [{ type: 'note', id: 'CH' }, NN('crouch', 'M', 'K'), SP('236', 'H', 'P'), { type: 'system', id: 'CDR' }, SP('623', 'OD', 'P'), SP('[4]6', 'M', 'K'), NN('jump', 'H', 'K', 9), { type: 'system', id: 'DI' }, { type: 'system', id: 'REVERSAL' }, { type: 'sa', level: 3 }, { type: 'move', id: 'FWD_STEP' }, NN('stand', 'N', 'P')];
  const seed25 = () => ({
    sections: [sec('s1', 'ryu', '通常', 0)],
    combos: [
      combo('c1', 's1', '全部入り', ALLK, { tags: ['基本', '画面端'], damage: 3200, position: 'corner', memo: '中足から波動拳をキャンセルして、CDRで追いかける。\n最後はSA3まで入れる。' }),
      combo('c2', 's1', '長いコンボ', LONG, { damage: 1800 }),
      combo('c3', 's1', '1行', [{ type: 'note', id: 'CH' }, NN('crouch', 'M', 'K'), SP('236', 'H', 'P')]), // 1行に収まる（折り返すと下の行の当たり領域が重なる）
    ],
  });
  const setSettings = async (page, obj) => { await page.evaluate((o) => localStorage.setItem('sf6memo.settings', JSON.stringify(o)), obj); await page.reload(); };
  const sized = async (sz, extra = {}, seed = seed25()) => { const page = await newPage(width, seed); await setSettings(page, { memoSize: sz, ...extra }); return page; };
  const rowDims = (page, root) => page.$eval(`${root} .row`, (row) => {
    const cs = (e) => getComputedStyle(e);
    const od = row.querySelectorAll('.dot.od');
    const arrow = row.querySelector('.arrow');
    const br = row.querySelector('.br');
    const conn = row.querySelector('.conn');
    const dot = row.querySelector('.dot');
    return {
      dot: [dot.offsetWidth, dot.offsetHeight], arrow: parseFloat(cs(arrow).width), chipH: row.querySelector('.sys-dr').offsetHeight, tagH: row.querySelector('.tag').offsetHeight,
      fs: cs(row.querySelector('.ltr:not(.od):not(.sname):not(.neutral)')).fontSize, ov: parseFloat(cs(od[1]).marginLeft), conn: [parseFloat(cs(conn).width), parseFloat(cs(conn).height)],
      stroke: parseFloat(cs(row).getPropertyValue('--br-sw')) * parseFloat(cs(arrow).width) / 24, brW: parseFloat(cs(br).width), brArrow: parseFloat(cs(arrow).width),
    };
  });
  const same = (got, want) => { const { stroke, brW, brArrow, ...rest } = got; const { h: _h, ...w } = want; assert.deepEqual(rest, w, JSON.stringify(got)); assert.ok(stroke >= 2.4 && stroke <= 2.6, `括弧の線幅 ${stroke}`); assert.equal(brW, brArrow / 4); };
  const settingsRaw = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sf6memo.settings')));
  const memoSet = (page) => page.locator('fieldset:has(legend:text("メモの文字サイズ"))');

  // 25a 設定: 既定・保存・再読み込み・不正値・キー単位マージ・保存データに入らない
  {
    const page = await newPage(width, seed25());
    await gotoHash(page, '#/settings');
    await check(`${tag} 25a 設定「メモの文字サイズ」［大｜中｜小］は表示の節の最後（補助文字の次）。初期は大、html の data-memo-size は l`, async () => {
      assert.deepEqual(await memoSet(page).locator('.seg-item').allInnerTexts(), ['大', '中', '小']);
      assert.equal(await page.getByRole('radio', { name: '大', exact: true }).isChecked(), true);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.memoSize), 'l');
      assert.ok(await noHScroll(page));
    });
    await page.getByRole('radio', { name: '中', exact: true }).check();
    await check(`${tag} 25a 中を選ぶと即時に保存（sf6memo.settings の memoSize）され、html の data-memo-size が m。再読み込みしても保たれる`, async () => {
      assert.equal((await settingsRaw(page)).memoSize, 'm');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.memoSize), 'm');
      await page.reload();
      assert.equal(await page.getByRole('radio', { name: '中', exact: true }).isChecked(), true);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.memoSize), 'm');
    });
    await check(`${tag} 25a 保存データ（sf6memo.data）と書き出しの文書に表示設定は入らない。データは変わらない`, async () => {
      const raw = await storedRaw(page);
      assert.ok(!raw.includes('memoSize'));
      assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(exportDoc(seed25()))));
      await gotoHash(page, '#/c/ryu/r/c1'); // 保存（複製）のあとも、データに memoSize は入らず、設定に残る
      await page.getByRole('button', { name: '複製', exact: true }).click();
      await page.waitForSelector('.toast');
      assert.equal((await stored(page)).combos.length, 4);
      assert.ok(!(await storedRaw(page)).includes('memoSize'));
      assert.equal((await settingsRaw(page)).memoSize, 'm');
      await gotoHash(page, '#/settings');
    });
    await page.getByRole('radio', { name: '小', exact: true }).check();
    await page.reload();
    await check(`${tag} 25a 小 → 再読み込みで保たれる。大へ戻すと l`, async () => {
      assert.equal((await settingsRaw(page)).memoSize, 's');
      await page.getByRole('radio', { name: '大', exact: true }).check();
      assert.equal((await settingsRaw(page)).memoSize, 'l');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.memoSize), 'l');
    });
    await page.context().close();

    await check(`${tag} 25a 不正値（'x'・3・null・'M'・['m']・{}・true・''・'ｍ'）は大になり、ほかのキー（数字表記・最近のキャラ）は保たれる`, async () => {
      for (const v of ['x', 3, null, 'M', ['m'], {}, true, '', 'ｍ']) {
        const p = await newPage(width, seed25());
        await setSettings(p, { memoSize: v, notation: 'numpad', recentCharacters: ['ken'] });
        assert.equal(await p.evaluate(() => document.documentElement.dataset.memoSize), 'l', JSON.stringify(v));
        await gotoHash(p, '#/settings');
        assert.equal(await p.getByRole('radio', { name: '大', exact: true }).isChecked(), true, JSON.stringify(v));
        assert.equal(await p.getByRole('radio', { name: '数字', exact: true }).isChecked(), true);
        assert.deepEqual((await settingsRaw(p)).recentCharacters, ['ken']);
        await p.context().close();
      }
      const old = await newPage(width, seed25()); // 設定が壊れた・memoSize を持たない旧い保存（D-014）
      await setSettings(old, { notation: 'numpad' });
      assert.equal(await old.evaluate(() => document.documentElement.dataset.memoSize), 'l');
      await old.context().close();
    });
    await check(`${tag} 25a 別タブとのマージはキー単位（A が中を選ぶ → 古い B が数字へ変える → 保存は memoSize m と numpad の両方）`, async () => {
      const a = await newPage(width, seed25());
      const b = await a.context().newPage();
      await b.goto(BASE);
      await gotoHash(a, '#/settings');
      await gotoHash(b, '#/settings');
      await a.getByRole('radio', { name: '中', exact: true }).check();
      await b.getByRole('radio', { name: '数字', exact: true }).check();
      const st = await settingsRaw(a);
      assert.equal(st.memoSize, 'm');
      assert.equal(st.notation, 'numpad');
      await a.context().close();
    });
  }

  // 25b 見本: 選択中の段階のコマンド列と本文を描く。ほかの3つの見本（方向・必殺技・補助文字）は動かない
  {
    for (const sz of SIZES) {
      const page = await sized(sz);
      await gotoHash(page, '#/settings');
      await check(`${tag} 25b 見本（${sz}）: メモの文字サイズの見本は段階の寸法（丸${DETAIL[sz].dot[0]}）と本文${TEXT[sz].memo}。ほかの3つの見本の丸は34のまま`, async () => {
        const r = await page.evaluate(() => {
          const fld = (l) => [...document.querySelectorAll('.fld')].find((f) => f.querySelector('legend')?.textContent === l);
          const own = fld('メモの文字サイズ').querySelector('.set-sample');
          return {
            dot: own.querySelector('.d-cmd .dot').offsetWidth, memo: getComputedStyle(own.querySelector('.d-memo p')).fontSize, memoText: own.querySelector('.d-memo p').textContent.length > 10, tag: own.querySelector('.tag') !== null,
            others: ['方向の表記', '必殺技の表記', 'ボタンの補助文字'].map((l) => fld(l).querySelector('.set-sample .dot')?.offsetWidth ?? null),
          };
        });
        assert.deepEqual(r, { dot: DETAIL[sz].dot[0], memo: TEXT[sz].memo, memoText: true, tag: true, others: [34, 34, 34] });
        assert.ok(await noHScroll(page));
      });
      await page.context().close();
    }
  }

  // 25c 詳細: コマンド列・メモ本文・ダメージが段階の寸法。タイトル・見出し・ラベルは動かない
  for (const sz of SIZES) {
    const page = await sized(sz);
    await gotoHash(page, '#/c/ryu/r/c1');
    await check(`${tag} 25c 詳細（${sz}）: 丸${DETAIL[sz].dot[0]}・矢印${DETAIL[sz].arrow}・システム技の高さ${DETAIL[sz].chipH}・注記${DETAIL[sz].tagH}・J ${DETAIL[sz].fs}・ODの重なり${-DETAIL[sz].ov}・▶ ${DETAIL[sz].conn.join('×')}・括弧の線幅は約2.5px`, async () => {
      same(await rowDims(page, '.d-cmd'), DETAIL[sz]);
    });
    await check(`${tag} 25c 詳細（${sz}）: 位置・タグの行 ${TEXT[sz].meta}、ダメージ ${TEXT[sz].dmg}、メモ本文 ${TEXT[sz].memo}。タイトル17px・「メモ」の見出し13px・「ダメージ」のラベル12pxは動かない`, async () => {
      const r = await page.evaluate(() => { const f = (s) => getComputedStyle(document.querySelector(s)).fontSize; return { meta: f('.d-meta'), dmg: f('.d-stat-n'), memo: f('.d-memo p'), title: f('.d-title'), h: f('.d-memo-h'), l: f('.d-stat-l') }; });
      assert.deepEqual(r, { meta: TEXT[sz].meta, dmg: TEXT[sz].dmg, memo: TEXT[sz].memo, title: '17px', h: '13px', l: '12px' });
    });
    await check(`${tag} 25c 詳細（${sz}）: 横スクロールなし。ページエラーなし`, async () => { assert.ok(await noHScroll(page)); assert.deepEqual(page.errors, []); });
    await shot(page, `25-detail-${sz}`, width);
    await page.context().close();
  }

  // 25d 一覧: プレビューのコマンド列・ダメージ・1行のメタ。プレビューの高さは段階に合わせる
  for (const sz of SIZES) {
    const page = await sized(sz);
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 25d 一覧（${sz}）: プレビューの丸${PREVIEW[sz].dot[0]}・矢印${PREVIEW[sz].arrow}・システム技の高さ${PREVIEW[sz].chipH}・注記${PREVIEW[sz].tagH}・ODの重なり${-PREVIEW[sz].ov}・▶ ${PREVIEW[sz].conn.join('×')}、プレビューの高さ${PREVIEW[sz].h}`, async () => {
      const got = await rowDims(page, '.item:has(.item-title:text("全部入り")) .preview');
      same(got, PREVIEW[sz]);
      assert.equal(await page.locator('.item:has(.item-title:text("全部入り")) .preview').evaluate((e) => e.getBoundingClientRect().height), PREVIEW[sz].h);
    });
    await check(`${tag} 25d 一覧（${sz}）: ダメージの数字 ${TEXT[sz].ldmg}。メタの行（位置・タグ・手数）は12px、タイトル15px`, async () => {
      const r = await page.evaluate(() => { const f = (s) => getComputedStyle(document.querySelector(s)).fontSize; return { dmg: f('.dmg b'), meta: f('.meta-t'), title: f('.item-title') }; });
      assert.deepEqual(r, { dmg: TEXT[sz].ldmg, meta: '12px', title: '15px' });
    });
    await check(`${tag} 25d 一覧（${sz}）: 補助文字オンでもプレビューは補助文字の板を切らない（高さ ${{ l: 28, m: 26, s: 24 }[sz]}）。横スクロールなし`, async () => {
      await setSettings(page, { memoSize: sz, strengthLabels: true });
      const h = await page.$eval('.item:has(.item-title:text("全部入り")) .preview', (pv) => pv.getBoundingClientRect().height);
      assert.equal(h, { l: 28, m: 26, s: 24 }[sz]);
      // 1行目の板が切れないことは、25d のスクリーンショット（補助文字オン）の目視で確かめた（docs/design-spec-v2.3.md）
      assert.ok(await noHScroll(page));
    });
    await check(`${tag} 25d 一覧（${sz}）: 技名だけの行が折り返しても、2行目は見えない（補助文字オン・オフ）`, async () => {
      const NAMES = [SP('236', 'M', 'P'), SP('623', 'H', 'P'), SP('214', 'OD', 'K'), SP('236', 'L', 'P'), SP('623', 'M', 'P'), SP('214', 'L', 'K')];
      const p2 = await sized(sz, { specialNotation: 'name' }, { sections: [sec('s1', 'ryu', '通常', 0)], combos: [combo('n1', 's1', '技名だけ', [...NAMES, ...NAMES, ...NAMES, ...NAMES])] });
      await gotoHash(p2, '#/c/ryu');
      for (const sl of [false, true]) {
        await setSettings(p2, { memoSize: sz, specialNotation: 'name', strengthLabels: sl });
        const r = await p2.$eval('.preview', (pv) => {
          const chips = [...pv.querySelectorAll('.chip')], t0 = chips[0].getBoundingClientRect().top, pb = pv.getBoundingClientRect().bottom;
          const wrapped = chips.filter((c) => c.getBoundingClientRect().top > t0 + 1);
          return { wrapped: wrapped.length, visible: wrapped.filter((c) => c.getBoundingClientRect().top < pb).length };
        });
        assert.ok(r.wrapped >= 1, `折り返しがない ${JSON.stringify(r)}`);
        assert.equal(r.visible, 0, `strengthLabels=${sl} ${JSON.stringify(r)}`);
      }
      await p2.context().close();
    });
    await shot(page, `25-list-${sz}`, width);
    await page.context().close();
  }

  // 25e 編集: コマンド列（.cmd）だけが段階の寸法。入力欄・タグのpill・パッドは動かない
  for (const sz of SIZES) {
    const page = await sized(sz);
    await gotoHash(page, '#/c/ryu/r/c1/edit');
    await check(`${tag} 25e 編集（${sz}）: 行の丸${DETAIL[sz].dot[0]}・矢印${DETAIL[sz].arrow}・システム技${DETAIL[sz].chipH}・注記${DETAIL[sz].tagH}。詳細と同じ寸法`, async () => {
      same(await rowDims(page, '.cmd'), DETAIL[sz]);
    });
    await check(`${tag} 25e 編集（${sz}）: 入力欄16px・タグの pill 14px・パッド414px・挿入カーソル3×34は段階に依らない`, async () => {
      const r = await page.evaluate(() => {
        const f = (s) => getComputedStyle(document.querySelector(s)).fontSize;
        return { memo: f('#f-memo'), dmg: f('#f-dmg'), title: f('#f-title'), pill: f('.tag-list .pill'), pad: document.querySelector('.pad').offsetHeight, cursor: [document.querySelector('.cursor').offsetWidth, document.querySelector('.cursor').offsetHeight] };
      });
      assert.deepEqual([r.memo, r.dmg, r.title, r.pill, r.pad, r.cursor], ['16px', '16px', '16px', '14px', 414, [3, 34]]);
    });
    await check(`${tag} 25e 編集（${sz}）: 横スクロールなし`, async () => assert.ok(await noHScroll(page)));
    await shot(page, `25-edit-${sz}`, width);
    await page.context().close();
  }

  // 25f タップ領域: 編集の技チップ・タグ、詳細の技チップ・タグが44px以上（1行のとき）。透明の ::after が段階の寸法に追従する
  for (const sz of SIZES) {
    const page = await sized(sz);
    const hits = (sel, kind) => page.$eval(sel, (c, k) => {
      const b = c.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const hit = (x, y) => document.elementFromPoint(x, y)?.closest('button') === c;
      const v = (44 - b.height) / 2;
      const r = { h: b.height, up: hit(cx, b.top - v + 0.5), down: hit(cx, b.bottom + v - 1), outUp: !hit(cx, b.top - v - 1.5) || k === 'chip-nb' };
      if (k === 'tag') Object.assign(r, { wide: b.width + 11 >= 44, left: hit(b.left - 8, cy), right: hit(b.right + 1.5, cy) });
      else Object.assign(r, { left: hit(b.left - 4, cy), right: hit(b.right + 4, cy) });
      return r;
    }, kind);
    await gotoHash(page, '#/c/ryu/r/c3/edit');
    await check(`${tag} 25f 編集（${sz}）: 技チップ（見た目${DETAIL[sz].chipH}）の当たり領域は上下で44px以上`, async () => {
      const r = await hits('.cmd button.chip', 'chip');
      assert.equal(r.h, DETAIL[sz].chipH);
      assert.ok(r.up && r.down && r.left && r.right, JSON.stringify(r));
    });
    await check(`${tag} 25f 編集（${sz}）: CH・PCのタグ（見た目${DETAIL[sz].tagH}）の当たり領域は44×44以上で、隣の技の当たり領域（左5px）とは重ならない`, async () => {
      const r = await hits('.cmd button.tag', 'tag');
      assert.equal(r.h, DETAIL[sz].tagH);
      assert.ok(r.up && r.down && r.left && r.right && r.wide, JSON.stringify(r));
      const chipLeft = await page.$eval('.cmd button.tag', (t) => { const chip = t.parentElement.querySelector('button.chip'), cb = chip.getBoundingClientRect(); return document.elementFromPoint(cb.left - 4, cb.top + cb.height / 2)?.closest('button') === chip; });
      assert.ok(chipLeft);
    });
    await gotoHash(page, '#/c/ryu/r/c3');
    await check(`${tag} 25f 詳細（${sz}）: 必殺技チップ・タグの当たり領域も44px以上`, async () => {
      const c = await hits('.d-cmd button.chip', 'chip');
      const t = await hits('.d-cmd button.tag', 'tag');
      assert.ok(c.up && c.down && t.up && t.down && t.wide, JSON.stringify([c, t]));
      assert.equal(c.h, DETAIL[sz].dot[0]);
    });
    await page.context().close();

    // ::after 込みの当たり領域の高さ。技名表記のチップ（文字だけ）とシステム技・SA（枠つき）も44px以上で、同じ行の隣の当たり領域と重ならない
    for (const sn of ['name', 'cmd']) {
      const p2 = await sized(sz, { specialNotation: sn });
      for (const [screen, root] of [['#/c/ryu/r/c1/edit', '.cmd'], ['#/c/ryu/r/c1', '.d-cmd']]) {
        await gotoHash(p2, screen);
        await check(`${tag} 25f ${root === '.cmd' ? '編集' : '詳細'}（${sz}・${sn}表記）: 技チップ（技名・システム技・SA）の ::after 込みの高さが44以上、同じ行の当たり領域は重ならない`, async () => {
          const r = await p2.$$eval(`${root} button.chip, ${root} button.tag`, (els) => {
            const rects = els.map((e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e, '::after'); return { kind: e.classList.contains('tag') ? 'tag' : e.classList.contains('named') ? 'name' : e.classList.contains('sys') ? 'sys' : 'cmd', h: parseFloat(cs.height), x: b.left + parseFloat(cs.left), w: parseFloat(cs.width), y: b.top + parseFloat(cs.top), cy: b.top + b.height / 2, chipH: b.height }; });
            const ov = [];
            for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], c = rects[j]; if (Math.abs(a.cy - c.cy) < 5 && Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 0.5) ov.push([i, j]); }
            return { rects, ov };
          });
          assert.ok(r.rects.every((x) => x.h >= 44 - 0.01), JSON.stringify(r.rects.filter((x) => x.h < 44)));
          assert.deepEqual(r.ov, []);
          assert.ok(r.rects.some((x) => x.kind === 'sys'));
          if (sn === 'name') { const nm = r.rects.filter((x) => x.kind === 'name'); assert.ok(nm.length >= 2 && nm.every((x) => x.chipH === DETAIL[sz].chipH), JSON.stringify(nm)); }
          assert.ok(await noHScroll(p2));
        });
      }
      await p2.context().close();
    }
  }

  // 25g 据え置き: メモの内容以外は、段階に依らず寸法が同じ（l と比べる）
  {
    const snap = async (sz) => {
      const page = await sized(sz, { recentCharacters: ['ryu'] });
      const out = {};
      const m = (sel) => page.$$eval(sel, (es) => es.slice(0, 40).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
      const fs = (sel) => page.$eval(sel, (e) => getComputedStyle(e).fontSize);
      await gotoHash(page, '#/');
      out.home = { cell: await m('.cell'), en: await fs('.cell-en'), top: await m('.topbar'), act: await m('.top-action'), rc: await m('.rc') };
      await gotoHash(page, '#/c/ryu/r/c1/edit');
      await page.getByRole('button', { name: '波動 236', exact: true }).click(); // 方向の仮チップ（ペンディング）を出す
      out.pad = { pad: await m('.pad'), keys: await m('.pad .key'), dots: await m('.pad .dot'), recentRow: await m('.recent-keys .row'), recentDot: await m('.recent-keys .row .dot') };
      out.pending = { ghost: await m('.cmd .pending .ghost'), arrow: await page.$$eval('.cmd .pending .arrow', (es) => es.map((e) => parseFloat(getComputedStyle(e).width))), cursor: await m('.cmd .cursor'), grp: await page.$eval('.cmd .pending', (e) => getComputedStyle(e).gap) };
      out.fields = { title: await fs('#f-title'), memo: await fs('#f-memo'), label: await fs('.field-label'), seg: await m('.seg-item span'), sec: await m('.sec-head') };
      await page.getByRole('button', { name: '弱P', exact: true }).click();
      await page.locator('.cmd .chip').last().click(); // 編集のポップオーバー
      out.edPop = { pop: await m('.popover'), opt: await m('.popover .opt'), dot: await m('.popover .opt .dot') };
      await page.keyboard.press('Escape');
      await gotoHash(page, '#/c/ryu/r/c1');
      await page.locator('.d-cmd button.chip').first().click(); // 詳細のポップオーバー（モーションの対応表示）
      out.pop = { pop: await m('.popover'), arrow: await page.$$eval('.popover .arrow', (es) => es.map((e) => parseFloat(getComputedStyle(e).width))), note: await fs('.popover .pop-note') };
      await page.keyboard.press('Escape');
      out.detail = { title: await fs('.d-title'), h: await fs('.d-memo-h'), stat: await fs('.d-stat-l'), bar: await m('.bottombar .btn'), top: await m('.topbar') };
      await page.getByRole('button', { name: '複製', exact: true }).click();
      await page.waitForSelector('.toast');
      out.toast = { toast: await m('.toast'), fs: await fs('.toast') };
      await gotoHash(page, '#/c/ryu');
      out.list = { head: await m('.sec-head'), title: await fs('.item-title'), meta: await fs('.meta-t'), bar: await m('.bottombar .btn'), wm: await fs('.wm') };
      await gotoHash(page, '#/settings');
      out.settings = { samples: await page.evaluate(() => [...document.querySelectorAll('.fld')].filter((f) => f.querySelector('legend')?.textContent !== 'メモの文字サイズ').flatMap((f) => [...f.querySelectorAll('.set-sample .row')]).map((r) => [r.querySelector('.dot')?.offsetWidth ?? null, r.querySelector('.arrow, .num') ? parseFloat(getComputedStyle(r.querySelector('.arrow, .num')).width) : null])), seg: await m('.seg-item span'), head: await m('.set-head') };
      await page.getByRole('button', { name: '凡例を見る' }).click();
      await page.waitForSelector('.sheet.tall');
      out.legend = { dots: await m('.leg .row .dot'), chips: await m('.leg .row .sys'), arrows: await page.$$eval('.leg .row .arrow', (es) => es.slice(0, 12).map((e) => parseFloat(getComputedStyle(e).width))), tags: await m('.leg .row .tag') };
      await page.context().close();
      return out;
    };
    const base = await snap('l');
    await check(`${tag} 25g 据え置き（l）: キャラ選択のタイル54px・英字20px（360未満は16px）、パッド414px、仮チップ（丸34・矢印22）、ポップオーバー、トースト、設定の見本の丸34、凡例の丸24・システム技34`, async () => {
      assert.equal(base.home.en, width < 360 ? '16px' : '20px');
      assert.ok(base.home.cell.every(([, h]) => h === 54));
      assert.deepEqual(base.pad.pad, [[width, 414]]);
      assert.deepEqual(base.pad.recentDot.slice(0, 1), [[24, 24]]);
      assert.deepEqual(base.pending.ghost, [[34, 34]]);
      assert.ok(base.pending.arrow.length >= 3 && base.pending.arrow.every((w) => w === 22), JSON.stringify(base.pending.arrow));
      assert.deepEqual(base.pending.cursor, [[3, 34]]);
      assert.ok(base.pop.arrow.length >= 3 && base.pop.arrow.every((w) => w === 14), JSON.stringify(base.pop.arrow));
      assert.equal(base.toast.fs, '14px');
      assert.ok(base.settings.samples.length === 3 && base.settings.samples.every(([d]) => d === 34));
      assert.ok(base.legend.dots.every(([w]) => w === 24 || w === 34 || w === 22), JSON.stringify(base.legend.dots));
      assert.ok(base.legend.chips.every(([, h]) => h === 34 || h === 24), JSON.stringify(base.legend.chips));
    });
    for (const sz of ['m', 's']) {
      const got = await snap(sz);
      await check(`${tag} 25g 据え置き（${sz}）: キャラ選択・上部バー・パッドのキー・仮チップ・ポップオーバー・トースト・設定・凡例・タイトル・見出しの寸法が l と同じ`, async () => {
        for (const k of Object.keys(base)) assert.deepEqual(got[k], base[k], `${sz} ${k}`);
      });
    }
  }

  // 25g 補助文字オン: 編集パッドの強度キー（.row の外）の補助文字の板は丸の右下（-7px/-7px）、丸の右余白7px。段階に依らず導入前と同じ
  for (const sz of SIZES) {
    const page = await sized(sz, { strengthLabels: true });
    await gotoHash(page, '#/c/ryu/r/c1/edit');
    await check(`${tag} 25g 補助文字オン（${sz}）: パッドの強度キーの板は right -7px・bottom -7px、丸の margin-right 7px（板のない丸は0）`, async () => {
      const r = await page.$$eval('.pad .bkey .dot, .pad .okey .dot, .pad .nkey .dot', (dots) => dots.map((d) => { const bd = d.querySelector('.badge'), cs = bd && getComputedStyle(bd); return { badge: bd ? [cs.right, cs.bottom] : null, mr: getComputedStyle(d).marginRight, key: d.closest('.key').className }; }));
      assert.ok(r.filter((x) => x.badge).length >= 6, JSON.stringify(r));
      for (const x of r) assert.deepEqual([x.badge, x.mr], x.badge ? [['-7px', '-7px'], '7px'] : [null, '0px'], JSON.stringify(x));
      assert.ok(await noHScroll(page));
    });
    await page.context().close();
  }

  // 25h 本文の最小フォントは12px以上（メモの内容の文字。補助文字の小さな板 .badge は設定オンのときだけの補助で別）。全段階
  for (const sz of SIZES) {
    const page = await sized(sz, { notation: 'numpad', specialNotation: 'name' });
    const small = async (hash, sels) => { await gotoHash(page, hash); return page.evaluate((ss) => { const bad = []; for (const root of document.querySelectorAll(ss)) for (const e of [root, ...root.querySelectorAll('*')]) { if (e.closest('.badge') || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const f = parseFloat(getComputedStyle(e).fontSize); if (f < 12) bad.push(`${e.className || e.tagName} ${f}`); } return bad; }, sels); };
    await check(`${tag} 25h 最小フォント（${sz}）: 詳細・一覧・編集のメモの内容の文字はすべて12px以上（数字・技名表記も）`, async () => {
      assert.deepEqual(await small('#/c/ryu/r/c1', '.d-cmd, .d-memo, .d-meta, .d-stat'), [], 'detail');
      assert.deepEqual(await small('#/c/ryu', '.preview, .item-meta'), []);
      assert.deepEqual(await small('#/c/ryu/r/c1/edit', '.cmd'), []);
    });
    await page.context().close();
  }

  // 25i 幅: 全画面・全段階で横スクロールなし（数字・技名・補助文字オン、長い行も）
  for (const sz of SIZES) {
    const page = await sized(sz, { notation: 'numpad', strengthLabels: true, specialNotation: 'name' });
    await check(`${tag} 25i 横スクロールなし（${sz}、数字・補助文字・技名表記）: キャラ選択・一覧・詳細（全部入り・長いコンボ）・編集・新規・設定・凡例`, async () => {
      for (const h of ['#/', '#/c/ryu', '#/c/ryu/r/c1', '#/c/ryu/r/c2', '#/c/ryu/r/c1/edit', '#/c/ryu/r/c2/edit', '#/c/ryu/new?s=s1', '#/settings']) {
        await gotoHash(page, h);
        assert.ok(await noHScroll(page), h);
      }
      await gotoHash(page, '#/c/ryu/r/c2');
      await page.locator('button[aria-label="凡例を開く"]').click();
      await page.waitForSelector('.sheet.tall');
      assert.ok(await noHScroll(page), '凡例');
    });
    await check(`${tag} 25i ページエラーなし（${sz}）`, async () => assert.deepEqual(page.errors, []));
    await page.context().close();
  }

  // 25j グレースケールで形の区別: P と K の●（同じ強度色）を実際の画素（等倍）でグレースケールにし、中の文字（ink）の画素が足りて、PとKで形が違う。強度なしの●は弱の●と明るさが違う
  {
    const ink = async (page, sel) => {
      const png = await page.locator(sel).first().screenshot();
      return page.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data, y = [];
        for (let i = 0; i < d.length; i += 4) y.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        return { w: c.width, h: c.height, y };
      }, png.toString('base64'));
    };
    for (const [label, root, sz] of [...SIZES.map((s) => ['詳細', '.d-cmd', s]), ...SIZES.map((s) => ['一覧', '.preview', s])]) {
      const page = await sized(sz, {}, { sections: [sec('s1', 'ryu', '通常', 0)], combos: [combo('c1', 's1', 'PK', [NN('stand', 'L', 'P'), NN('stand', 'L', 'K'), NN('stand', 'N', 'P')])] });
      await gotoHash(page, label === '詳細' ? '#/c/ryu/r/c1' : '#/c/ryu');
      await page.addStyleTag({ content: 'html { filter: grayscale(1); }' }); // 画素を取る前にグレースケールにする（検証だけ。アプリには入れない）
      const wDot = await page.locator(`${root} .dot`).first().evaluate((e) => e.offsetWidth);
      await check(`${tag} 25j グレースケール（${label} ${sz}、丸${wDot}px）: PとKの●は中の文字の画素が足り、形が違う（等倍）`, async () => {
        const p = await ink(page, `${root} .dot >> nth=0`), k = await ink(page, `${root} .dot >> nth=1`);
        assert.equal(wDot, (label === '詳細' ? DETAIL : PREVIEW)[sz].dot[0]);
        const dark = (o) => o.y.filter((v) => v < 90).length;
        assert.ok(dark(p) >= wDot * 1.1 && dark(k) >= wDot * 1.1, `ink 画素 P=${dark(p)} K=${dark(k)}`);
        let diff = 0;
        p.y.forEach((v, i) => { if (Math.abs(v - k.y[i]) > 60) diff++; });
        assert.ok(diff >= wDot * 0.9, `PとKの違う画素 ${diff} (${wDot}px)`);
        // 文字の線の太さ: 36の座標で4 → 丸に対して 4/36。2px以上
        assert.ok(wDot * 4 / 36 >= 2, `線 ${wDot * 4 / 36}`);
      });
      await page.context().close();
    }
  }
}

// ===== SECTION: 26 連携・分岐（T-027。D-021・D-022、design-spec-v2.4 7章の基準1〜12） =====
// 360・390・430幅。木の表示・折りたたみ・追加編集・上限・削除と取り消し・複製と移動・件数・下書き・2タブと取り込み・グレースケール・色。
// 期待値は design-spec-v2.4 の表と文言を直接書く（app.js・styles.css から読まない）。
for (const width of process.env.ONLY_24 || process.env.ONLY_25 || process.env.ONLY_28 ? [] : [360, 390, 430].filter((w) => !process.env.WIDTH || Number(process.env.WIDTH) === w)) { // WIDTH=360 で1つの幅だけ
  const tag = `[${width}]`;
  let seq = 0;
  // createdAt は作った順（兄弟の順序の根拠）。T0 より前の固定値から1ずつ進める
  const mk = (id, sectionId, title, tokens, extra = {}) => ({
    id, characterId: 'ryu', controlType: 'classic', sectionId, title, position: 'any', tokens, memo: '', tags: [], favorite: false,
    createdAt: T0 - 5000 + seq++, updatedAt: T0, ...extra,
  });
  const kid = (id, parentId, title, tokens, extra = {}) => mk(id, 's1', title, tokens, { parentId, ...extra });
  const PK = [N('stand', 'L', 'P'), N('stand', 'L', 'K')];
  const seed26 = () => {
    seq = 0;
    return {
      sections: [sec('s1', 'ryu', '通常', 0), sec('s2', 'ryu', '画面端', 1)],
      combos: [
        mk('r0', 's1', '連携なし', [N('crouch', 'M', 'K'), SP('236', 'H', 'P')]),
        mk('r1', 's1', '起き攻めループ', [N('crouch', 'M', 'K'), SP('236', 'H', 'P'), { type: 'system', id: 'CDR' }], { damage: 3200, memo: '中足から始める。', tags: ['基本'] }),
        kid('la', 'r1', '投げ重ね', PK, { memo: '投げ抜けされたら下がる', damage: 1200, tags: ['投げ'] }),
        kid('la1', 'la', 'ガード時', [SP('236', 'M', 'P')]),
        kid('la2', 'la', '', [SP('623', 'OD', 'P')], { tags: ['画面端'] }),
        kid('la1x', 'la1', 'ヒット時', [N('crouch', 'L', 'P')], { memo: '3段目のメモ' }),
        kid('lb', 'r1', '', [{ type: 'note', id: 'CH' }, N('stand', 'H', 'P')]),
        kid('lc', 'r1', '打撃重ね', []),
        mk('r2', 's2', '別セクション', PK),
      ],
    };
  };
  const ids26 = (d) => d.combos.map((c) => c.id);
  const raw = (d) => JSON.parse(JSON.stringify(exportDoc(d)));
  // hash を変えた直後は、描き直し（hashchange は非同期）を2フレーム待ってから、出現アニメーションの終わりを待つ
  const settle = async (page) => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForFunction(() => { const s = document.querySelector('.screen'); return s && s.getAnimations().length === 0; });
  };
  const nodeBtn = (page, id) => page.locator(`[data-fk="node:${id}"]`);
  const nodeIds = (page) => page.$$eval('.t-node', (els) => els.map((e) => e.id.slice(2)));
  const toastText = (page) => page.locator('#toast .toast-msg').allInnerTexts();
  const fk = (page) => page.evaluate(() => document.activeElement?.dataset?.fk ?? document.activeElement?.tagName);
  const waitHash = (page, h) => page.waitForFunction((x) => location.hash === x, h);
  const rect = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; });
  const setSettings = async (page, obj) => { await page.evaluate((o) => localStorage.setItem('sf6memo.settings', JSON.stringify(o)), obj); await page.reload(); };
  const openMenu = async (page, id) => { await nodeBtn(page, id).click(); await page.waitForSelector('.sheet'); };
  const menuNames = (page) => page.$$eval('.sheet .menu-item', (els) => els.map((e) => ({ t: e.textContent, d: e.disabled })));
  const gone = (page) => page.waitForSelector('.sheet', { state: 'detached' });
  const TOKENS = ['中K', '波動 236', '強P'];
  const tapKeys = async (page, names = TOKENS) => { for (const n of names) await page.getByRole('button', { name: n, exact: true }).click(); };

  // 26a 一覧（基準1）: 根だけが行になり、連携は「連携 N」（直接の子だけ）。帯の件数は根の数
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 26a 一覧: 連携・分岐は .item に出ない。行は根だけ（r1・r0・r2）で、帯の件数は根の数`, async () => {
      assert.equal(await page.locator('.item').count(), 3);
      assert.deepEqual(await page.$$eval('.item-title', (e) => e.map((x) => x.textContent)), ['起き攻めループ', '連携なし', '別セクション']); // 新しい順（r1 が先）
      for (const t of ['投げ重ね', 'ガード時', 'ヒット時', '打撃重ね']) assert.equal(await page.locator('.item', { hasText: t }).count(), 0, t);
      assert.deepEqual(await page.$$eval('.sec-count', (e) => e.map((x) => x.textContent)), ['2件', '1件']);
      assert.ok(await noHScroll(page));
    });
    await check(`${tag} 26a 一覧: 連携のある行に「連携 3」（直接の子だけ。孫は数えない）。ない行には出ない。ダメージの左に並ぶ`, async () => {
      const row1 = page.locator('.item', { hasText: '起き攻めループ' });
      assert.equal((await row1.locator('.lnk').innerText()).replace(/\s+/g, ' '), '連携 3');
      assert.equal(await row1.locator('.lnk b').innerText(), '3');
      assert.equal(await page.locator('.item', { hasText: '連携なし' }).locator('.lnk').count(), 0);
      const [l, d] = await row1.evaluate((r) => [r.querySelector('.lnk').getBoundingClientRect().right, r.querySelector('.dmg').getBoundingClientRect().left]);
      assert.ok(l <= d, `${l} ${d}`);
      assert.equal(await row1.locator('.item-meta').evaluate((e) => e.scrollWidth <= e.clientWidth), true);
    });
    await shot(page, '26a-list', width);
    await page.context().close();
  }

  // 26b 木の構造と折りたたみ（基準2）。0件、記号、見出しの階層、状態の保持、読み上げ名
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu/r/r1');
    await check(`${tag} 26b 木: section.t-sec > ul.t-list.d1 > li が3つ。見出しは h3（1段目）・h4（2段目）。[role=tree] なし。3段目は描かれない`, async () => {
      assert.equal(await page.locator('section.t-sec > ul.t-list.d1 > li').count(), 3);
      assert.deepEqual(await page.$$eval('.t-sec h3', (e) => e.map((x) => x.textContent)), ['連携A 投げ重ね', '連携B 見出しなし', '連携C 打撃重ね']);
      assert.deepEqual(await page.$$eval('.t-sec h4', (e) => e.map((x) => x.textContent)), ['分岐 ガード時', '分岐2']); // 2段目の空の見出しは「分岐<順番>」
      assert.equal(await page.locator('.t-sec h5').count(), 0);
      assert.equal(await page.locator('[role=tree], [role=treeitem]').count(), 0);
      assert.equal(await page.locator('li.t-node > ul.t-list > li.t-node').count(), 2); // 入れ子の ul
      assert.deepEqual(await nodeIds(page), ['la', 'la1', 'la2', 'lb', 'lc']);
      assert.deepEqual(await page.$$eval('.t-no', (e) => e.map((x) => x.textContent)), ['A', 'B', 'C']); // 記号は1段目だけ
      assert.equal(await page.locator('.t-sec h2').innerText(), '連携');
      assert.equal(await page.locator('.t-sec-n').innerText(), '3件');
    });
    await check(`${tag} 26b 折りたたみ: 初期は2段目の la1 だけ閉じていて（3段目なし）、押すと aria-expanded が反転して3段目が出る。フォーカスはそのボタンに残る。閉じている間の aria-controls は付けない`, async () => {
      assert.deepEqual(await page.$$eval('.t-fold', (e) => e.map((x) => [x.dataset.fk, x.getAttribute('aria-expanded'), x.getAttribute('aria-controls')])), [['fold:la', 'true', 't-list-la'], ['fold:la1', 'false', null]]);
      await page.evaluate(() => { window.__keep = [document.querySelector('.screen'), document.querySelector('#t-lb'), document.querySelector('#t-list-la')]; });
      await page.locator('[data-fk="fold:la1"]').click();
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-controls'), 't-list-la1');
      assert.equal(await page.locator('#t-list-la1').count(), 1); // aria-controls が指す ul がある
      assert.equal(await page.evaluate(() => document.querySelector('.screen') === window.__keep[0] && document.querySelector('#t-lb') === window.__keep[1] && document.querySelector('#t-list-la') === window.__keep[2]), true); // 描き直さず、押した枝の ul だけを挿入する
      assert.equal(await page.$eval('[data-fk="fold:la1"] .ic', (e) => e.style.transform), 'rotate(90deg)');
      assert.equal(await fk(page), 'fold:la1');
      assert.deepEqual(await page.$$eval('.t-sec h5', (e) => e.map((x) => x.textContent)), ['分岐 ヒット時']);
      assert.equal(await page.locator('.t-memo', { hasText: '3段目のメモ' }).count(), 1);
      await page.locator('[data-fk="fold:la1"]').click();
      assert.equal(await page.locator('.t-sec h5').count(), 0);
      assert.equal(await fk(page), 'fold:la1');
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-controls'), null);
      assert.equal(await page.locator('#t-list-la1').count(), 0);
      await page.locator('[data-fk="fold:la"]').click(); // 1段目を閉じると2段目の ul は描かれない
      assert.deepEqual(await nodeIds(page), ['la', 'lb', 'lc']);
      assert.equal(await page.locator('#t-list-la').count(), 0);
      assert.equal(await page.locator('[data-fk="fold:la"]').getAttribute('aria-controls'), null);
      assert.equal(await fk(page), 'fold:la');
      await page.locator('[data-fk="fold:la"]').click();
      assert.equal(await page.locator('[data-fk="fold:la"]').getAttribute('aria-controls'), 't-list-la');
      assert.equal(await fk(page), 'fold:la');
    });
    await check(`${tag} 26b 読み上げ名: リスト・［…］・折りたたみ・［＋ 追加］、見出しの階層（h2 の下に h3）`, async () => {
      assert.equal(await page.locator('ul.t-list.d1').getAttribute('aria-label'), `${'リュウ'}のコンボ『起き攻めループ』の連携 3件`);
      assert.equal(await page.locator('#t-list-la').getAttribute('aria-label'), '連携A『投げ重ね』の分岐 2件');
      assert.equal(await nodeBtn(page, 'la').getAttribute('aria-label'), '連携A『投げ重ね』の操作');
      assert.equal(await nodeBtn(page, 'lb').getAttribute('aria-label'), '連携Bの操作');
      assert.equal(await nodeBtn(page, 'la1').getAttribute('aria-label'), '分岐『ガード時』の操作');
      assert.equal(await nodeBtn(page, 'la2').getAttribute('aria-label'), '分岐2の操作');
      assert.equal(await page.locator('[data-fk="fold:la"]').getAttribute('aria-label'), '連携A『投げ重ね』の分岐 2件');
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-label'), '分岐『ガード時』の分岐 1件');
      assert.equal(await page.locator('[data-fk="add-link"]').getAttribute('aria-label'), 'このコンボに連携を追加');
      assert.equal(await page.locator('[data-fk="add-link"]').getAttribute('aria-disabled'), null);
    });
    await check(`${tag} 26b ノードの中身: コマンド列・タグ・ダメージ・メモ。0手は「コマンドなし」。お気に入り・位置は出さない`, async () => {
      const la = page.locator('#t-la');
      assert.equal(await la.locator('> .t-cmd .row').count(), 1);
      assert.equal((await la.locator('> .t-meta').innerText()).replace(/\s+/g, ' '), '投げ ダメージ 1,200');
      assert.equal(await la.locator('> .t-memo').innerText(), '投げ抜けされたら下がる');
      assert.equal(await page.locator('#t-lc .t-cmd-none').innerText(), 'コマンドなし');
      assert.equal(await page.locator('#t-lc > .t-meta, #t-lc > .t-memo').count(), 0); // タグ・ダメージ・メモがなければ出さない
      assert.equal(await page.locator('.t-node .fav, .t-node [aria-label*="お気に入り"]').count(), 0);
    });
    await check(`${tag} 26b 記号 A〜H は見出しの1行目と同じ行の高さ（上端と高さがそろい、3px上にずれない）`, async () => {
      const m = await page.$$eval('.t-no', (els) => els.map((no) => {
        const t = no.nextElementSibling;
        const a = no.getBoundingClientRect(); const b = t.getBoundingClientRect();
        return [getComputedStyle(no).lineHeight, getComputedStyle(t).lineHeight, a.top === b.top, Math.round(a.height)];
      }));
      assert.equal(m.length, 3);
      for (const [no, title, sameTop, height] of m) { assert.equal(no, title); assert.equal(sameTop, true); assert.equal(height, 43); } // 11 + 21 + 11
    });
    await check(`${tag} 26b 木の開閉はアプリを開いている間だけ保持される（一覧へ行って戻っても、再読み込みで戻る）`, async () => {
      await page.locator('[data-fk="fold:la1"]').click();
      await gotoHash(page, '#/c/ryu');
      await gotoHash(page, '#/c/ryu/r/r1');
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-expanded'), 'true');
      assert.ok(!(await storedRaw(page)).includes('treeOpen'));
      await page.reload();
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-expanded'), 'false');
    });
    await check(`${tag} 26b 連携0件の根: 見出しの行だけ（「連携」「なし」［＋ 追加］）。高さ44以上`, async () => {
      await gotoHash(page, '#/c/ryu/r/r0');
      assert.equal(await page.locator('.t-sec-n').innerText(), 'なし');
      assert.equal(await page.locator('.t-sec ul, .t-sec .t-node').count(), 0);
      assert.ok((await rect(page, '.t-sec-head')).h >= 44);
      assert.equal(await page.locator('[data-fk="add-link"]').isVisible(), true);
      assert.ok(await noHScroll(page));
    });
    await shot(page, '26b-detail-0', width);
    await gotoHash(page, '#/c/ryu/r/r1');
    await shot(page, '26b-detail', width);
    await page.locator('[data-fk="fold:la1"]').click();
    await shot(page, '26b-detail-open', width);
    await page.context().close();
  }

  // 26c メモの文字サイズ（基準3）。.t-cmd の行だけが縮み、見出し・記号・［…］・折りたたみは固定
  {
    const DOT = { l: '34px', m: '29px', s: '24px' };
    const MEMO = { l: '15px', m: '14px', s: '13px' };
    const META = { l: '13px', m: '12px', s: '12px' };
    for (const sz of ['l', 'm', 's']) {
      const page = await newPage(width, seed26());
      await setSettings(page, { memoSize: sz });
      await gotoHash(page, '#/c/ryu/r/r1');
      await page.locator('[data-fk="fold:la1"]').click();
      await check(`${tag} 26c メモの文字サイズ ${sz}: .t-cmd の丸 ${DOT[sz]}、メモ ${MEMO[sz]}、メタ ${META[sz]}。見出し15px（太さ700・行の高さ21px）・［…］44・折りたたみ13px は固定`, async () => {
        const cmd = await page.$$eval('.t-cmd > .row', (rows) => rows.map((r) => getComputedStyle(r).getPropertyValue('--dot').trim()));
        assert.ok(cmd.length >= 5 && cmd.every((v) => v === DOT[sz]), JSON.stringify(cmd));
        assert.equal(await page.$eval('#t-la > .t-cmd .dot', (e) => e.offsetWidth), parseInt(DOT[sz]));
        assert.equal(await page.$eval('.t-memo', (e) => getComputedStyle(e).fontSize), MEMO[sz]);
        assert.equal(await page.$eval('.t-meta', (e) => getComputedStyle(e).fontSize), META[sz]);
        assert.deepEqual(await page.$$eval('.t-title', (e) => [...new Set(e.map((x) => { const c = getComputedStyle(x); return `${c.fontSize}/${c.fontWeight}/${c.lineHeight}`; }))]), ['15px/700/21px']);
        assert.deepEqual(await page.$$eval('.t-fold', (e) => [...new Set(e.map((x) => getComputedStyle(x).fontSize))]), ['13px']);
        assert.deepEqual(await page.$$eval('.t-row .icon-btn', (e) => [...new Set(e.map((x) => `${x.offsetWidth}x${x.offsetHeight}`))]), ['44x44']);
        assert.equal(await page.$eval('.d-cmd > .row', (r) => getComputedStyle(r).getPropertyValue('--dot').trim()), DOT[sz]); // 根の行も同じ段階（従来どおり）
        assert.ok(await noHScroll(page));
      });
      if (sz !== 'l') await shot(page, `26c-detail-${sz}`, width);
      await page.context().close();
    }
  }

  // 26d 幅（基準4）: 最大のデータ（連携8×分岐8×3段目8、100字の見出し、3段目にCH＋ODフーリガンコンビネーション）
  {
    seq = 0;
    const long100 = 'あ'.repeat(100);
    const HOOL = [{ type: 'note', id: 'CH' }, SP('236', 'OD', 'P'), SP('236', 'H', 'P')];
    const MID = [N('crouch', 'M', 'K'), SP('236', 'H', 'P'), { type: 'system', id: 'CDR' }, N('stand', 'H', 'P'), SP('623', 'OD', 'P'), N('crouch', 'L', 'P'), SP('214', 'M', 'K'), N('stand', 'M', 'K'), SP('236', 'L', 'P'), { type: 'sa', level: 1 }]; // 各10手
    const cm = (id, parentId, title, tokens, extra = {}) => mk(id, 'sm', title, tokens, { characterId: 'cammy', parentId, ...extra });
    const maxDoc = { sections: [sec('sm', 'cammy', '通常', 0)], combos: [mk('mr', 'sm', long100, MID, { characterId: 'cammy', tags: ['基本', '画面端', 'あ'.repeat(30)], damage: 99999, memo: 'メモ'.repeat(40) })] };
    for (let i = 0; i < 8; i++) {
      maxDoc.combos.push(cm(`m${i}`, 'mr', i === 0 ? long100 : `連携${i}`, MID, { tags: ['長いタグ'.repeat(5)], damage: 12345 }));
      for (let j = 0; j < 8; j++) {
        maxDoc.combos.push(cm(`m${i}b${j}`, `m${i}`, i === 0 && j === 0 ? long100 : `分岐${j}`, MID));
        for (let k = 0; k < 8; k++) maxDoc.combos.push(cm(`m${i}b${j}t${k}`, `m${i}b${j}`, `3段目${k}`, i === 0 && j === 0 && k === 0 ? HOOL : MID, { memo: '3段目のメモ' }));
      }
    }
    for (const sz of ['l', 's']) {
      const page = await newPage(width, maxDoc);
      await setSettings(page, { specialNotation: 'name', memoSize: sz });
      await gotoHash(page, '#/c/cammy/r/mr');
      await check(`${tag} 26d 最大データ（${maxDoc.combos.length}件、${sz}）の初期表示: 描くのは1段目8＋2段目64。3段目は描かない。横スクロールなし`, async () => {
        assert.equal(await page.locator('.t-node').count(), 72);
        assert.equal(await page.locator('.t-sec h5').count(), 0);
        assert.ok(await noHScroll(page));
      });
      await shot(page, `26d-max-${sz}`, width);
      if (sz === 's') { await page.context().close(); continue; } // 全部開くのは l だけ（584ノードの描き直しを64回繰り返すので時間がかかる）
      const first = await page.evaluate(() => { // 初期表示から2段目の枝を1つ開く（ふつうの開閉。8ノードが増える）
        const b = document.querySelector('[data-fk="fold:m3b2"]');
        const t = performance.now();
        b.click();
        void document.body.offsetHeight;
        return { ms: performance.now() - t, nodes: document.querySelectorAll('.t-node').length };
      });
      await check(`${tag} 26d 最大データ（各10手）の初期表示から2段目の枝を開く: 8ノードが増えるだけ（72→80）で、300ms以下`, async () => {
        console.log(`e2e: 26d ${tag} 初期表示から2段目の枝を開く（8ノード）: ${first.ms.toFixed(1)}ms`);
        assert.equal(first.nodes, 80);
        assert.ok(first.ms < 300, `${first.ms}`);
      });
      const t0 = Date.now();
      await page.evaluate(() => { let b; while ((b = document.querySelector('.t-fold[aria-expanded="false"]'))) b.click(); });
      await check(`${tag} 26d 最大データ（${sz}）を3段目まで全部開く: 584ノード。横スクロールなし。すべての .t-cmd .row で scrollWidth ≤ clientWidth、ノードの右端は画面内`, async () => {
        assert.equal(await page.locator('.t-node').count(), 584);
        assert.ok(await noHScroll(page));
        const bad = await page.evaluate(() => [...document.querySelectorAll('.t-cmd .row')].filter((r) => r.scrollWidth > r.clientWidth).length);
        assert.equal(bad, 0);
        const over = await page.evaluate(() => [...document.querySelectorAll('.t-node, .t-title, .t-meta, .t-memo, .t-row')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length);
        assert.equal(over, 0);
      });
      if (sz === 'l') {
        await check(`${tag} 26d 実測: 3段目の内容幅（設計書の手計算 360:292 / 390:322 / 430:362）と、最長のチップ（CH＋ODフーリガンコンビネーション＋▶、約283px）`, async () => {
          const m = await page.evaluate(() => {
            const t3 = document.querySelector('#t-m0b0t0 > .t-cmd');
            const grp = t3.querySelector('.grp');
            return { content: t3.clientWidth, grp: Math.ceil(grp.getBoundingClientRect().width), row: t3.querySelector('.row').scrollWidth, name: grp.textContent };
          });
          console.log(`e2e: 26d ${tag} 3段目の内容幅 ${m.content}px、最長の技のグループ ${m.grp}px（${m.name}）、行の scrollWidth ${m.row}px（表示時間 ${Date.now() - t0}ms）`);
          assert.equal(m.content, { 360: 292, 390: 322, 430: 362 }[width]);
          assert.ok(m.grp <= m.content && m.grp >= 270 && m.grp <= 300, `${m.grp}`);
          assert.match(m.name, /ODフーリガンコンビネーション/);
        });
        await shot(page, '26d-max-open', width);
        await check(`${tag} 26d 最大データ（584ノード・各10手）をすべて開いた状態の折りたたみ1回: 閉じる・開くが300ms以下。描き直さず、フォーカスはボタンに残る`, async () => {
          const r = await page.evaluate(() => {
            const b = document.querySelector('[data-fk="fold:m3"]');
            b.focus();
            const keep = document.querySelector('.screen');
            const run = () => { const t = performance.now(); b.click(); void document.body.offsetHeight; return performance.now() - t; }; // click の同期処理 + スタイル・レイアウト
            const closeMs = run();
            const closed = document.querySelectorAll('.t-node').length;
            const openMs = run();
            return { closeMs, openMs, closed, opened: document.querySelectorAll('.t-node').length, same: document.querySelector('.screen') === keep, focus: document.activeElement === b };
          });
          console.log(`e2e: 26d ${tag} 折りたたみ1回（584ノード・各10手）: 閉じる ${r.closeMs.toFixed(1)}ms、開く ${r.openMs.toFixed(1)}ms`);
          assert.deepEqual([r.closed, r.opened, r.same, r.focus], [584 - 72, 584, true, true]);
          assert.ok(r.closeMs < 300 && r.openMs < 300, `${r.closeMs} / ${r.openMs}`);
        });
      }
      await check(`${tag} 26d 100字の見出しは折り返して省略しない（1段目・2段目）`, async () => {
        const t = await page.$$eval('.t-title', (e) => e.map((x) => x.textContent).filter((x) => x.includes('あああ')));
        assert.ok(t.length >= 2 && t.every((x) => x.endsWith('あ'.repeat(100))), JSON.stringify(t.map((x) => x.length)));
        assert.equal(await page.$eval('#t-m0 .t-title', (e) => e.scrollHeight <= e.clientHeight + 1), true);
      });
      await page.context().close();
    }
  }

  // 26e タップ領域（基準5）と、当たり領域の重なり
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu/r/r1');
    await page.locator('[data-fk="fold:la1"]').click();
    await check(`${tag} 26e タップ領域: ［…］・折りたたみ・［＋ 追加］がすべて44×44以上`, async () => {
      const dims = await page.$$eval('.t-row .icon-btn, .t-fold, [data-fk="add-link"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.fk, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
      assert.ok(dims.length >= 9, JSON.stringify(dims));
      for (const [k, w, h] of dims) assert.ok(w >= 44 && h >= 44, `${k} ${w}x${h}`);
    });
    await check(`${tag} 26e ［…］の中心と四隅（角丸の内側、6px内側）は、重なるチップの当たり領域ではなく［…］自身が受ける（.t-row の z-index）`, async () => {
      const bad = await page.$$eval('.t-row .icon-btn', (els) => els.flatMap((b) => {
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return [[.5, .5], [0, 0], [1, 0], [0, 1], [1, 1]].map(([fx, fy]) => [r.left + 6 + fx * (r.width - 12), r.top + 6 + fy * (r.height - 12)])
          .filter(([x, y]) => !b.contains(document.elementFromPoint(x, y))).map(() => b.dataset.fk);
      }));
      assert.deepEqual(bad, []);
    });
    await check(`${tag} 26e 折りたたみの上端は、直上のチップの当たり領域に覆われない（上端2pxも折りたたみ自身が受ける。タグ・ダメージ・メモのない子ノード la1 の直下を含む）`, async () => {
      const bad = await page.$$eval('.t-fold', (els) => els.flatMap((f) => {
        f.scrollIntoView({ block: 'center' });
        const r = f.getBoundingClientRect();
        return [r.left + 4, r.left + r.width / 2, r.right - 4].flatMap((x) => [0.5, 1, 2].map((dy) => [x, r.top + dy]))
          .filter(([x, y]) => document.elementFromPoint(x, y)?.closest('.t-fold') !== f).map(() => f.dataset.fk);
      }));
      assert.deepEqual(bad, []);
      assert.equal(await page.$eval('#t-la1', (e) => e.querySelector(':scope > .t-meta, :scope > .t-memo')), null); // la1 はタグ・ダメージ・メモがなく、コマンド列の直下に折りたたみがある
    });
    await check(`${tag} 26e 最後のノードの縦線は止まる（線の高さは --gap + 22px で、最後のノードの下へ突き出さない）`, async () => {
      const m = await page.$$eval('.t-list', (uls) => uls.map((ul) => {
        const li = ul.lastElementChild;
        const gap = parseFloat(getComputedStyle(li).paddingTop);
        return [parseFloat(getComputedStyle(li, '::before').height), gap + 22, li.getBoundingClientRect().height];
      }));
      assert.ok(m.length >= 3, JSON.stringify(m));
      for (const [line, want, liH] of m) { assert.equal(line, want); assert.ok(liH > want, `${liH}`); }
    });
    await page.context().close();

    // チップが［…］の真下にある行。チップの並びは幅で変わるので、幅ごとに［…］の中ほどへ重なる並びを3つ置く（H=CH S=波動 C=CDR A=SA1 D=DI F=前ステップ M=屈中K。幅360・390・430で、どれかが重なる）
    const U = { H: { type: 'note', id: 'CH' }, S: SP('236', 'H', 'P'), C: { type: 'system', id: 'CDR' }, A: { type: 'sa', level: 1 }, D: { type: 'system', id: 'DI' }, F: { type: 'move', id: 'FWD_STEP' }, M: N('crouch', 'M', 'K') };
    const under = { sections: [sec('s1', 'ryu', '通常', 0)], combos: [mk('u0', 's1', '根', PK), ...['HMCFM', 'ASFD', 'ASCA'].map((q, i) => kid(`u${i + 1}`, 'u0', q, [...q].map((c) => U[c])))] };
    const pageU = await newPage(width, under);
    await gotoHash(pageU, '#/c/ryu/r/u0');
    await check(`${tag} 26e チップが［…］の真下に来る行でも、［…］の下端（中ほど10〜34px。縁は角丸の外）は［…］自身が受ける（.t-row の z-index）`, async () => {
      const m = await pageU.$$eval('.t-node', (nodes) => nodes.map((n) => {
        const b = n.querySelector('.t-row .icon-btn');
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        const chips = [...n.querySelectorAll(':scope > .t-cmd button')];
        const overlap = chips.filter((c) => { const q = c.getBoundingClientRect(); return q.top - 5 < r.bottom && q.right > r.left + 10 && q.left < r.left + 34; }).length;
        let bad = 0;
        for (let dx = 10; dx <= 34; dx += 4) for (const dy of [1, 3]) if (!b.contains(document.elementFromPoint(r.left + dx, r.bottom - dy))) bad++;
        return { overlap, bad };
      }));
      assert.ok(m.some((x) => x.overlap >= 1), JSON.stringify(m)); // 重ならない行だけでは、z-index を外しても気づけない
      assert.deepEqual(m.map((x) => x.bad), [0, 0, 0]);
    });
    await pageU.context().close();
  }

  // 26f 追加の流れ（基準6）: ［＋ 追加］→ 編集画面（つなぐ元）→ 保存 → 根の詳細・そのノードの［…］にフォーカス。履歴が2重にならない
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu');
    await page.locator('.item', { hasText: '起き攻めループ' }).click();
    await page.waitForSelector('.t-sec');
    await settle(page);
    await page.locator('[data-fk="add-link"]').click();
    await waitHash(page, '#/c/ryu/new?p=r1');
    await settle(page);
    await check(`${tag} 26f 連携の追加: h1「連携を追加」。セクションと位置の欄がなく、つなぐ元（タイトル・コマンド列）がある。入力欄は 見出し → ダメージ → タグ → メモ`, async () => {
      assert.equal(await page.locator('.topbar h1').innerText(), '連携を追加');
      assert.equal(await page.locator('#f-sec, fieldset.seg').count(), 0);
      assert.equal(await page.locator('.parent-ctx').count(), 1);
      assert.equal((await page.locator('.parent-ctx .pc-name').innerText()).replace(/\s+/g, ' '), 'つなぐ元 起き攻めループ');
      assert.equal(await page.locator('.parent-ctx .preview .row').count(), 1);
      assert.equal(await page.locator('.parent-ctx').getAttribute('tabindex'), '-1');
      assert.equal(await page.locator('main > :first-child').evaluate((e) => e.classList.contains('parent-ctx')), true); // main の先頭（下書きの時刻より上）
      assert.deepEqual(await page.$$eval('.fields .field-label', (e) => e.map((x) => x.textContent)), ['見出し（任意）', 'ダメージ（任意）', 'タグ', 'メモ']);
      assert.equal(await page.locator('#f-title').getAttribute('placeholder'), '例: 打撃重ね／投げ重ね');
      assert.equal(await page.getByRole('button', { name: 'コンボの詳細に戻る' }).count(), 1);
    });
    await check(`${tag} 26f つなぐ元の欄の実測（設計書の手計算: 高さ約63px。パッドの上端 y=326 より上）`, async () => {
      const c = await rect(page, '.parent-ctx');
      const pad = await rect(page, '#pad');
      console.log(`e2e: 26f ${tag} つなぐ元の欄 y=${c.y.toFixed(1)} 高さ ${c.h.toFixed(1)}px 下端 ${c.b.toFixed(1)}、パッドの上端 y=${pad.y}`);
      assert.ok(c.h >= 55 && c.h <= 70, `${c.h}`);
      assert.ok(pad.y >= 326 && c.b <= pad.y, `${pad.y} ${c.b}`);
      assert.ok(await noHScroll(page));
    });
    await shot(page, '26f-new-link', width);
    const histBefore = await page.evaluate(() => history.length);
    await tapKeys(page);
    await page.locator('#f-title').fill('ガード後の投げ');
    await page.locator('#f-dmg').fill('800');
    const maxSibling = Math.max(...seed26().combos.filter((c) => c.parentId === 'r1').map((c) => c.createdAt));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await waitHash(page, '#/c/ryu/r/r1');
    await page.waitForSelector('.t-sec');
    const after = await stored(page);
    const made = after.combos.find((c) => c.title === 'ガード後の投げ');
    await check(`${tag} 26f 保存: 新しい記録の parentId・sectionId が親と同じ。position は any、favorite は false、createdAt は兄弟の最後`, async () => {
      assert.ok(made);
      assert.equal(made.parentId, 'r1');
      assert.equal(made.sectionId, 's1');
      assert.equal(made.characterId, 'ryu');
      assert.equal(made.position, 'any');
      assert.equal(made.favorite, false);
      assert.equal(made.damage, 800);
      assert.equal(made.tokens.length, 2);
      assert.ok(made.createdAt > maxSibling, `${made.createdAt} ${maxSibling}`);
      assert.equal(made.updatedAt, made.createdAt);
      assert.equal(after.combos.length, 10);
      assert.equal(after.schemaVersion, 3);
    });
    await check(`${tag} 26f 保存後: 根の詳細に戻り、そのノードの［…］にフォーカス。末尾（連携D）に並び、画面内にある。トースト「保存しました」`, async () => {
      assert.equal(await fk(page), `node:${made.id}`);
      assert.deepEqual((await nodeIds(page)).filter((i) => ['la', 'lb', 'lc', made.id].includes(i)), ['la', 'lb', 'lc', made.id]);
      assert.equal(await page.locator('.t-sec h3').last().textContent(), '連携D ガード後の投げ');
      const r = await rect(page, `[data-fk="node:${made.id}"]`);
      assert.ok(r.y >= 48 && r.b <= 740 - 56, `${r.y} ${r.b}`);
      assert.deepEqual(await toastText(page), ['保存しました']);
      assert.equal(await page.locator('.t-sec-n').innerText(), '4件');
    });
    await check(`${tag} 26f 履歴: 保存のあと戻ると一覧に着く（詳細が2重に積まれていない）。履歴の長さは変わらない`, async () => {
      assert.equal(await page.evaluate(() => history.length), histBefore);
      await page.goBack();
      await waitHash(page, '#/c/ryu');
    });
    await page.context().close();

    // URLを直接開いた場合（戻る先がない）は、詳細の履歴へ置き換える
    const direct = await newPage(width, seed26());
    await gotoHash(direct, '#/c/ryu/new?p=r1');
    await direct.reload(); // 再読み込み（履歴の深さは残るが、直前の画面の記憶は消える）
    await settle(direct);
    const hl = await direct.evaluate(() => history.length);
    await tapKeys(direct, ['弱P']);
    await direct.getByRole('button', { name: '保存', exact: true }).click();
    await waitHash(direct, '#/c/ryu/r/r1');
    await check(`${tag} 26f 直接開いた追加の保存: 詳細へ置き換え（履歴が増えない）。フォーカスは新しいノードの［…］`, async () => {
      assert.equal(await direct.evaluate(() => history.length), hl);
      const made2 = (await stored(direct)).combos.find((c) => c.parentId === 'r1' && !seed26().combos.some((x) => x.id === c.id));
      assert.equal(await fk(direct), `node:${made2.id}`);
      assert.equal(made2.title, '');
    });
    await direct.context().close();
  }

  // 26f2 分岐（2段目・3段目）の追加と編集、編集画面の出し分け
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu/r/r1');
    await check(`${tag} 26f2 ［…］のシート: 見出し「連携A 投げ重ね」。項目は 編集・分岐を追加・削除。2段目は「分岐 ガード時」`, async () => {
      await openMenu(page, 'la');
      assert.equal(await page.locator('.sheet h2').innerText(), '連携A 投げ重ね');
      assert.deepEqual(await menuNames(page), [{ t: '編集', d: false }, { t: '分岐を追加', d: false }, { t: '削除', d: false }]);
      await page.keyboard.press('Escape');
      await gone(page);
      assert.equal(await fk(page), 'node:la'); // シートを閉じたら［…］
      await openMenu(page, 'la1');
      assert.equal(await page.locator('.sheet h2').innerText(), '分岐 ガード時');
      await page.keyboard.press('Escape');
      await gone(page);
    });
    await openMenu(page, 'la1');
    await page.getByRole('button', { name: '分岐を追加', exact: true }).click();
    await waitHash(page, '#/c/ryu/new?p=la1');
    await settle(page);
    await check(`${tag} 26f2 分岐の追加（3段目）: h1「分岐を追加」、つなぐ元「分岐 ガード時」とそのコマンド列、placeholder が分岐用`, async () => {
      assert.equal(await page.locator('.topbar h1').innerText(), '分岐を追加');
      assert.equal((await page.locator('.parent-ctx .pc-name').innerText()).replace(/\s+/g, ' '), 'つなぐ元 分岐 ガード時');
      assert.equal(await page.locator('#f-title').getAttribute('placeholder'), '例: ガード時／ヒット時');
      assert.equal(await page.locator('.parent-ctx .preview .chip, .parent-ctx .preview .sname').count() > 0, true);
    });
    await check(`${tag} 26f2 ［完了］のフォーカス先: 連携・分岐は .parent-ctx（根は #f-sec）`, async () => {
      await page.getByRole('button', { name: 'パッドを閉じて項目の入力へ' }).click();
      assert.equal(await page.evaluate(() => document.activeElement.className), 'parent-ctx');
      // フォーカスの表示: ほかのフォーカスリングと同じ（2px の実線、fg、オフセット2px）。tabindex=-1 の outline:none で消えない
      assert.deepEqual(await page.$eval('.parent-ctx', (e) => { const c = getComputedStyle(e); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.outlineOffset]; }), ['solid', '2px', 'rgb(242, 238, 230)', '2px']);
    });
    await page.locator('#f-title').fill('反撃');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await waitHash(page, '#/c/ryu/r/r1');
    await check(`${tag} 26f2 3段目の保存: 祖先（分岐 ガード時）が開き、新しいノードの［…］にフォーカス。親の子は2つで末尾`, async () => {
      const made = (await stored(page)).combos.find((c) => c.title === '反撃');
      assert.equal(made.parentId, 'la1');
      assert.equal(await fk(page), `node:${made.id}`);
      assert.equal(await page.locator('[data-fk="fold:la1"]').getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await page.$$eval('#t-list-la1 h5', (e) => e.map((x) => x.textContent)), ['分岐 ヒット時', '分岐 反撃']);
    });
    await check(`${tag} 26f2 編集（1段目）: h1「連携の編集」。つなぐ元は根のタイトル。保存で sectionId・parentId・createdAt・position は変わらず、根の詳細へ戻って［…］にフォーカス`, async () => {
      await openMenu(page, 'la');
      await page.getByRole('button', { name: '編集', exact: true }).click();
      await waitHash(page, '#/c/ryu/r/la/edit');
      await settle(page);
      assert.equal(await page.locator('.topbar h1').innerText(), '連携の編集');
      assert.equal(await page.locator('#f-sec, fieldset.seg').count(), 0);
      assert.equal(await page.locator('#f-title').inputValue(), '投げ重ね');
      assert.equal(await page.locator('#f-dmg').inputValue(), '1200');
      assert.equal((await page.locator('.parent-ctx .pc-name').innerText()).replace(/\s+/g, ' '), 'つなぐ元 起き攻めループ');
      await page.locator('#f-title').fill('投げ重ね（改）');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await waitHash(page, '#/c/ryu/r/r1');
      const la = (await stored(page)).combos.find((c) => c.id === 'la');
      const was = seed26().combos.find((c) => c.id === 'la');
      assert.equal(la.title, '投げ重ね（改）');
      for (const k of ['parentId', 'sectionId', 'createdAt', 'position', 'favorite', 'characterId']) assert.equal(la[k], was[k], k);
      assert.ok(la.updatedAt >= was.createdAt && la.updatedAt !== was.updatedAt);
      assert.equal(await fk(page), 'node:la');
      assert.equal(await page.locator('.t-sec h3').first().textContent(), '連携A 投げ重ね（改）');
    });
    await check(`${tag} 26f2 編集（3段目）: h1「分岐の編集」、つなぐ元は「分岐 ガード時」。取り消す前に戻るボタンは根の詳細へ`, async () => {
      await gotoHash(page, '#/c/ryu/r/la1x/edit');
      await settle(page);
      assert.equal(await page.locator('.topbar h1').innerText(), '分岐の編集');
      assert.equal((await page.locator('.parent-ctx .pc-name').innerText()).replace(/\s+/g, ' '), 'つなぐ元 分岐 ガード時');
      await page.getByRole('button', { name: 'コンボの詳細に戻る' }).click();
      await waitHash(page, '#/c/ryu/r/r1');
    });
    await check(`${tag} 26f2 根の編集: セクション・位置・タイトル欄がある。連携・分岐があるときだけ「連携・分岐 N件も一緒に移ります」（select の aria-describedby）。［完了］は #f-sec へ`, async () => {
      await gotoHash(page, '#/c/ryu/r/r1/edit');
      await settle(page);
      assert.equal(await page.locator('.topbar h1').innerText(), '記録の編集');
      assert.equal(await page.locator('.parent-ctx').count(), 0);
      assert.equal(await page.locator('#f-sec-hint').innerText(), '連携・分岐 7件も一緒に移ります'); // la・la1・la2・la1x・lb・lc と、いま足した反撃
      assert.equal(await page.locator('#f-sec').getAttribute('aria-describedby'), 'f-sec-hint');
      assert.equal(await page.locator('fieldset.seg').count(), 1);
      await page.getByRole('button', { name: 'パッドを閉じて項目の入力へ' }).click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'f-sec');
      await gotoHash(page, '#/c/ryu/r/r0/edit');
      await settle(page);
      assert.equal(await page.locator('#f-sec-hint').count(), 0);
      assert.equal(await page.locator('#f-sec').getAttribute('aria-describedby'), null);
    });
    await shot(page, '26f2-edit-child', width);
    await page.context().close();
  }

  // 26g 子のidの詳細・上限（基準7）。URLの直開きのリダイレクト
  {
    seq = 0;
    const full = { sections: [sec('s1', 'ryu', '通常', 0), sec('s2', 'ryu', '画面端', 1)], combos: [mk('q1', 's1', '満杯', PK)] };
    for (let i = 0; i < 8; i++) full.combos.push(kid(`ql${i}`, 'q1', `連携${i}`, PK));
    for (let j = 0; j < 8; j++) full.combos.push(kid(`qb${j}`, 'ql0', `分岐${j}`, PK));
    full.combos.push(kid('qt0', 'qb0', '3段目', PK));
    full.combos.push(mk('kenroot', 's1', 'ほかの根', PK));
    const page = await newPage(width, full);
    await gotoHash(page, '#/c/ryu/r/q1');
    await check(`${tag} 26g 連携が8件: ［＋ 追加］は aria-disabled="true"（フォーカスは受ける）。押すとトーストが出て、画面は移らない`, async () => {
      const add = page.locator('[data-fk="add-link"]');
      assert.equal(await add.getAttribute('aria-disabled'), 'true');
      assert.equal(await add.evaluate((e) => e.disabled), false); // disabled 属性は付けない（Playwright は aria-disabled を無効とみなすので、押す操作は force）
      assert.equal(await add.evaluate((e) => Number(getComputedStyle(e).opacity)), 0.4);
      await add.focus();
      assert.equal(await fk(page), 'add-link');
      await add.click({ force: true });
      assert.deepEqual(await toastText(page), ['連携は1つのコンボに8個までです']);
      assert.equal(await hash(page), '#/c/ryu/r/q1');
      assert.equal(await page.locator('.t-sec-n').innerText(), '8件');
    });
    await check(`${tag} 26g 分岐が8個の連携: ［…］の「分岐を追加（8個まで）」は無効。3段目の「分岐を追加（3段目には付けられません）」は無効`, async () => {
      await openMenu(page, 'ql0');
      assert.deepEqual((await menuNames(page))[1], { t: '分岐を追加（8個まで）', d: true });
      await page.keyboard.press('Escape');
      await gone(page);
      await page.locator('[data-fk="fold:qb0"]').click();
      await openMenu(page, 'qt0');
      assert.deepEqual((await menuNames(page))[1], { t: '分岐を追加（3段目には付けられません）', d: true });
      await page.keyboard.press('Escape');
      await gone(page);
    });
    await check(`${tag} 26g URLの直開き: 3段目の下は根の詳細へ（トースト「分岐は3段目までです」）、8個の親は「分岐は8個までです」、親がない・別キャラ・p が空・形が不正は一覧へ`, async () => {
      await gotoHash(page, '#/c/ryu/new?p=qt0');
      await waitHash(page, '#/c/ryu/r/q1');
      assert.deepEqual(await toastText(page), ['分岐は3段目までです']);
      await gotoHash(page, '#/c/ryu/new?p=ql0');
      await waitHash(page, '#/c/ryu/r/q1');
      assert.deepEqual(await toastText(page), ['分岐は8個までです']);
      await gotoHash(page, '#/c/ryu/new?p=q1');
      await waitHash(page, '#/c/ryu/r/q1');
      assert.deepEqual(await toastText(page), ['分岐は8個までです']);
      await gotoHash(page, '#/c/ryu/new?p=nothing');
      await waitHash(page, '#/c/ryu');
      await gotoHash(page, '#/c/ken/new?p=q1');
      await waitHash(page, '#/c/ken');
      await gotoHash(page, '#/c/ryu/new?p=%21%21');
      await waitHash(page, '#/c/ryu');
      await gotoHash(page, '#/c/ryu/new?p=');
      await waitHash(page, '#/c/ryu');
      await gotoHash(page, '#/c/ken/new?p=');
      await waitHash(page, '#/c/ken');
    });
    await page.reload();
    await check(`${tag} 26g 子のidの詳細（#/c/ryu/r/qt0）は根の詳細へ置き換え、そのノードの祖先を開いて［…］にフォーカス。戻る履歴は増えない`, async () => {
      const hl = await page.evaluate(() => history.length);
      await gotoHash(page, '#/c/ryu/r/qt0');
      await waitHash(page, '#/c/ryu/r/q1');
      await page.waitForSelector('.t-sec');
      assert.equal(await fk(page), 'node:qt0');
      assert.equal(await page.locator('[data-fk="fold:qb0"]').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.evaluate(() => history.length), hl + 1); // 子のid自体への移動の1つだけ。リダイレクトは置き換え
      await gotoHash(page, '#/c/ryu/r/nothing');
      await waitHash(page, '#/c/ryu');
    });
    await page.context().close();

    // 保存の直前の再検査: 他タブの書き込みが storage イベントなしで入った状態（イベントの配信前）を、同じページから localStorage に書いて再現する。
    // 書いたページには storage イベントが届かないので、アプリは変更を知らない。1回目の保存は commit の lastSeen の比較で止まり（読み直す）、2回目は再検査が理由を出す
    const base7 = { sections: [sec('s1', 'ryu', '通常', 0)], combos: [mk('p1', 's1', '親', PK), ...Array.from({ length: 7 }, (_, i) => kid(`pk${i}`, 'p1', `連携${i}`, PK))] };
    for (const [label, mutate, re] of [
      ['8個になった', (d) => ({ ...d, combos: [...d.combos, kid('pk7', 'p1', 'x', PK)] }), /分岐は8個までです。ほかの分岐を消すと保存できます/],
      ['親が消えた', (d) => ({ ...d, combos: [] }), /^つなぐ元の記録が見つかりません。他のタブで削除された可能性があります/],
    ]) {
      const page2 = await newPage(width, base7);
      await gotoHash(page2, '#/c/ryu/new?p=p1');
      await settle(page2);
      await page2.locator('#f-title').fill('入力途中');
      await page2.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc(mutate(base7)));
      const before = await storedRaw(page2);
      await page2.getByRole('button', { name: '保存', exact: true }).click();
      await check(`${tag} 26g 保存の直前（${label}）1回目: 他タブの書き込みを検出して止まる。画面は移らず、入力内容と保存データはそのまま`, async () => {
        assert.equal(await page2.locator('.err h2').innerText(), '保存しませんでした');
        assert.equal(await hash(page2), '#/c/ryu/new?p=p1');
        assert.equal(await page2.locator('#f-title').inputValue(), '入力途中');
        assert.equal(await storedRaw(page2), before);
      });
      await page2.getByRole('button', { name: '保存', exact: true }).click();
      await check(`${tag} 26g 保存の直前の再検査（${label}）2回目: 画面を移らず、errorBox「保存できませんでした」に理由。入力内容と保存データはそのまま`, async () => {
        assert.equal(await hash(page2), '#/c/ryu/new?p=p1');
        assert.equal(await page2.locator('.err h2').innerText(), '保存できませんでした');
        assert.match(await page2.locator('.err p').innerText(), re);
        assert.equal(await page2.locator('#f-title').inputValue(), '入力途中');
        assert.equal(await storedRaw(page2), before);
      });
      await page2.context().close();
    }
  }

  // 26h 削除と取り消し（基準8）
  {
    const seed = seed26();
    const page = await newPage(width, seed);
    await gotoHash(page, '#/c/ryu/r/r1');
    await check(`${tag} 26h 子孫3件のノードの削除: 確認シート（見出し「『投げ重ね』を削除」、本文に「3件」）→ 実行で4件が消える。トースト、フォーカスは［元に戻す］`, async () => {
      await openMenu(page, 'la');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      assert.equal(await page.locator('.sheet h2').innerText(), '『投げ重ね』を削除');
      assert.match(await page.locator('.sheet .note').innerText(), /この連携の下にある分岐 3件もまとめて削除/);
      assert.match(await page.locator('.sheet .note').innerText(), /6秒間は［元に戻す］/);
      assert.equal((await stored(page)).combos.length, 9); // まだ消えていない
      await page.locator('.sheet-foot .btn.primary').click();
      await gone(page);
      assert.deepEqual((await stored(page)).combos.map((c) => c.id), ids26(seed).filter((i) => !['la', 'la1', 'la2', 'la1x'].includes(i)));
      assert.deepEqual(await toastText(page), ['『投げ重ね』と分岐3件を削除しました']);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('toast-act')), true);
    });
    await check(`${tag} 26h 取り消し: data が元と deepEqual（子孫も全部戻る）。フォーカスは［…］へ`, async () => {
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(seed));
      assert.equal(await fk(page), 'node:la');
      assert.deepEqual(await nodeIds(page), ['la', 'la1', 'la2', 'lb', 'lc']);
    });
    await check(`${tag} 26h 子孫のないノードの削除: 確認なしで消え、トーストは「『打撃重ね』を削除しました」。見出しが空なら「連携B」。取り消しで戻る`, async () => {
      await openMenu(page, 'lc');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await gone(page);
      assert.deepEqual(await toastText(page), ['『打撃重ね』を削除しました']);
      assert.equal((await stored(page)).combos.length, 8);
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(seed));
      await openMenu(page, 'lb');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await gone(page);
      assert.deepEqual(await toastText(page), ['連携Bを削除しました']);
      await page.locator('.toast-act').click();
      await openMenu(page, 'la2');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await gone(page);
      assert.deepEqual(await toastText(page), ['分岐を削除しました']);
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(seed));
    });
    await check(`${tag} 26h 2段目（子1件）の削除: 「『ガード時』と分岐1件」。確認の本文は「この分岐の下にある分岐 1件」`, async () => {
      await openMenu(page, 'la1');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      assert.match(await page.locator('.sheet .note').innerText(), /この分岐の下にある分岐 1件/);
      await page.locator('.sheet-foot .btn.primary').click();
      await gone(page);
      assert.deepEqual(await toastText(page), ['『ガード時』と分岐1件を削除しました']);
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(seed));
    });
    await shot(page, '26h-sheet', width);
    await check(`${tag} 26h 確認シートの［閉じる］: 何も消えない。コンボ側（根）の削除は確認シート「『起き攻めループ』を削除」、本文「このコンボの連携・分岐 6件」`, async () => {
      await openMenu(page, 'la');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await shot(page, '26h-confirm', width);
      await page.getByRole('button', { name: '閉じる' }).click();
      await gone(page);
      assert.deepEqual(await stored(page), raw(seed));
      await page.getByRole('button', { name: 'その他…' }).click();
      await page.waitForSelector('.sheet');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      assert.equal(await page.locator('.sheet h2').innerText(), '『起き攻めループ』を削除');
      assert.match(await page.locator('.sheet .note').innerText(), /このコンボの連携・分岐 6件もまとめて削除/);
    });
    await check(`${tag} 26h 根の削除（子孫あり）: 一覧へ移り、トースト「『起き攻めループ』と連携・分岐6件を削除しました」。7件が消え、取り消しで全件が元どおり`, async () => {
      await page.locator('.sheet-foot .btn.primary').click();
      await waitHash(page, '#/c/ryu');
      assert.deepEqual((await stored(page)).combos.map((c) => c.id), ['r0', 'r2']);
      assert.deepEqual(await toastText(page), ['『起き攻めループ』と連携・分岐6件を削除しました']);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('toast-act')), true);
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(seed));
      assert.equal(await page.locator('.item').count(), 3);
    });
    await check(`${tag} 26h 子孫のない根の削除は今のまま確認なし（子孫がなければシートを出さずに消える）`, async () => {
      await gotoHash(page, '#/c/ryu/r/r0');
      await page.getByRole('button', { name: 'その他…' }).click();
      await page.waitForSelector('.sheet');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await waitHash(page, '#/c/ryu');
      assert.deepEqual(await toastText(page), ['「連携なし」を削除しました']);
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(seed));
    });
    await page.context().close();
  }

  // 26i 複製と移動（基準9）
  {
    const seed = seed26();
    const page = await newPage(width, seed);
    await gotoHash(page, '#/c/ryu/r/r1');
    await page.getByRole('button', { name: '複製', exact: true }).click();
    await page.waitForFunction(() => /#\/c\/ryu\/r\/(?!r1$)/.test(location.hash));
    const d = await stored(page);
    const copyId = (await hash(page)).split('/').pop();
    await check(`${tag} 26i 複製: 子孫も複製（件数同じ）。idはすべて新しく、parentId が新しいidを指し、兄弟の順序は元と同じ。トースト「複製しました（連携・分岐6件を含む）」`, async () => {
      assert.equal(d.combos.length, 9 + 7);
      const old = new Set(ids26(seed));
      const fresh = d.combos.filter((c) => !old.has(c.id));
      assert.equal(fresh.length, 7);
      assert.equal(new Set(d.combos.map((c) => c.id)).size, d.combos.length);
      const copy = fresh.find((c) => c.id === copyId);
      assert.equal(copy.parentId, undefined);
      assert.equal(descendantTree(d.combos, copyId).length, 6);
      for (const c of fresh) if (c.id !== copyId) assert.ok(fresh.some((p) => p.id === c.parentId), `${c.id} の親は複製の中`);
      const titles = (rootId) => descendantTree(d.combos, rootId).map((n) => [n.depth, n.combo.title]);
      assert.deepEqual(titles(copyId), titles('r1')); // 先行順（兄弟は childrenOf の順）が同じ
      assert.deepEqual(childrenOf(d.combos, copyId).map((c) => c.title), childrenOf(d.combos, 'r1').map((c) => c.title));
      for (const c of fresh.filter((x) => x.id !== copyId)) assert.equal(c.sectionId, 's1');
      assert.deepEqual(await toastText(page), ['複製しました（連携・分岐6件を含む）']);
      assert.equal(await page.locator('.t-sec-n').innerText(), '3件');
      assert.equal(await page.locator('.d-title').innerText(), '起き攻めループのコピー');
    });
    await check(`${tag} 26i 連携のない根の複製のトーストは「複製しました」`, async () => {
      await gotoHash(page, '#/c/ryu/r/r0');
      await page.getByRole('button', { name: '複製', exact: true }).click();
      await page.waitForFunction(() => !/r\/r0$/.test(location.hash));
      assert.deepEqual(await toastText(page), ['複製しました']);
      assert.equal((await stored(page)).combos.length, 9 + 7 + 1);
    });
    await page.context().close();

    const page2 = await newPage(width, seed);
    await gotoHash(page2, '#/c/ryu/r/r1/edit');
    await settle(page2);
    await page2.locator('#f-sec').selectOption('s2');
    await page2.getByRole('button', { name: '保存', exact: true }).click();
    await waitHash(page2, '#/c/ryu/r/r1');
    await check(`${tag} 26i 根のセクションを変えて保存: 子孫の sectionId も変わる。ほかの記録は変わらない`, async () => {
      const m = await stored(page2);
      for (const c of m.combos) assert.equal(c.sectionId, ['r0'].includes(c.id) ? 's1' : 's2', c.id);
      assert.equal(m.combos.length, 9);
      assert.match(await page2.locator('.d-meta').innerText(), /^画面端/);
      assert.equal(await page2.locator('.t-sec-n').innerText(), '3件');
    });
    await gotoHash(page2, '#/c/ryu');
    await check(`${tag} 26i 一覧: 移った先の根は連携つきで出る。帯の件数は根の数（s1:1件、s2:2件）`, async () => {
      assert.deepEqual(await page2.$$eval('.sec-count', (e) => e.map((x) => x.textContent)), ['1件', '2件']);
      assert.equal(await page2.locator('.item', { hasText: '起き攻めループ' }).locator('.lnk').innerText(), '連携 3');
    });
    await page2.context().close();

    // セクションの削除の移動: 連携・分岐も一緒に移る。確認の件数は根の数
    const page3 = await newPage(width, seed);
    await gotoHash(page3, '#/c/ryu');
    await page3.getByRole('button', { name: '通常のメニュー' }).click();
    await page3.waitForSelector('.sheet');
    await page3.getByRole('button', { name: '削除', exact: true }).click();
    await check(`${tag} 26i セクション削除の確認は根の数（「通常」には記録が2件。連携・分岐を含む全件は8件）。移動先の件数も根の数（画面端 1件）`, async () => {
      assert.match(await page3.locator('.sheet .note').innerText(), /「通常」には記録が2件あります/);
      assert.equal((await page3.locator('.radio .muted').innerText()).trim(), '1件');
    });
    await page3.locator('.radio input').check();
    await page3.getByRole('button', { name: '移動して削除' }).click();
    await gone(page3);
    await check(`${tag} 26i セクション削除で根と一緒に子孫も移る。トーストは根の数（2件）`, async () => {
      const m = await stored(page3);
      assert.equal(m.sections.length, 1);
      assert.ok(m.combos.every((c) => c.sectionId === 's2'));
      assert.equal(m.combos.length, 9);
      assert.match((await toastText(page3))[0], /2件を「画面端」へ移動しました/);
      await page3.locator('.toast-act').click();
      assert.deepEqual(await stored(page3), raw(seed));
    });
    await page3.context().close();
  }

  // 26j 件数とネオン（基準10）: キャラ選択・ネオン・読み上げ名は連携・分岐も数える
  {
    seq = 0;
    const ar = (id, parentId, extra = {}) => mk(id, 'sa', '', PK, { characterId: 'arjun', ...(parentId && { parentId }), ...extra });
    const seed = { sections: [sec('sa', 'arjun', '通常', 0)], combos: [ar('x1'), ar('x2', 'x1'), ar('x3', 'x2'), ar('x4', 'x3'), ar('x5', 'x1')] };
    const page = await newPage(width, seed);
    await check(`${tag} 26j キャラ選択: aria-label「アルジュン 5件」、data-lv は neonLevel(5)。見た目に件数の文字は出ない`, async () => {
      assert.equal(await page.locator('.cell[aria-label^="アルジュン"]').getAttribute('aria-label'), 'アルジュン 5件');
      assert.equal(await page.locator('.cell[aria-label^="アルジュン"]').getAttribute('data-lv'), String(neonLevel(5)));
      assert.equal((await page.locator('.cell[aria-label^="アルジュン"]').innerText()).trim(), 'ARJUN');
    });
    await gotoHash(page, '#/c/arjun');
    await check(`${tag} 26j 一覧: ワードマークの data-lv も neonLevel(5)。帯の件数は根の1件。「連携 2」（x2・x5。孫は数えない）`, async () => {
      assert.equal(await page.locator('.wm').getAttribute('data-lv'), String(neonLevel(5)));
      assert.equal(await page.locator('.sec-count').innerText(), '1件');
      assert.equal((await page.locator('.item .lnk').innerText()).replace(/\s+/g, ' '), '連携 2');
      assert.equal(await page.locator('.item').count(), 1);
    });
    await page.context().close();
  }

  // 26k 下書き（基準11）: 根の新規 new:<sid> と連携の新規 child:<pid> は別々に残り、開き直すと両方とも戻る
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu/new?s=s1');
    await settle(page);
    await page.locator('#f-title').fill('根の下書き');
    await gotoHash(page, '#/c/ryu/new?p=r1');
    await settle(page);
    await page.locator('#f-title').fill('連携の下書き');
    await gotoHash(page, '#/c/ryu/new?p=la');
    await settle(page);
    await page.locator('#f-title').fill('分岐の下書き');
    await check(`${tag} 26k 下書きのキー: new:s1・child:r1・child:la が別々に残り、child の中身に parentId が入る。ほかに parentId は入らない`, async () => {
      const d = JSON.parse(await storedRaw(page, 'sf6memo.drafts'));
      assert.deepEqual(Object.keys(d).sort(), ['child:la', 'child:r1', 'new:s1']);
      assert.equal(d['child:r1'].parentId, 'r1');
      assert.equal(d['child:la'].parentId, 'la');
      assert.equal(d['new:s1'].parentId, undefined);
      assert.deepEqual([d['new:s1'].title, d['child:r1'].title, d['child:la'].title], ['根の下書き', '連携の下書き', '分岐の下書き']);
    });
    await check(`${tag} 26k 開き直すと、それぞれの下書きが戻る（通知「前回の下書きを開きました」）`, async () => {
      for (const [h, t] of [['#/c/ryu/new?s=s1', '根の下書き'], ['#/c/ryu/new?p=r1', '連携の下書き'], ['#/c/ryu/new?p=la', '分岐の下書き']]) {
        await gotoHash(page, h);
        await settle(page);
        assert.equal(await page.locator('#f-title').inputValue(), t, h);
        assert.match(await page.locator('.notice').innerText(), /前回の下書きを開きました/);
      }
    });
    await check(`${tag} 26k 中身の parentId がキーの親と一致しない下書きは捨てる（改ざん・取り違え）。親が消えた子の下書きは残る`, async () => {
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('sf6memo.drafts'));
        d['child:r1'].parentId = 'la';
        d['child:la'] = { ...d['child:la'] }; delete d['child:la'].parentId; // 中身に parentId がない
        localStorage.setItem('sf6memo.drafts', JSON.stringify(d));
      });
      await gotoHash(page, '#/c/ryu/new?p=r1');
      await settle(page);
      assert.equal(await page.locator('#f-title').inputValue(), '');
      await gotoHash(page, '#/c/ryu/new?p=la');
      await settle(page);
      assert.equal(await page.locator('#f-title').inputValue(), '');
    });
    await check(`${tag} 26k 根を削除すると、その根と子孫の下書き（edit:<id>・child:<削除したid>）が消える。ほかの記録の下書きは残る。取り消しで記録が戻っても下書きは戻らない`, async () => {
      const put = (k, t, extra = {}) => page.evaluate(([key, title, ex]) => {
        const d = JSON.parse(localStorage.getItem('sf6memo.drafts') ?? '{}');
        d[key] = { sectionId: 's1', title, position: 'any', tokens: [], memo: '', tags: [], savedAt: 1, ...ex };
        localStorage.setItem('sf6memo.drafts', JSON.stringify(d));
      }, [k, t, extra]);
      await put('child:lb', '子の新規', { parentId: 'lb' });
      await put('edit:la1x', '孫の編集');
      await put('edit:r1', '根の編集');
      await put('child:la1', '分岐の新規', { parentId: 'la1' });
      await put('edit:r0', '別の根の編集');
      await put('child:r0', '別の根の連携の新規', { parentId: 'r0' });
      await gotoHash(page, '#/c/ryu/r/r1');
      await page.getByRole('button', { name: 'その他…' }).click();
      await page.waitForSelector('.sheet');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await page.locator('.sheet-foot .btn.primary').click();
      await waitHash(page, '#/c/ryu');
      const d = JSON.parse(await storedRaw(page, 'sf6memo.drafts'));
      assert.deepEqual(Object.keys(d).filter((k) => k !== 'new:s1').sort(), ['child:r0', 'edit:r0']);
      await page.locator('.toast-act').click();
      assert.equal((await stored(page)).combos.length, 9);
      assert.deepEqual(Object.keys(JSON.parse(await storedRaw(page, 'sf6memo.drafts'))).filter((k) => k !== 'new:s1').sort(), ['child:r0', 'edit:r0']);
    });
    await check(`${tag} 26k ノードを削除すると、そのノードと子孫の下書きが消える（確認なしの削除も、確認ありの削除も）`, async () => {
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('sf6memo.drafts') ?? '{}');
        for (const k of ['edit:la', 'edit:la1', 'edit:la1x', 'child:la', 'child:la1', 'child:lc', 'edit:lb']) d[k] = { sectionId: 's1', title: 't', position: 'any', tokens: [], memo: '', tags: [], savedAt: 1 };
        localStorage.setItem('sf6memo.drafts', JSON.stringify(d));
      });
      await gotoHash(page, '#/c/ryu/r/r1');
      await openMenu(page, 'lc'); // 子孫なし: 確認なし
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#t-lc'));
      await gone(page);
      await openMenu(page, 'la'); // 子孫あり: 確認シート
      await page.getByRole('button', { name: '削除', exact: true }).click();
      await page.locator('.sheet-foot .btn.primary').click();
      await page.waitForFunction(() => !document.querySelector('#t-la'));
      await gone(page);
      const left = Object.keys(JSON.parse(await storedRaw(page, 'sf6memo.drafts'))).filter((k) => k !== 'new:s1').sort();
      assert.deepEqual(left, ['child:r0', 'edit:lb', 'edit:r0']);
    });
    await check(`${tag} 26k 他のタブで消えた記録の下書きは、編集画面を開くときに掃除される（記録のない edit:・親のない child:）。生きている記録の下書きは残る`, async () => {
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('sf6memo.drafts') ?? '{}');
        for (const k of ['edit:gone1', 'child:gone2']) d[k] = { sectionId: 's1', title: 't', position: 'any', tokens: [], memo: '', tags: [], savedAt: 1 };
        localStorage.setItem('sf6memo.drafts', JSON.stringify(d));
      });
      await gotoHash(page, '#/c/ryu/new?s=s1');
      await settle(page);
      const left = Object.keys(JSON.parse(await storedRaw(page, 'sf6memo.drafts'))).sort();
      assert.deepEqual(left, ['child:r0', 'edit:lb', 'edit:r0', 'new:s1']);
    });
    await page.context().close();
  }

  // 26l 他タブ・書き出し/取り込み（基準12の一部。迷子は検証が拒否するので画面には来ない）
  {
    // 他のタブで変わったとき描き直す（基準の「状態」）
    const seed = seed26();
    const a = await newPage(width, seed);
    await gotoHash(a, '#/c/ryu/r/r1');
    const b = await a.context().newPage();
    await b.goto(BASE);
    const changed = { ...seed, combos: seed.combos.filter((c) => !['lb', 'lc'].includes(c.id)) };
    await b.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc(changed));
    await check(`${tag} 26l 他のタブで連携が消えたら、この画面の木も描き直される`, async () => {
      await a.waitForFunction(() => document.querySelectorAll('.t-sec h3').length === 1);
      assert.equal(await a.locator('.t-sec-n').innerText(), '1件');
    });
    // 編集中の子が他タブで消えたら、いまの redirectFor（一覧へ）
    await gotoHash(a, '#/c/ryu/r/la/edit');
    await settle(a);
    const gone2 = { ...seed, combos: seed.combos.filter((c) => !['la', 'la1', 'la2', 'la1x'].includes(c.id)) };
    await b.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc(gone2));
    await check(`${tag} 26l 編集中の子が他タブで消えたら一覧へ。新規作成中に親が消えたときも一覧へ`, async () => {
      await waitHash(a, '#/c/ryu');
      await gotoHash(a, '#/c/ryu/new?p=r1');
      await settle(a);
      await b.evaluate((doc) => localStorage.setItem('sf6memo.data', JSON.stringify(doc)), exportDoc({ ...seed, combos: [seed.combos.at(-1)] }));
      await waitHash(a, '#/c/ryu');
    });
    await a.context().close();

    // 書き出し・取り込み: parentId・createdAt が保たれ、木と順序が同じ
    const src = await newPage(width, seed);
    await gotoHash(src, '#/settings');
    const [dl] = await Promise.all([src.waitForEvent('download'), src.getByRole('button', { name: 'JSONを書き出す' }).click()]);
    const text = readFileSync(await dl.path(), 'utf8');
    await src.context().close();
    const dst = await newPage(width);
    await gotoHash(dst, '#/settings');
    await dst.locator('input[type=file]').setInputFiles({ name: 'in.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await dst.waitForSelector('.sheet');
    await check(`${tag} 26l 書き出し（schemaVersion 3）→ 取り込み: 確認の件数は連携・分岐を含む（追加 9件）。木と順序が同じ`, async () => {
      assert.equal(JSON.parse(text).schemaVersion, 3);
      assert.match((await dst.locator('.imp-count').first().innerText()), /追加 9件/);
      await dst.getByRole('button', { name: '取り込む', exact: true }).click();
      await gone(dst);
      assert.deepEqual(await stored(dst), raw(seed));
      await gotoHash(dst, '#/c/ryu/r/r1');
      assert.deepEqual(await nodeIds(dst), ['la', 'la1', 'la2', 'lb', 'lc']);
    });
    await dst.context().close();
  }

  // 26n 9個以上の兄弟（2端末のマージで起こりうる。検証は個数を縛らず、上限8個は追加時だけ）
  {
    seq = 0;
    const nine = { sections: [sec('s1', 'ryu', '通常', 0)], combos: [mk('nr', 's1', '兄弟が9個', PK), mk('nq', 's1', '別の根', PK)] };
    for (let i = 0; i < 9; i++) nine.combos.push(kid(`n${i}`, 'nr', `連携${i}`, PK, i === 0 ? { tags: ['a'] } : {}));
    for (let j = 0; j < 9; j++) nine.combos.push(kid(`b${j}`, 'n0', `分岐${j}`, [SP('236', 'M', 'P')]));
    nine.combos.push(kid('ng', 'n8', '孫', PK), kid('nq1', 'nq', '別の連携', PK));
    const page = await newPage(width, nine);
    await gotoHash(page, '#/c/ryu/r/nr');
    await check(`${tag} 26n 詳細: 連携9個がすべて出る（記号 A〜I）。件数「9件」、リストの読み上げ名「連携 9件」、横スクロールなし。［…］は44×44`, async () => {
      assert.equal(await page.locator('section.t-sec > ul.t-list.d1 > li').count(), 9);
      assert.deepEqual(await page.$$eval('.t-no', (e) => e.map((x) => x.textContent)), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
      assert.equal(await page.locator('.t-sec-n').innerText(), '9件');
      assert.equal(await page.locator('ul.t-list.d1').getAttribute('aria-label'), 'リュウのコンボ『兄弟が9個』の連携 9件');
      assert.equal(await page.locator('.t-sec h3').nth(8).textContent(), '連携I 連携8');
      assert.ok(await noHScroll(page));
      assert.deepEqual(await page.$$eval('.t-row .icon-btn', (e) => [...new Set(e.map((x) => `${x.offsetWidth}x${x.offsetHeight}`))]), ['44x44']);
      assert.deepEqual(page.errors, []);
    });
    await shot(page, '26n-detail-9', width);
    await check(`${tag} 26n 追加は無効: ［＋ 追加］は aria-disabled でトースト「連携は1つのコンボに8個までです」。URL の直開きは根の詳細へ戻してトースト`, async () => {
      assert.equal(await page.locator('[data-fk="add-link"]').getAttribute('aria-disabled'), 'true');
      await page.locator('[data-fk="add-link"]').click({ force: true });
      assert.deepEqual(await toastText(page), ['連携は1つのコンボに8個までです']);
      assert.equal(await hash(page), '#/c/ryu/r/nr');
      await gotoHash(page, '#/c/ryu/new?p=nr');
      await waitHash(page, '#/c/ryu/r/nr');
      assert.deepEqual(await toastText(page), ['分岐は8個までです']);
    });
    await check(`${tag} 26n 分岐が9個ある連携（n0）: 折りたたみは「分岐 9件」で、開くと9個とも出る。［…］の「分岐を追加」は無効（8個まで）`, async () => {
      assert.equal(await page.locator('[data-fk="fold:n0"] span').innerText(), '分岐 9件');
      assert.equal(await page.locator('#t-list-n0').getAttribute('aria-label'), '連携A『連携0』の分岐 9件');
      assert.equal(await page.locator('#t-list-n0 > li').count(), 9);
      assert.ok(await noHScroll(page));
      await openMenu(page, 'n0');
      assert.deepEqual((await menuNames(page))[1], { t: '分岐を追加（8個まで）', d: true });
      await page.keyboard.press('Escape');
      await gone(page);
    });
    await shot(page, '26n-detail-9b', width);
    await check(`${tag} 26n 一覧: 根の行の「連携 9」（直接の子だけ。孫は数えない）。帯の件数は根の数（2件）`, async () => {
      await gotoHash(page, '#/c/ryu');
      assert.deepEqual(await page.$$eval('.item', (e) => e.map((x) => [x.querySelector('.item-title').textContent, x.querySelector('.lnk')?.textContent.replace(/\s+/g, ' ')])), [['別の根', '連携 1'], ['兄弟が9個', '連携 9']]); // 新しい順
      assert.equal(await page.locator('.sec-count').innerText(), '2件');
    });
    await check(`${tag} 26n 削除の連動: 連携が9個の根を消すと連携・分岐19件を含めて消え（確認文は「連携・分岐 19件」）、取り消しで元と deepEqual`, async () => {
      await gotoHash(page, '#/c/ryu/r/nr');
      await page.getByRole('button', { name: 'その他…' }).click();
      await page.waitForSelector('.sheet');
      await page.getByRole('button', { name: '削除', exact: true }).click();
      assert.match(await page.locator('.sheet .note').innerText(), /このコンボの連携・分岐 19件もまとめて削除/);
      await page.locator('.sheet-foot .btn.primary').click();
      await waitHash(page, '#/c/ryu');
      assert.deepEqual((await stored(page)).combos.map((c) => c.id), ['nq', 'nq1']);
      assert.deepEqual(await toastText(page), ['『兄弟が9個』と連携・分岐19件を削除しました']);
      await page.locator('.toast-act').click();
      assert.deepEqual(await stored(page), raw(nine));
    });
    await check(`${tag} 26n 複製の連動: 兄弟が9個の根を複製すると、連携・分岐19件を含めて複製される（新しい id、親子と兄弟の順序は元と同じ）。元は変わらない`, async () => {
      await gotoHash(page, '#/c/ryu/r/nr');
      await page.evaluate(() => { window.__screen = document.querySelector('.screen'); });
      await page.getByRole('button', { name: '複製' }).click();
      await page.waitForFunction(() => { const s = document.querySelector('.screen'); return s !== window.__screen && s.getAnimations().length === 0; });
      assert.deepEqual(await toastText(page), ['複製しました（連携・分岐19件を含む）']);
      const d = await stored(page);
      const copyRoot = d.combos.find((c) => c.parentId === undefined && c.title.startsWith('兄弟が9個') && c.id !== 'nr');
      assert.equal(d.combos.length, nine.combos.length + 20);
      assert.equal(await hash(page), `#/c/ryu/r/${copyRoot.id}`);
      assert.equal(await page.locator('.t-sec-n').innerText(), '9件');
      const titles = (id) => childrenOf(d.combos, id).map((c) => c.title);
      assert.deepEqual(titles(copyRoot.id), titles('nr'));
      const copyN0 = childrenOf(d.combos, copyRoot.id)[0];
      assert.deepEqual(titles(copyN0.id), titles('n0')); // 分岐9個も同じ順
      assert.deepEqual(d.combos.slice(0, nine.combos.length), raw(nine).combos); // 元は変わらない
      assert.equal(new Set(d.combos.map((c) => c.id)).size, d.combos.length);
    });
    await page.context().close();
  }

  // 26o 2タブ・取り込み・保存失敗の取り消し（レビューの指摘 L-1・L-3・M-1）
  {
    // L-1: 8個目の連携を別タブが先に保存したとき、移された理由のトーストが「下書きを残しました」に上書きされない
    seq = 0;
    const base7 = { sections: [sec('s1', 'ryu', '通常', 0)], combos: [mk('p1', 's1', '親', PK), ...Array.from({ length: 7 }, (_, i) => kid(`pk${i}`, 'p1', `連携${i}`, PK))] };
    const a = await newPage(width, base7);
    const b = await a.context().newPage();
    await b.goto(BASE);
    await gotoHash(a, '#/c/ryu/new?p=p1');
    await settle(a);
    await a.locator('#f-title').fill('Aの入力途中');
    await gotoHash(b, '#/c/ryu/new?p=p1');
    await settle(b);
    await b.locator('#f-title').fill('Bの8個目');
    await b.getByRole('button', { name: '保存', exact: true }).click();
    await waitHash(a, '#/c/ryu/r/p1');
    await check(`${tag} 26o 8個目を他タブが先に保存: こちらのタブは根の詳細へ移り、トーストは理由「分岐は8個までです」（「下書きを残しました」で上書きされない）`, async () => {
      assert.deepEqual(await toastText(a), ['分岐は8個までです']);
    });
    await a.context().close();

    // L-1: 保存で消す下書きは、保存した内容と一致するものだけ（キー child:<親id> は2タブで共有）
    const base3 = { sections: [sec('s1', 'ryu', '通常', 0)], combos: [mk('p1', 's1', '親', PK), ...Array.from({ length: 3 }, (_, i) => kid(`pk${i}`, 'p1', `連携${i}`, PK))] };
    const a2 = await newPage(width, base3);
    const b2 = await a2.context().newPage();
    await b2.goto(BASE);
    await gotoHash(a2, '#/c/ryu/new?p=p1');
    await settle(a2);
    await a2.locator('#f-title').fill('Aが保存する');
    await gotoHash(b2, '#/c/ryu/new?p=p1');
    await settle(b2);
    await b2.locator('#f-title').fill('Bの入力途中');
    await a2.getByRole('button', { name: '保存', exact: true }).click();
    await waitHash(a2, '#/c/ryu/r/p1');
    await check(`${tag} 26o 先に保存したタブは、他方の入力途中の下書きを消さない（一致する下書きだけ消す）`, async () => {
      assert.equal((await stored(a2)).combos.at(-1).title, 'Aが保存する');
      const d = JSON.parse(await storedRaw(a2, 'sf6memo.drafts'));
      assert.equal(d['child:p1'].title, 'Bの入力途中');
    });
    await check(`${tag} 26o 他方のタブは入力を保ったまま保存でき、保存した内容と一致する下書きは消える`, async () => {
      assert.equal(await b2.locator('#f-title').inputValue(), 'Bの入力途中');
      await b2.getByRole('button', { name: '保存', exact: true }).click();
      await waitHash(b2, '#/c/ryu/r/p1');
      assert.equal((await stored(b2)).combos.at(-1).title, 'Bの入力途中');
      assert.equal(Object.hasOwn(JSON.parse(await storedRaw(b2, 'sf6memo.drafts') ?? '{}'), 'child:p1'), false);
    });
    await a2.context().close();

    // L-3: 容量不足で取り消しが失敗したら、トーストを残して再試行できる
    const failWrites = (pg, on) => pg.evaluate((flag) => {
      if (!window.__origSet) {
        window.__origSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (window.__failData && k === 'sf6memo.data') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
          return window.__origSet.call(this, k, v);
        };
      }
      window.__failData = flag;
    }, on);
    const seed = seed26();
    const q = await newPage(width, seed);
    await gotoHash(q, '#/c/ryu/r/r1');
    await openMenu(q, 'la');
    await q.getByRole('button', { name: '削除', exact: true }).click();
    await q.locator('.sheet-foot .btn.primary').click();
    await gone(q);
    await failWrites(q, true);
    await q.locator('.toast-act').click();
    await check(`${tag} 26o 削除の取り消しが容量不足で失敗: トーストは消えず［元に戻す］が残り、フォーカスもそこに戻る。データは削除のまま、画面に保存失敗のエラー`, async () => {
      assert.equal(await q.locator('.toast-act').count(), 1);
      assert.deepEqual(await toastText(q), ['『投げ重ね』と分岐3件を削除しました']);
      assert.equal(await fk(q), 'BUTTON');
      assert.equal(await q.evaluate(() => document.activeElement.classList.contains('toast-act')), true);
      assert.equal((await stored(q)).combos.length, 5);
      assert.match(await q.locator('.err').innerText(), /保存できませんでした/);
    });
    await failWrites(q, false);
    await q.locator('.toast-act').click();
    await check(`${tag} 26o 再試行すると取り消せる（元と deepEqual）。トーストは消え、エラーも消える`, async () => {
      assert.deepEqual(await stored(q), raw(seed));
      assert.equal(await q.locator('.toast-act').count(), 0);
      assert.equal(await q.locator('.err').count(), 0);
    });
    // 根の削除（removeCombo）の取り消しも同じ
    await q.getByRole('button', { name: 'その他…' }).click();
    await q.waitForSelector('.sheet');
    await q.getByRole('button', { name: '削除', exact: true }).click();
    await q.locator('.sheet-foot .btn.primary').click();
    await waitHash(q, '#/c/ryu');
    await failWrites(q, true);
    await q.locator('.toast-act').click();
    await check(`${tag} 26o 根の削除の取り消しが容量不足で失敗: トーストが残り、再試行で全件戻る`, async () => {
      assert.equal(await q.locator('.toast-act').count(), 1);
      assert.equal((await stored(q)).combos.length, 2);
      await failWrites(q, false);
      await q.locator('.toast-act').click();
      assert.deepEqual(await stored(q), raw(seed));
    });
    await q.context().close();

    // M-1: 2端末のマージが混ざっても取り込める（子の sectionId は根に合わせる）。深さの競合のように本当に崩れるときは、番号のない固定文で拒否する
    seq = 0;
    const local = { sections: [sec('s1', 'ryu', '通常', 0), sec('s2', 'ryu', '画面端', 1)], combos: [mk('r', 's2', '根', PK, { updatedAt: T0 + 10 }), kid('c', 'r', '子', PK, { sectionId: 's2', updatedAt: T0 + 10 })] };
    const mixed = { sections: local.sections, combos: [mk('r', 's1', '根', PK), kid('c', 'r', '子（他端末で編集）', PK, { updatedAt: T0 + 50 })] };
    seq = 0;
    const importText = async (pg, doc) => {
      await gotoHash(pg, '#/settings');
      await pg.locator('input[type=file]').setInputFiles({ name: 'in.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exportDoc(doc))) });
    };
    const m = await newPage(width, local);
    await importText(m, mixed);
    await m.waitForSelector('.sheet');
    await check(`${tag} 26o 取り込み（根は端末で移動済み、子は他端末で編集）: 確認シートが出て（更新1件）、取り込むと子の編集が入り、sectionId は根（画面端）に合う`, async () => {
      assert.match(await m.locator('.imp-count').first().innerText(), /更新 1件/);
      await m.getByRole('button', { name: '取り込む', exact: true }).click();
      await gone(m);
      const d = await stored(m);
      assert.deepEqual(d.combos.map((c) => [c.id, c.sectionId, c.title]), [['r', 's2', '根'], ['c', 's2', '子（他端末で編集）']]);
    });
    await m.context().close();
    const chainDoc = { sections: [sec('s1', 'ryu', '通常', 0)], combos: [mk('a', 's1', 'a', PK), kid('b', 'a', 'b', PK), kid('c', 'b', 'c', PK)] };
    const deepIn = { sections: chainDoc.sections, combos: [mk('z', 's1', 'z', PK), kid('y', 'z', 'y', PK), kid('a', 'y', 'a', PK, { updatedAt: T0 + 5 })] };
    const x = await newPage(width, chainDoc);
    const before = await storedRaw(x);
    await importText(x, deepIn);
    await x.waitForSelector('.set-err .err');
    await check(`${tag} 26o 取り込みが本当に食い違う（マージ後に深さ4）: 見出し「取り込めませんでした（データは変更していません）」、理由は番号のない固定文。データは変わらない`, async () => {
      assert.equal(await x.locator('.set-err h2').innerText(), '取り込めませんでした（データは変更していません）');
      const why = await x.locator('.set-err p').innerText();
      assert.equal(why, '他の端末での変更と、セクションや連携の親子関係が食い違うため取り込めません');
      assert.doesNotMatch(why, /件目|combos|parentId/);
      assert.equal(await storedRaw(x), before);
    });
    await x.context().close();
  }

  // 26m グレースケールと色・禁止事項（基準12）
  {
    const page = await newPage(width, seed26());
    await gotoHash(page, '#/c/ryu/r/r1');
    await page.locator('[data-fk="fold:la1"]').click();
    await check(`${tag} 26m 新しい要素の色は既存トークンの値だけ。filter・box-shadow・text-shadow・グラデーションなし（コマンド列の中は除く）`, async () => {
      const TOKEN = new Set(['rgb(14, 15, 17)', 'rgb(23, 25, 28)', 'rgb(34, 37, 42)', 'rgb(46, 50, 56)', 'rgb(74, 80, 89)', 'rgb(107, 114, 124)', 'rgb(242, 238, 230)', 'rgb(170, 166, 157)', 'rgba(0, 0, 0, 0)']);
      const res = await page.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll('.t-sec, .t-sec-head, .t-sec-head *, .t-list, .t-node, .t-row, .t-row *, .t-no, .t-title, .t-title *, .t-cmd, .t-cmd-none, .t-meta, .t-meta *, .t-tags, .t-memo, .t-fold, .t-fold *')) {
          const cs = getComputedStyle(e);
          out.push([e.className.baseVal ?? e.className, cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderBottomColor, cs.borderLeftColor, cs.filter, cs.boxShadow, cs.textShadow, cs.backgroundImage]);
        }
        return out;
      });
      const ownColors = new Set();
      for (const [cls, color, bg, bt, bb, bl, filter, shadow, tshadow, img] of res) {
        for (const [k, v] of [['color', color], ['bg', bg]]) ownColors.add(`${k}:${v}`);
        assert.ok(TOKEN.has(color) && TOKEN.has(bg), `${cls} ${color} ${bg}`);
        assert.equal(filter, 'none', cls); assert.equal(shadow, 'none', cls); assert.equal(tshadow, 'none', cls); assert.equal(img, 'none', cls);
        for (const b of [bt, bb, bl]) assert.ok(TOKEN.has(b), `${cls} border ${b}`);
      }
      assert.ok(res.length > 40);
      // 木の線（li の ::before・::after）は --line-strong の1px
      const line = await page.$eval('.t-list.d1 > li', (e) => { const a = getComputedStyle(e, '::before'); const z = getComputedStyle(e, '::after'); return [a.borderLeftWidth, a.borderLeftColor, z.borderTopWidth, z.borderTopColor]; });
      assert.deepEqual(line, ['1px', 'rgb(74, 80, 89)', '1px', 'rgb(74, 80, 89)']);
      assert.equal(await page.$eval('.t-sec', (e) => getComputedStyle(e).borderTopColor), 'rgb(46, 50, 56)');
    });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' }); // 画素を取る前にグレースケールにする（検証だけ。アプリには入れない）
    await check(`${tag} 26m グレースケール: 階層が線・字下げ・見出しの文字で読める。木の線の画素が地と区別でき、2段目は1段目より右に字下げされる`, async () => {
      const x = await page.evaluate(() => ({ d1: document.querySelector('#t-la').getBoundingClientRect().left, d2: document.querySelector('#t-la1').getBoundingClientRect().left, d3: document.querySelector('#t-la1x').getBoundingClientRect().left }));
      assert.ok(x.d2 - x.d1 === 12 && x.d3 - x.d2 === 12, JSON.stringify(x)); // 字下げは1段12px
      // 1段目の縦線（ul.d1 の左端）の列に、地より明るい画素が続く
      const lineX = await page.$eval('.t-list.d1', (e) => Math.round(e.getBoundingClientRect().left));
      const top = await page.$eval('#t-la', (e) => Math.round(e.getBoundingClientRect().top));
      const png = await page.screenshot({ clip: { x: lineX - 2, y: top, width: 5, height: 120 } });
      const col = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let best = 0;
        for (let xx = 0; xx < c.width; xx++) { let n = 0; for (let y = 0; y < c.height; y++) { const i = (y * c.width + xx) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 55) n++; } best = Math.max(best, n); }
        return best;
      }, png.toString('base64'));
      assert.ok(col >= 100, `線の画素の列 ${col}/120`);
    });
    await page.context().close();
  }
}

// ===== SECTION: 28 一覧のタイトルの板と縦線（T-028、D-023） =====
// 一覧の .item-title だけが、傾いた板（--key）＋左の傾いた縦線（蛍光グリーン3px）。詳細・木・編集・キャラ選択は変わらない。
// ONLY_28=1 で28章だけ。BASE を、変異させた app/ のコピーを配信する別のサーバーに向けると変異テストになる。
const rgbOf = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const lumOf = (c) => { const [r, g, b] = rgbOf(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratioOf = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const width of process.env.ONLY_24 || process.env.ONLY_25 || process.env.ONLY_26 ? [] : [360, 390, 430].filter((w) => !process.env.WIDTH || Number(process.env.WIDTH) === w)) {
  const tag = `[${width}]`;
  const L45 = 'とても長いタイトルの確認用。端ループ（OD昇龍締め）からさらに続く説明が長く長く続く場合の見出し';
  const L100 = '長い見出しの確認用文字列'.repeat(9).slice(0, 100);
  const seed28 = () => ({
    sections: [sec('s1', 'ryu', '通常', 0), sec('s2', 'ryu', '画面端', 1)],
    combos: [
      combo('t1', 's1', '起き攻めループ', [N('crouch', 'M', 'K'), SP('236', 'H', 'P')], { damage: 3200, tags: ['基本'] }),
      combo('t2', 's1', '投げ重ね', [N('stand', 'L', 'P')], { parentId: 't1' }),
      combo('t3', 's1', '', [N('stand', 'H', 'P')], { damage: 2400 }),
      combo('t4', 's1', L45, [N('stand', 'L', 'P')], { damage: 4100 }),
      combo('t5', 's1', L100, [N('stand', 'L', 'P')]),
      combo('t6', 's1', '中足波動', [N('crouch', 'M', 'K')]),
      combo('t7', 's2', '', [N('stand', 'M', 'P')]),
    ],
  });
  const info = (page, rid) => page.evaluate((id) => {
    const item = document.querySelector(`.item[href$="/r/${id}"]`), t = item.querySelector('.item-title'), ir = item.getBoundingClientRect();
    if (!t) return { exists: false, itemH: ir.height, first: item.firstElementChild.className };
    const cs = getComputedStyle(t), bs = getComputedStyle(t, '::before'), r = t.getBoundingClientRect();
    return {
      exists: true, display: cs.display, position: cs.position, color: cs.color, fs: cs.fontSize, fw: cs.fontWeight, ov: cs.overflow, to: cs.textOverflow, ws: cs.whiteSpace, bg: cs.backgroundColor, shadow: cs.boxShadow, filter: cs.filter, lh: parseFloat(cs.lineHeight),
      b: { content: bs.content, bg: bs.backgroundColor, img: bs.backgroundImage, shadow: bs.boxShadow, tf: bs.transform, z: bs.zIndex, filter: bs.filter },
      w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, itemH: ir.height, itemL: ir.left, itemR: ir.right, clip: t.scrollWidth > t.clientWidth, text: t.textContent,
    };
  }, rid);
  const px = async (page, x, y, w = 1) => { // 等倍の画素の並び（y の1行、x から w 個）
    const png = await page.screenshot({ clip: { x, y, width: w, height: 1 } });
    return page.evaluate(async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = 1; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, 1).data; return Array.from({ length: c.width }, (_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]); }, png.toString('base64'));
  };
  const KEY = 'rgb(34, 37, 42)', BAR = 'rgb(150, 247, 176)', LIT = 'rgb(234, 255, 240)';

  // 28a 板・縦線・色の computed style と、文字のコントラスト
  {
    const page = await newPage(width, seed28());
    await gotoHash(page, '#/c/ryu');
    const t = await info(page, 't1');
    await check(`${tag} 28a 一覧のタイトル: 板は --key、縦線は #96F7B0 の3px、-12度の傾き。文字は --lit 15px/700、折り返さず省略表示。板は ::before だけで、タイトル自体に地・影・filter はない`, async () => {
      assert.equal(t.exists, true);
      assert.deepEqual([t.display, t.position, t.color, t.fs, t.fw, t.ov, t.to, t.ws], ['block', 'relative', LIT, '15px', '700', 'hidden', 'ellipsis', 'nowrap']);
      assert.deepEqual([t.bg, t.shadow, t.filter], ['rgba(0, 0, 0, 0)', 'none', 'none']);
      assert.deepEqual([t.b.content, t.b.bg, t.b.img, t.b.filter, t.b.z], ['""', KEY, 'none', 'none', '-1']);
      assert.equal(t.b.shadow, `${BAR} 3px 0px 0px 0px inset`);
      const m = t.b.tf.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
      assert.ok(m[0] === 1 && m[1] === 0 && m[3] === 1 && Math.abs(m[2] - Math.tan((-12 * Math.PI) / 180)) < 0.001, t.b.tf); // skewX(-12deg)
    });
    await check(`${tag} 28a 板（--key）の上のタイトル文字のコントラスト比は4.5:1以上（実測 ${ratioOf(LIT, KEY).toFixed(1)}:1）`, async () => {
      assert.ok(ratioOf(t.color, t.b.bg) >= 4.5, String(ratioOf(t.color, t.b.bg)));
    });
    await check(`${tag} 28a 実際の画素: 縦線の中ほどは #96F7B0、板の右端近くは --key`, async () => {
      const y = Math.round(t.top + t.h / 2); // 高さの中央は傾きによるずれが0
      const a = await px(page, Math.floor(t.left), y, Math.ceil(t.w));
      assert.deepEqual(a[4], [150, 247, 176]);
      assert.deepEqual(a[Math.floor(t.w) - 8], [34, 37, 42]);
    });
    await check(`${tag} 28a タイトルは行全体のリンク（a.item）の中。根のタイトルありは t1・t4・t5・t6の4件`, async () => {
      assert.equal(await page.locator('a.item > .item-title').count(), 4);
      assert.equal(await page.locator('.item-title').count(), 4);
    });
    await check(`${tag} 28a 板の傾きで外へ出る角（高さの半分×tan12度）が、板の左右の内側3pxに収まる（省略表示の overflow:hidden で欠けない）`, async () => {
      assert.ok((t.h / 2) * Math.tan((12 * Math.PI) / 180) <= 3, String(t.h));
    });
    await shot(page, '28-list', width);
    await page.context().close();
  }

  // 28b 高さ・タイトルなしの行・長いタイトル・連携のある根
  {
    const page = await newPage(width, seed28());
    await gotoHash(page, '#/c/ryu');
    const I = {};
    for (const id of ['t1', 't3', 't4', 't5', 't6', 't7']) I[id] = await info(page, id);
    await check(`${tag} 28b タイトルなしの行（t3・t7）に .item-title は出ない。先頭は .preview のまま`, async () => {
      for (const id of ['t3', 't7']) assert.deepEqual([I[id].exists, I[id].first], [false, 'preview']);
    });
    await check(`${tag} 28b 行の高さの増加: タイトル行は文字行（行高1.5×15px）に上下の padding 2px ずつを足した4px高い。行の高さはなしの行との差が、タイトル行の高さ＋下の余白4px`, async () => {
      assert.equal(I.t6.lh, 22.5);
      assert.equal(I.t6.h, 22.5 + 4); // 変更前のタイトル行（22.5px）に対して +4px
      assert.equal(I.t6.itemH - I.t7.itemH, I.t6.h + 4); // t7 は同じくダメージなしでタイトルなし // 下の余白 --s1 は変更前のまま
    });
    await check(`${tag} 28b 短いタイトルの板は文字幅（fit-content）で、行の内側の幅より狭い。長いタイトル（45字・100字）は行いっぱいで省略表示（...）、行の外へ出ない`, async () => {
      assert.ok(I.t6.w < I.t6.itemR - I.t6.itemL - 32 - 40 && !I.t6.clip, JSON.stringify([I.t6.w, I.t6.itemR - I.t6.itemL]));
      for (const id of ['t4', 't5']) {
        assert.equal(I[id].clip, true, id);
        assert.ok(I[id].right <= I[id].itemR - 16 + 0.5 && I[id].left >= I[id].itemL + 16 - 0.5, `${id} ${I[id].left} ${I[id].right}`);
        assert.equal(I[id].h, I.t6.h, `${id} は1行（折り返さない）`);
      }
      assert.equal(I.t5.text.length, 100);
    });
    await check(`${tag} 28b 連携のある根（t1）: 「連携 1」と板が共存し、板の右端がメタ行の「連携」「ダメージ」に重ならない。メタ・プレビューは板の下`, async () => {
      assert.equal(await page.locator('.item[href$="/r/t1"] .lnk').innerText().then((x) => x.replace(/\s+/g, ' ')), '連携 1');
      const r = await page.evaluate(() => { const it = document.querySelector('.item[href$="/r/t1"]'); const b = (s) => it.querySelector(s).getBoundingClientRect(); return { tb: b('.item-title').bottom, pt: b('.preview').top, pb: b('.preview').bottom, mt: b('.item-meta').top }; });
      assert.ok(r.tb <= r.pt && r.pb <= r.mt, JSON.stringify(r));
    });
    await check(`${tag} 28b 横スクロールなし。ページエラーなし。タイトルの板は行の左右の余白（16px）の内側`, async () => {
      assert.ok(await noHScroll(page));
      assert.deepEqual(page.errors, []);
    });
    await check(`${tag} 28b 一覧の中のタイトル以外（コマンド列の強度色の●・メタ・帯）は変わらない: 帯の高さ44px、メタ12px、プレビューの高さ28px`, async () => {
      const r = await page.evaluate(() => ({ head: document.querySelector('.sec-head').getBoundingClientRect().height, meta: getComputedStyle(document.querySelector('.meta-t')).fontSize, pv: document.querySelector('.preview').getBoundingClientRect().height }));
      assert.deepEqual(r, { head: 44, meta: '12px', pv: 28 });
    });
    await page.context().close();
  }

  // 28c メモの文字サイズ（大・中・小）でタイトルの寸法は不変（v2.3）
  {
    const dims = {};
    for (const sz of ['l', 'm', 's']) {
      const page = await newPage(width, seed28());
      await page.evaluate((s) => localStorage.setItem('sf6memo.settings', JSON.stringify({ memoSize: s })), sz);
      await page.reload();
      await gotoHash(page, '#/c/ryu');
      const i = await info(page, 't6');
      dims[sz] = [i.w, i.h, i.fs, i.color, i.b.bg, i.b.shadow];
      await page.context().close();
    }
    await check(`${tag} 28c メモの文字サイズ 大・中・小で、タイトルの板の幅・高さ・文字・色が同じ`, async () => {
      assert.deepEqual(dims.m, dims.l); assert.deepEqual(dims.s, dims.l);
      assert.equal(dims.l[2], '15px');
    });
  }

  // 28d 適用範囲: 詳細の .d-title・木の .t-title・編集・キャラ選択は変わらない
  {
    const page = await newPage(width, seed28());
    const plain = (sel) => page.evaluate((s) => { const e = document.querySelector(s), c = getComputedStyle(e), b = getComputedStyle(e, '::before'); return { bg: c.backgroundColor, shadow: c.boxShadow, pad: c.padding, color: c.color, fs: c.fontSize, bc: b.content, bbg: b.backgroundColor, bsh: b.boxShadow, tf: b.transform }; }, sel);
    await gotoHash(page, '#/c/ryu/r/t1');
    await check(`${tag} 28d 詳細: .d-title（17px・--fg、板・縦線なし）。木の .t-title も板なし（連携の木 D-022 のまま）`, async () => {
      assert.deepEqual(await plain('.d-title'), { bg: 'rgba(0, 0, 0, 0)', shadow: 'none', pad: '0px', color: 'rgb(242, 238, 230)', fs: '17px', bc: 'none', bbg: 'rgba(0, 0, 0, 0)', bsh: 'none', tf: 'none' });
      assert.equal(await page.locator('.item-title').count(), 0);
      const tt = await plain('.t-title');
      assert.deepEqual([tt.bg, tt.shadow, tt.bc, tt.fs, tt.color], ['rgba(0, 0, 0, 0)', 'none', 'none', '15px', 'rgb(242, 238, 230)']);
    });
    await gotoHash(page, '#/c/ryu/r/t1/edit');
    await check(`${tag} 28d 編集: .item-title も板もない`, async () => {
      assert.equal(await page.locator('.item-title').count(), 0);
      assert.ok(await noHScroll(page));
    });
    await gotoHash(page, '#/');
    await check(`${tag} 28d キャラ選択: .item-title なし。タイルの傾きの板（.cell）は従来のまま`, async () => {
      assert.equal(await page.locator('.item-title').count(), 0);
      assert.ok(await page.locator('.cell').count() > 0);
    });
    await gotoHash(page, '#/c/ryu');
    await check(`${tag} 28d キャラ選択から戻った一覧でも、板と縦線が出る（再描画後）`, async () => {
      const t = await info(page, 't6');
      assert.deepEqual([t.b.bg, t.b.shadow], [KEY, `${BAR} 3px 0px 0px 0px inset`]);
    });
    await page.context().close();
  }

  // 28e グレースケール: 色に頼らず、傾いた板の形と縦線の明度で区別できる（実際の画素。検証だけで filter を当てる）
  {
    const page = await newPage(width, seed28());
    await gotoHash(page, '#/c/ryu');
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    const t = await info(page, 't6');
    await check(`${tag} 28e グレースケール: 縦線は地より十分に明るく（輝度差100以上）、板は地（行の右の空き）より明るい（輝度差15以上）。板の上端と下端で左端の位置がずれる（傾き）`, async () => {
      const y = Math.round(t.top + t.h / 2), lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
      const a = await px(page, Math.floor(t.left), y, Math.ceil(t.w) + 20);
      const bar = lum(a[4]), board = lum(a[Math.floor(t.w) - 8]), bg = lum(a[a.length - 4]);
      assert.ok(bar - bg >= 100, `縦線 ${bar} 地 ${bg}`);
      assert.ok(board - bg >= 15, `板 ${board} 地 ${bg}`);
      // 上端近くと下端近くの行で、縦線（明るい画素）の左端 x が違う
      const edge = async (yy) => { const row = await px(page, Math.floor(t.left), yy, 16); return row.findIndex((p) => lum(p) > 150); };
      const top = await edge(Math.round(t.top) + 3), bot = await edge(Math.round(t.top + t.h) - 4);
      assert.ok(top > bot && top - bot >= 3, `上 ${top} 下 ${bot}`);
    });
    await check(`${tag} 28e 横スクロールなし`, async () => { assert.ok(await noHScroll(page)); });
    await shot(page, '28-list-gray', width);
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
