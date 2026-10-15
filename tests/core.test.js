import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTERS, PRESETS, applyPadInput, initialPadState, isValidToken, tokenLabel, describeRow, motionToArrows,
  validateDoc, parseDocText, exportDoc, mergeImport,
} from '../app/core.js';

// requirements.md 4.5 のスラッグ順
const SLUGS = 'ryu, luke, jamie, chunli, guile, kimberly, juri, ken, blanka, dhalsim, ehonda, deejay, manon, marisa, jp, zangief, lily, cammy, rashid, aki, ed, gouki_akuma, vega_mbison, terry, mai, elena, sagat, cviper, alex, ingrid, yasmine, arjun'.split(', ');

test('キャラクターマスタは32件', () => {
  assert.equal(CHARACTERS.length, 32);
});

test('idは非空で重複しない', () => {
  assert.ok(CHARACTERS.every((c) => typeof c.id === 'string' && c.id !== ''));
  assert.equal(new Set(CHARACTERS.map((c) => c.id)).size, CHARACTERS.length);
});

test('表示名は非空', () => {
  assert.ok(CHARACTERS.every((c) => typeof c.name === 'string' && c.name !== ''));
});

test('idの並びが4.5のスラッグ順と一致する', () => {
  assert.deepEqual(CHARACTERS.map((c) => c.id), SLUGS);
});

// ===== パッド入力（T-006） =====
const run = (actions, state = initialPadState()) => actions.reduce(applyPadInput, state);
const btn = (str, key) => ({ type: 'button', str, key });
const stance = (value) => ({ type: 'stance', value });
const preset = (value) => ({ type: 'preset', value });
const dir = (value) => ({ type: 'dir', value });
const N = (stance, str, key, d) => ({ type: 'normal', stance, ...(d && { dir: d }), key, str });

test('検算「屈中K▶236強P▶CDR▶屈中K▶236強P」を9タップで入力できる', () => {
  const taps = [
    stance('crouch'), btn('M', 'K'), preset('236'), btn('H', 'P'), { type: 'system', id: 'CDR' },
    stance('crouch'), btn('M', 'K'), preset('236'), btn('H', 'P'),
  ];
  assert.equal(taps.length, 9);
  const s = run(taps);
  const sp = { type: 'special', motion: '236', key: 'P', str: 'H' };
  assert.deepEqual(s.tokens, [N('crouch', 'M', 'K'), sp, { type: 'system', id: 'CDR' }, N('crouch', 'M', 'K'), sp]);
  assert.equal(s.cursor, 5);
  assert.ok(s.tokens.every(isValidToken));
  assert.deepEqual(
    describeRow(s.tokens).filter((d) => d.kind === 'group').map((d) => d.label),
    ['屈中K', '波動 ↓↘→ 強P', 'CDR', '屈中K', '波動 ↓↘→ 強P'],
  );
});

test('姿勢は1回限りで、同じ姿勢の再押下で解除される', () => {
  const s = run([stance('crouch'), btn('L', 'P'), btn('L', 'P')]);
  assert.deepEqual(s.tokens, [N('crouch', 'L', 'P'), N('stand', 'L', 'P')]);
  assert.equal(run([stance('jump'), stance('jump')]).pending.stance, 'stand');
});

test('↓の後のモーションで↓は破棄、Jの後のモーションはジャンプ必殺技', () => {
  assert.deepEqual(run([stance('crouch'), preset('623'), btn('H', 'P')]).tokens,
    [{ type: 'special', motion: '623', key: 'P', str: 'H' }]);
  assert.deepEqual(run([stance('jump'), preset('214'), btn('M', 'K')]).tokens,
    [{ type: 'special', motion: '214', key: 'K', str: 'M', stance: 'jump' }]);
});

test('プリセットは方向列を置換し、方向キーは追記する', () => {
  assert.deepEqual(run([dir(6), dir(3), preset('236')]).pending.dirs, ['236']);
  assert.deepEqual(run([preset('236'), dir(6)]).pending.dirs, ['236', '6']);
  assert.deepEqual(run([preset('[4]6'), dir(4)]).pending.dirs, ['[4]6', '4']);
  assert.deepEqual(run([preset('360'), dir(6)]).pending.dirs, ['6']);
});

test('方向6,3,2+ボタンは motion "632" の必殺技（プリセット外も受け入れる）', () => {
  const s = run([dir(6), dir(3), dir(2), btn('H', 'P')]);
  assert.deepEqual(s.tokens, [{ type: 'special', motion: '632', key: 'P', str: 'H' }]);
  assert.ok(isValidToken(s.tokens[0]));
});

test('溜め入力・360・63214のプリセットは全て有効な必殺技になる', () => {
  for (const p of PRESETS) {
    const t = run([preset(p), btn('M', 'P')]).tokens[0];
    assert.equal(t.motion, p);
    assert.ok(isValidToken(t), p);
  }
});

test('方向4+ボタンは引き通常技、2+ボタンはしゃがみ、5は修飾なし', () => {
  assert.deepEqual(run([dir(4), btn('H', 'P')]).tokens, [N('stand', 'H', 'P', 4)]);
  assert.deepEqual(run([dir(2), btn('M', 'K')]).tokens, [N('crouch', 'M', 'K')]);
  assert.deepEqual(run([dir(5), btn('M', 'K')]).tokens, [N('stand', 'M', 'K')]);
  assert.equal(tokenLabel(N('stand', 'H', 'P', 4)), '引き強P');
});

test('OD: モーションがあれば確定、なければ変更なしで通知', () => {
  const s = run([preset('236'), btn('OD', 'P')]);
  assert.deepEqual(s.tokens, [{ type: 'special', motion: '236', key: 'P', str: 'OD' }]);
  assert.equal(tokenLabel(s.tokens[0], 'numpad'), 'OD 波動 236 P');
  const before = run([stance('crouch'), dir(6)]);
  const after = applyPadInput(before, btn('OD', 'K'));
  assert.equal(after.notice, '先にモーションを選んでください');
  assert.deepEqual({ ...after, notice: null }, before);
  assert.equal(applyPadInput(after, dir(4)).notice, null);
  assert.equal(run([btn('OD', 'P')]).tokens.length, 0);
});

test('取り消し: pendingがあれば1段戻し、なければカーソル直前のトークンを削除', () => {
  let s = run([stance('crouch'), preset('236')]);
  s = applyPadInput(s, { type: 'undo' });
  assert.deepEqual(s.pending, { stance: 'stand', dirs: [] }); // ↓はモーション選択時に破棄済み
  s = run([dir(6), dir(3), { type: 'undo' }]);
  assert.deepEqual(s.pending.dirs, ['6']);
  s = run([stance('jump'), { type: 'undo' }]);
  assert.equal(s.pending.stance, 'stand');
  s = run([btn('L', 'P'), btn('M', 'P'), dir(6), { type: 'undo' }, { type: 'undo' }]);
  assert.deepEqual(s.tokens, [N('stand', 'L', 'P')]);
  assert.equal(s.cursor, 1);
  assert.equal(run([{ type: 'undo' }]).tokens.length, 0);
});

test('ボタン以外はpendingを破棄して追加する', () => {
  const s = run([stance('crouch'), dir(6), { type: 'system', id: 'DI' }, { type: 'sa', level: 3 }, { type: 'note', id: 'CH' }]);
  assert.deepEqual(s.tokens, [{ type: 'system', id: 'DI' }, { type: 'sa', level: 3 }, { type: 'note', id: 'CH' }]);
  assert.deepEqual(s.pending, { stance: 'stand', dirs: [] });
  const recent = { type: 'special', motion: '236', key: 'P', str: 'L' };
  const r = run([dir(6), { type: 'recent', token: recent }]);
  assert.deepEqual(r.tokens, [recent]);
  assert.notEqual(r.tokens[0], recent); // 複製される
});

test('挿入カーソル位置への挿入とカーソルの移動', () => {
  let s = run([btn('L', 'P'), btn('M', 'P'), { type: 'cursor', index: 1 }, btn('H', 'K')]);
  assert.deepEqual(s.tokens.map((t) => t.str + t.key), ['LP', 'HK', 'MP']);
  assert.equal(s.cursor, 2);
  s = applyPadInput(s, { type: 'undo' });
  assert.deepEqual(s.tokens.map((t) => t.str + t.key), ['LP', 'MP']);
  assert.equal(s.cursor, 1);
  assert.equal(applyPadInput(s, { type: 'cursor', index: 99 }).cursor, 2);
  assert.equal(applyPadInput(s, { type: 'cursor', index: -1 }).cursor, 0);
});

test('applyPadInputは入力のstateを変更しない', () => {
  const s0 = run([btn('L', 'P'), dir(6)]);
  const snap = structuredClone(s0);
  for (const a of [btn('H', 'K'), dir(3), preset('236'), stance('jump'), { type: 'undo' }, { type: 'note', id: 'PC' }, btn('OD', 'P')]) {
    applyPadInput(s0, a);
    assert.deepEqual(s0, snap);
  }
});

test('不正なactionは例外', () => {
  assert.throws(() => applyPadInput(initialPadState(), { type: 'preset', value: '41236' }));
  assert.throws(() => applyPadInput(initialPadState(), { type: 'nope' }));
  assert.throws(() => applyPadInput(initialPadState(), btn('L', 'X')));
});

test('motionToArrows と tokenLabel（arrow/numpad）', () => {
  assert.deepEqual(motionToArrows('236').map((a) => a.arrow).join(''), '↓↘→');
  assert.deepEqual(motionToArrows('[4]6'), [{ dir: '4', arrow: '←', charge: true }, { dir: '6', arrow: '→', charge: false }]);
  assert.equal(motionToArrows('360').length, 1);
  const sp = { type: 'special', motion: '236', key: 'P', str: 'H' };
  assert.equal(tokenLabel(sp, 'numpad'), '波動 236 強P');
  assert.equal(tokenLabel(sp, 'arrow'), '波動 ↓↘→ 強P');
  assert.equal(tokenLabel({ ...sp, motion: '[4]6', stance: 'jump' }, 'arrow'), 'ジャンプ 溜め横 [←]→ 強P');
  assert.equal(tokenLabel(N('stand', 'H', 'P')), '立ち強P');
  assert.equal(tokenLabel({ type: 'sa', level: 2 }), 'SA2');
});

test('describeRow: ▶は行動同士の間だけで、注記の前後には入らない', () => {
  const T = [
    { type: 'note', id: 'PC' },
    N('crouch', 'M', 'K'),
    { type: 'note', id: 'CH' },
    { type: 'special', motion: '236', key: 'P', str: 'H' },
    { type: 'sa', level: 3 },
    { type: 'note', id: 'CH' },
  ];
  const row = describeRow(T, 'numpad');
  assert.deepEqual(row.map((d) => d.kind), ['group', 'conn', 'group', 'conn', 'group', 'group']);
  assert.deepEqual(row[0].notes, [{ id: 'PC', index: 0 }]); // 先頭の注記は最初の技に付く
  assert.deepEqual(row[2].notes, [{ id: 'CH', index: 2 }]);
  assert.equal(row[2].label, '波動 236 強P');
  assert.equal(row[5].token, null); // 末尾の行動なし注記
  assert.deepEqual(describeRow([]), []);
  assert.deepEqual(describeRow([{ type: 'note', id: 'CH' }]).map((d) => d.kind), ['group']);
});

// ===== 文書の検証と取り込み（T-005） =====
const T0 = 1_700_000_000_000;
const sampleState = () => ({
  sections: [
    { id: 's1', characterId: 'ryu', name: '通常', order: 0, updatedAt: T0 },
    { id: 's2', characterId: 'ken', name: '画面端', order: 0, updatedAt: T0 },
  ],
  combos: [
    {
      id: 'c1', characterId: 'ryu', controlType: 'classic', sectionId: 's1', title: '基本', position: 'any',
      tokens: [N('crouch', 'M', 'K'), { type: 'special', motion: '236', key: 'P', str: 'H' }, { type: 'system', id: 'CDR' },
        { type: 'note', id: 'CH' }, { type: 'sa', level: 3 }, N('stand', 'H', 'P', 4),
        { type: 'special', motion: '[4]6', key: 'K', str: 'OD', stance: 'jump' }],
      memo: 'メモ', tags: ['画面端限定'], favorite: false, createdAt: T0, updatedAt: T0,
    },
    {
      id: 'c2', characterId: 'ken', controlType: 'classic', sectionId: 's2', title: '', position: 'corner',
      tokens: [], memo: '', tags: [], favorite: true, createdAt: T0, updatedAt: T0,
    },
  ],
});
const sampleDoc = () => exportDoc(sampleState());

test('validateDocは正しい見本を通す', () => {
  assert.deepEqual(validateDoc(sampleDoc()), { ok: true });
  assert.deepEqual(validateDoc(exportDoc({ sections: [], combos: [] })), { ok: true });
  assert.deepEqual(parseDocText(JSON.stringify(sampleDoc())), { ok: true, doc: sampleDoc() });
});

test('validateDocは不正な文書を例外なしで拒否し、日本語の理由を返す', () => {
  const mut = (f) => { const d = sampleDoc(); f(d); return d; };
  const cases = {
    JSONの値がnull: null,
    app不一致: mut((d) => { d.app = 'other'; }),
    schemaVersion欠落: mut((d) => { delete d.schemaVersion; }),
    schemaVersion非整数: mut((d) => { d.schemaVersion = 1.5; }),
    schemaVersionが新しすぎる: mut((d) => { d.schemaVersion = 2; }),
    未知のtoken型: mut((d) => { d.combos[0].tokens.push({ type: 'throw' }); }),
    normalにOD: mut((d) => { d.combos[0].tokens[0].str = 'OD'; }),
    dirが2: mut((d) => { d.combos[0].tokens.push(N('stand', 'L', 'P', 2)); }),
    存在しないsectionId: mut((d) => { d.combos[0].sectionId = 'zzz'; }),
    別キャラのセクション: mut((d) => { d.combos[0].sectionId = 's2'; }),
    未知のキャラ: mut((d) => { d.combos[0].characterId = 'nobody'; }),
    combos_id重複: mut((d) => { d.combos[1].id = 'c1'; }),
    sections_id重複: mut((d) => { d.sections[1].id = 's1'; }),
    specialのstanceがcrouch: mut((d) => { d.combos[0].tokens[1].stance = 'crouch'; }),
    motion不正: mut((d) => { d.combos[0].tokens[1].motion = '2'; }),
    positionが不正: mut((d) => { d.combos[0].position = 'left'; }),
    controlTypeがmodern: mut((d) => { d.combos[0].controlType = 'modern'; }),
    tagsが文字列配列でない: mut((d) => { d.combos[0].tags = [1]; }),
    favoriteが真偽値でない: mut((d) => { d.combos[0].favorite = 'yes'; }),
    titleが長すぎる: mut((d) => { d.combos[0].title = 'a'.repeat(101); }),
    配列でない: [],
  };
  for (const [name, doc] of Object.entries(cases)) {
    const r = validateDoc(doc);
    assert.equal(r.ok, false, name);
    assert.match(r.reason, /\S/, name);
    assert.ok(!r.reason.includes('\n'), name);
  }
  assert.equal(validateDoc(cases.未知のtoken型).reason, '1件目のcombosのtokensが不正です');
  assert.equal(parseDocText('{oops').reason, 'JSONとして読めません');
  assert.equal(parseDocText('').ok, false);
  assert.equal(parseDocText('5').ok, false);
  assert.equal(parseDocText(JSON.stringify(cases.app不一致)).ok, false);
});

test('mergeImport: 追加・更新・同時刻は端末側・端末のみは残る', () => {
  const local = sampleState();
  const incoming = sampleDoc();
  incoming.combos[0].title = '取り込み側(同時刻)'; // 同時刻 -> 端末側
  incoming.combos[1].title = '取り込み側(新しい)';
  incoming.combos[1].updatedAt = T0 + 1; // 更新
  incoming.combos.push({ ...structuredClone(incoming.combos[0]), id: 'c3' }); // 追加
  incoming.sections = incoming.sections.slice(0, 1); // s2 は端末のみ
  incoming.sections[0].name = '古い'; incoming.sections[0].updatedAt = T0 - 1;
  const lSnap = structuredClone(local);
  const iSnap = structuredClone(incoming);
  const r = mergeImport(local, incoming);
  assert.deepEqual(local, lSnap);
  assert.deepEqual(incoming, iSnap);
  assert.deepEqual({ a: r.added, u: r.updated, n: r.unchanged }, { a: 1, u: 1, n: 2 }); // n: s1(古い) と c1(同時刻)
  assert.equal(r.doc.combos.find((c) => c.id === 'c1').title, '基本');
  assert.equal(r.doc.combos.find((c) => c.id === 'c2').title, '取り込み側(新しい)');
  assert.deepEqual(r.doc.combos.map((c) => c.id), ['c1', 'c2', 'c3']);
  assert.deepEqual(r.doc.sections, lSnap.sections); // s1は端末が新しい、s2は端末のみ
  r.doc.combos[0].tokens.pop(); // 結果は入力とメモリを共有しない
  assert.deepEqual(local, lSnap);
  assert.deepEqual(validateDoc(exportDoc(r.doc)), { ok: true });
});

test('往復: mergeImport(空, exportDoc(state)) は state と一致する', () => {
  const state = sampleState();
  const r = mergeImport({ sections: [], combos: [] }, JSON.parse(JSON.stringify(exportDoc(state))));
  assert.deepEqual(r.doc, state);
  assert.deepEqual({ a: r.added, u: r.updated, n: r.unchanged }, { a: 4, u: 0, n: 0 });
  const again = mergeImport(r.doc, exportDoc(state));
  assert.deepEqual(again.doc, state);
  assert.deepEqual({ a: again.added, u: again.updated, n: again.unchanged }, { a: 0, u: 0, n: 4 });
});
