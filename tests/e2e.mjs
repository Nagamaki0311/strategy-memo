// ブラウザ検証（T-008・T-009）。`npm test` には含めない。依存はリポジトリに入れず、グローバルの Playwright を使う。
// 使い方（リポジトリルートで）:
//   1. python3 -m http.server 8000 &      # リポジトリルートを配信する（BASE で配信先を変えられる。既定 http://localhost:8000/app/index.html）
//   2. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e.mjs
//      - Playwright は /opt/node-tools/node_modules のグローバル版（1.56.1）を使う。リポジトリには依存を足さない。`playwright install` は不要。
//      - SHOTS=<dir> を指定すると360幅のスクリーンショットを保存する（目視用。判定には使わない）。
//   3. 終わったらサーバーを止める（kill %1）。
// 終了コード0が合格。360幅・430幅の2回分を実行する（トーストの時間経過の検証は360幅のみ）。
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { exportDoc } from '../app/core.js';

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
async function newPage(width, seed) {
  const ctx = await browser.newContext({ viewport: { width, height: 740 }, deviceScaleFactor: 1 });
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
      await page.waitForFunction((t) => location.hash.startsWith('#/c/') && document.querySelector('.topbar h1')?.textContent === t, n);
      await page.getByRole('button', { name: 'キャラクター選択に戻る' }).click();
      await page.waitForSelector('.grid');
    }
    await page.reload();
    await check(`${tag} 1 再読み込み後、最近使ったキャラが新しい順で最大3件`, async () => {
      assert.deepEqual(await page.locator('.recent-list a').allInnerTexts(), ['ガイル', 'ケン', '春麗']);
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
    await check(`${tag} 4 行タップで詳細プレースホルダーへ`, async () => {
      assert.equal(await hash(page), '#/c/ryu/r/c1');
      assert.match(await page.locator('.placeholder').innerText(), /次のタスクで実装します/);
    });
    await shot(page, '14-detail-placeholder', width);
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
    await check(`${tag} 4 ＋記録のプレースホルダー（セクション名）と編集・設定のルート`, async () => {
      assert.match(await page.locator('.placeholder').innerText(), /セクション: 通常/);
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

  // 11. トーストの一時停止（時間がかかるので360幅のみ）
  if (width === 360) {
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

  // 5. 横スクロールなし（各画面）
  {
    const page = await newPage(width, seedState());
    for (const h of ['#/', '#/c/ryu', '#/c/ehonda', '#/c/ryu/r/c1', '#/settings']) {
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
