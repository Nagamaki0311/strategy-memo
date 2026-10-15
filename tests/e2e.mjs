// ブラウザ検証（T-008〜T-011）。`npm test` には含めない。依存はリポジトリに入れず、グローバルの Playwright を使う。
// 使い方（リポジトリルートで）:
//   1. python3 -m http.server 8000 &      # リポジトリルートを配信する（BASE で配信先を変えられる。既定 http://localhost:8000/app/index.html）
//   2. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e.mjs
//      - Playwright は /opt/node-tools/node_modules のグローバル版（1.56.1）を使う。リポジトリには依存を足さない。`playwright install` は不要。
//      - FAST=1 を付けると、時間のかかるトーストの一時停止の検証（約30秒）を省く。
//      - SHOTS=<dir> を指定すると360幅のスクリーンショットを保存する（目視用。判定には使わない）。
//   3. 終わったらサーバーを止める（kill %1）。
// 終了コード0が合格。360幅・430幅の2回分を実行する（トーストの時間経過の検証は360幅のみ）。
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
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
  createdAt: T0 + Number(id.slice(1)), updatedAt: T0, ...extra,
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

const failures = [];
let checks = 0;
async function check(name, fn) {
  checks++;
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${String(e.message).split('\n').slice(0, 4).join(' / ')}`);
  }
}

const browser = await chromium.launch();
async function newPage(width, seed, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 740 }, deviceScaleFactor: 1, ...ctxOpts });
  const page = await ctx.newPage();
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
const shot = async (page, name, width) => { if (SHOTS && width === 360) await page.waitForTimeout(350); if (SHOTS && width === 360) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const gotoHash = async (page, h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250); };

for (const width of [360, 430]) {
  const tag = `[${width}]`;

  // 1. キャラ選択 -> 再読み込み -> 最近使ったキャラ
  {
    const page = await newPage(width);
    await check(`${tag} 1 初回は案内文とグリッド32件`, async () => {
      assert.equal(await page.locator('.cell').count(), 32);
      assert.match(await page.locator('.bottombar').innerText(), /キャラクターを選ぶと記録を始められます/);
      assert.equal(await page.locator('.cell-n').count(), 0); // 0件は件数を出さない
      assert.ok(await noHScroll(page));
    });
    await shot(page, '01-home-first', width);
    for (const n of ['リュウ', '春麗', 'ケン', 'ガイル']) {
      await page.locator('.cell', { hasText: n }).click();
      await page.waitForFunction((t) => location.hash.startsWith('#/c/') && document.querySelector('.topbar h1')?.textContent.endsWith(t), n); // h1は「RYU」（装飾）＋カナ
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
    await check(`${tag} 2 保存失敗でその場にエラーが出て、メモリ上の状態は保たれる`, async () => {
      const t = await page.locator('.err').innerText();
      assert.match(t, /保存できませんでした/);
      assert.match(t, /保存領域がいっぱいです。入力内容はこの画面に残っています。/);
      assert.deepEqual(await names(page), ['通常', '画面端', '起き攻め', 'スタン']);
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
      assert.deepEqual(await names(page), ['通常', '画面端', 'スタン']);
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
      await bad.locator('.cell', { hasText: 'リュウ' }).click();
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
    await check(`${tag} 4 ホームの件数表示`, async () => assert.match(await page.locator('.cell', { hasText: 'リュウ' }).innerText(), /3件/));
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
    await check(`${tag} 7 非quotaの保存失敗（SecurityError）は別の文言で、メモリは保たれる`, async () => {
      await denied.waitForSelector('.err');
      const t = await denied.locator('.err').innerText();
      assert.match(t, /ブラウザが保存を許可していません。変更はこの画面にだけ残っています。/);
      assert.doesNotMatch(t, /保存領域がいっぱい/);
      assert.equal((await names(denied)).includes('スタン'), true);
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
    const chips = () => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label')));
    const aria = (name) => page.getByRole('button', { name, exact: true });
    const radio = (name) => page.getByRole('radio', { name, exact: true });
    let clicks = 0;
    const tap = async (loc) => { clicks++; await loc.click(); };
    const checked = (name) => radio(name).getAttribute('aria-checked');
    const rowDom = () => page.$eval('.cmd .row', (r) => {
      const c = r.cloneNode(true);
      c.querySelectorAll('.cursor, .pending, .to-end, .cmd-hint').forEach((x) => x.remove()); // 編集だけにある挿入カーソル等
      return c.outerHTML;
    });

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
      await page.waitForFunction(() => document.getElementById('live').textContent === '追加: 波動 ↓↘→ 強P');
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
      const after = await page.$eval('.d-cmd .row', (r) => r.outerHTML);
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
    const chips = () => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label')));
    const aria = (name) => page.getByRole('button', { name, exact: true });
    const radio = (name) => page.getByRole('radio', { name, exact: true });
    const toastText = () => page.locator('#toast').innerText();

    // 下書き: 保存せずに離れて戻ると復元される
    await gotoHash(page, '#/c/ryu/new?s=s1');
    await check(`${tag} 13 直近の技: 最新順・重複なし・注記なし`, async () => {
      assert.deepEqual(await page.$$eval('.recent-keys .key', (els) => els.map((e) => e.getAttribute('aria-label'))),
        ['SA3を追加', '昇龍 →↓↘ 中Pを追加', '波動 ↓↘→ 強Pを追加', '屈中Kを追加', 'CDRを追加']);
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
    const chips = () => page.$$eval('.cmd .chip', (els) => els.map((e) => e.getAttribute('aria-label')));
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
      assert.match(await pop.locator('.pop-note').innerText(), /＝ 236（波動）/);
      assert.deepEqual(await pop.locator('.pop-row').first().locator('button').allInnerTexts(), ['弱', '中', '強', 'OD']);
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
      assert.equal(await pop.locator('.pop-note').count(), 0);
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
      assert.equal(c.createdAt, T0 + 1);
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
    await check(`${tag} 15 パッドの上端は y>=372、高さは368、横スクロールなし`, async () => {
      const b = await page.locator('.pad').boundingBox();
      assert.ok(b.y >= 372, JSON.stringify(b));
      assert.equal(b.height, 368);
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
      assert.ok(r.fieldsTop >= r.padTop + 368 - 1, JSON.stringify(r));
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
      assert.equal(await page.getByRole('button', { name: '凡例' }).count(), 1);
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
    await page.getByRole('button', { name: '凡例' }).click();
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
    await page.getByRole('button', { name: '凡例' }).click();
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
    await check(`${tag} 16 削除: 一覧へ移り、トースト「『タイトル』を削除しました［元に戻す］」`, async () => {
      await page.waitForSelector('.sheet', { state: 'detached' });
      await page.waitForFunction(() => location.hash === '#/c/ryu');
      assert.match(await page.locator('#toast').innerText(), /『基本コンボのコピー』を削除しました/);
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
      assert.match(await p2.locator('#toast').innerText(), /『長いコンボ』を削除しました/);
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
      assert.equal(await page.getByRole('button', { name: '凡例' }).count(), 1);
    });
    await page.getByRole('button', { name: '凡例' }).click();
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
      assert.equal(await page.locator('.cell-n').first().innerText(), '4件');
    });
    await check(`${tag} 17a 点灯と消灯の色: 点灯は板key・英字lit+発光、消灯は板surface・英字muted・発光なし`, async () => {
      const f = (sel) => page.$eval(sel, (e) => { const b = getComputedStyle(e, '::before'); const t = getComputedStyle(e.querySelector('.cell-en')); return [b.backgroundColor, t.color, t.textShadow !== 'none']; });
      assert.deepEqual(await f('.cell.lit'), ['rgb(34, 37, 42)', 'rgb(255, 244, 222)', true]);
      assert.deepEqual(await f('.cell:not(.lit)'), ['rgb(23, 25, 28)', 'rgb(170, 166, 157)', false]);
    });
    await check(`${tag} 17a タイルの押下は即時（板はline、英字は点灯）、離すと戻る`, async () => {
      const t = page.locator('.cell:not(.lit)').first();
      const bb = await t.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      const down = await t.evaluate((e) => [getComputedStyle(e, '::before').backgroundColor, getComputedStyle(e.querySelector('.cell-en')).color, getComputedStyle(e.querySelector('.cell-en')).textShadow !== 'none', getComputedStyle(e, '::before').transitionDuration]);
      await page.mouse.move(0, 0); // 離す前に外へ出してタップにしない
      await page.mouse.up();
      assert.deepEqual(down, ['rgb(46, 50, 56)', 'rgb(255, 244, 222)', true, '0s']);
    });
    await check(`${tag} 17a 英字の名前がタイル内に収まる（scrollWidth <= clientWidth）`, async () => {
      const over = await page.$$eval('.cell-en', (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
      assert.deepEqual(over, []);
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
    await page.getByRole('button', { name: '凡例' }).click();
    await check(`${tag} 17a 凡例: システム技は種別ごとの行、L寸法の見た目、ODと注記の説明`, async () => {
      await page.waitForSelector('.sheet.tall');
      const t = await page.locator('.leg').innerText();
      for (const w of ['緑の枠と»', '角を切った銀の板', '紺の二重枠', '白い枠', '橙の●2つ（重ねて表示）', '斜めの小さな板']) assert.ok(t.includes(w), w);
      assert.equal(await page.locator('.leg .sys-dr').count(), 2);
      assert.equal(await page.locator('.leg .row:not(.S) .sys').count(), 8); // CDR・生ラッシュ・DI・DP・Dリバ・SA1〜3
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
      assert.equal(r.recW, width - 12 - 4 - 64); // 直近の列の見える幅（360pxで280px）
      assert.deepEqual([r.ic, r.rot, r.t], [[16, 16], 'rotate(90deg)', ['完了', '14px', '700']]);
      assert.deepEqual([r.label, r.ctl, r.padId, r.tabindex, r.tag, r.glow], ['パッドを閉じて項目の入力へ', 'pad', 'pad', '-1', 'BUTTON', 'none']);
      assert.equal(await page.locator('.pad-dock').isVisible(), false); // パッドが出ている間は格納バーなし
    });
    await check(`${tag} 17b 直近の技が空でも［完了］は右端に残る（案内文は残り幅）`, async () => {
      const q = await newPage(width, { sections: [sec('s1', 'ryu', '通常', 0)], combos: [] });
      await gotoHash(q, '#/c/ryu/new?s=s1');
      const r = await q.evaluate(() => [document.querySelector('.r1 .recent-empty').getBoundingClientRect().width, document.querySelector('.r1 .done').getBoundingClientRect().width]);
      assert.deepEqual(r, [width - 12 - 4 - 64, 64]);
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
    await check(`${tag} 17b 格納バーの［▴ 技を入力］: パッドが戻り、フォーカスは section.pad。寸法は368・y>=372のまま`, async () => {
      assert.equal(await padVisible(page), true);
      assert.equal(await dockVisible(page), false);
      assert.equal(await active(page), 'section#pad');
      const b = await page.locator('.pad').boundingBox();
      assert.ok(b.y >= 372 && b.height === 368, JSON.stringify(b));
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

await browser.close();
console.log(`e2e: ${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log(failures.map((f) => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
