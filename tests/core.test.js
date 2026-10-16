import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTERS, PRESETS, NOTICE_TOO_LONG, applyPadInput, initialPadState, pendingMotion, isMotion, isValidToken, tokenLabel, describeRow, motionToArrows,
  validateDoc, parseDocText, exportDoc, mergeImport,
  SECTION_PRESETS, newId, isTime, addSection, renameSection, moveSection, deleteSection, sectionsOf,
  LIMITS, strengthChoices, changeStrength, recentTokens, tagCandidates, duplicateCombo, sanitizeDraft, isDamage, DAMAGE_MAX,
  exportFilename, dateText, daysSince, snoozeUntil, shouldRemindExport, NEON_STEPS, neonLevel,
  specialNames, specialCandidates, specialLabel, candidateLabel, hasSpecials,
  SPECIAL_NOTATIONS, DEFAULT_SPECIAL_NOTATION, sanitizeSpecialNotation,
} from '../app/core.js';
import { SPECIALS } from '../app/specials.js';
import { readFileSync } from 'node:fs';

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

test('英字名enは非空で、使える字（A-Z . - 空白）だけ。例外表記はGOUKI・VEGA（design-spec-v2 2.4）', () => {
  assert.ok(CHARACTERS.every((c) => /^[A-Z][A-Z .-]*$/.test(c.en)), '英字の形式');
  const en = Object.fromEntries(CHARACTERS.map((c) => [c.id, c.en]));
  assert.deepEqual([en.gouki_akuma, en.vega_mbison, en.chunli, en.deejay, en.ehonda, en.aki, en.cviper], ['GOUKI', 'VEGA', 'CHUN-LI', 'DEE JAY', 'E.HONDA', 'A.K.I.', 'C.VIPER']);
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
  assert.deepEqual(s.pending, { stance: 'crouch', dirs: [] }); // 直前のpendingへ戻る（M1）
  s = applyPadInput(s, { type: 'undo' });
  assert.deepEqual(s.pending, { stance: 'stand', dirs: [] });
  s = run([stance('crouch'), dir(6), dir(3), { type: 'undo' }]);
  assert.deepEqual(s.pending, { stance: 'crouch', dirs: ['6'] });
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
  assert.equal(applyPadInput(s, { type: 'cursor', index: 2 }).cursor, 2);
  assert.equal(applyPadInput(s, { type: 'cursor', index: 0 }).cursor, 0);
  for (const index of [-1, 3, 1.5, NaN, '1', null, undefined]) {
    assert.throws(() => applyPadInput(s, { type: 'cursor', index }), /不正なカーソル位置/, String(index));
  }
});

test('crouch/jumpは方向キー入力でも保持され、確定時に反映される', () => {
  const crouchMotion = run([stance('crouch'), dir(6), dir(3), btn('H', 'P')]);
  assert.deepEqual(crouchMotion.tokens, [{ type: 'special', motion: '63', key: 'P', str: 'H' }]);
  assert.deepEqual(run([stance('crouch'), dir(6), btn('H', 'P')]).tokens, [N('crouch', 'H', 'P', 6)]);
  assert.deepEqual(run([stance('jump'), dir(6), btn('H', 'P')]).tokens, [N('jump', 'H', 'P', 6)]);
  assert.deepEqual(run([stance('jump'), dir(2), btn('H', 'P')]).tokens, [N('jump', 'H', 'P')]);
  assert.deepEqual(run([stance('jump'), dir(6), dir(3), btn('H', 'P')]).tokens,
    [{ type: 'special', motion: '63', key: 'P', str: 'H', stance: 'jump' }]);
});

test('方向キーはモーション20文字までで、超える入力は無視して通知する', () => {
  const s20 = run(Array.from({ length: 20 }, () => dir(6)));
  assert.equal(pendingMotion(s20.pending).length, 20);
  assert.equal(s20.notice, null);
  const over = applyPadInput(s20, dir(6));
  assert.equal(over.notice, NOTICE_TOO_LONG);
  assert.deepEqual(over.pending, s20.pending);
  const t = applyPadInput(s20, btn('H', 'P')).tokens[0];
  assert.ok(isValidToken(t)); // 20文字ちょうどは保存できる
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
  for (const bad of [null, undefined, 5, 'undo', []]) {
    assert.throws(() => applyPadInput(initialPadState(), bad), /不正なactionです/, String(bad));
  }
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

test('validateDocは不正な文書を例外なしで拒否し、意図した理由を返す', () => {
  const mut = (f) => { const d = sampleDoc(); f(d); return d; };
  const badTokens = (...t) => mut((d) => { d.combos[0].tokens.push(...t); });
  // [名前, 文書, reasonの部分一致]
  const cases = [
    ['JSONの値がnull', null, '文書がオブジェクト'],
    ['配列', [], '文書がオブジェクト'],
    ['app不一致', mut((d) => { d.app = 'other'; }), 'appが一致しません'],
    ['schemaVersion欠落', mut((d) => { delete d.schemaVersion; }), 'schemaVersionがありません'],
    ['schemaVersion非整数', mut((d) => { d.schemaVersion = 1.5; }), 'schemaVersionが不正'],
    ['schemaVersion数値文字列', mut((d) => { d.schemaVersion = '1'; }), 'schemaVersionが不正'],
    ['schemaVersionが新しすぎる(版3)', mut((d) => { d.schemaVersion = 3; }), '新しい版'],
    ['schemaVersionが0', mut((d) => { d.schemaVersion = 0; }), 'schemaVersionが不正'],
    ['moveのidが未知', badTokens({ type: 'move', id: 'DASH' }), 'tokensが不正'],
    ['moveにキー余り', badTokens({ type: 'move', id: 'FWD_STEP', str: 'N' }), 'tokensが不正'],
    ['強度の値が未知', badTokens({ ...N('stand', 'L', 'P'), str: 'X' }), 'tokensが不正'],
    ['強度の値が未知(NOD)', badTokens({ ...N('stand', 'L', 'P'), str: 'NOD' }), 'tokensが不正'],
    ['sectionsが配列でない', mut((d) => { d.sections = {}; }), 'sectionsが配列ではありません'],
    ['未知のtoken型', badTokens({ type: 'throw' }), '1件目のcombosのtokensが不正です'],
    ['normalにOD', mut((d) => { d.combos[0].tokens[0].str = 'OD'; }), 'tokensが不正'],
    ['dirが2', badTokens(N('stand', 'L', 'P', 2)), 'tokensが不正'],
    ['dirが5', badTokens(N('stand', 'L', 'P', 5)), 'tokensが不正'],
    ['dirが文字列', badTokens(N('stand', 'L', 'P', '4')), 'tokensが不正'],
    ['dirがNaN', badTokens({ ...N('stand', 'L', 'P'), dir: NaN }), 'tokensが不正'],
    ['dirがnull', badTokens({ ...N('stand', 'L', 'P'), dir: null }), 'tokensが不正'],
    ['saのlevelが文字列', badTokens({ type: 'sa', level: '3' }), 'tokensが不正'],
    ['saのlevelが4', badTokens({ type: 'sa', level: 4 }), 'tokensが不正'],
    ['system idが未知', badTokens({ type: 'system', id: 'DR' }), 'tokensが不正'],
    ['note idが未知', badTokens({ type: 'note', id: 'HIT' }), 'tokensが不正'],
    ['specialのstanceがcrouch', mut((d) => { d.combos[0].tokens[1].stance = 'crouch'; }), 'tokensが不正'],
    ['motion不正', mut((d) => { d.combos[0].tokens[1].motion = '2'; }), 'tokensが不正'],
    ['tokenが配列', badTokens([]), 'tokensが不正'],
    ['tokenにキー余り', badTokens({ ...N('stand', 'L', 'P'), extra: 1 }), 'tokensが不正'],
    ['tokens201件', mut((d) => { d.combos[0].tokens = Array.from({ length: 201 }, () => N('stand', 'L', 'P')); }), 'tokensが不正'],
    ['存在しないsectionId', mut((d) => { d.combos[0].sectionId = 'zzz'; }), 'sectionIdが不正'],
    ['別キャラのセクション', mut((d) => { d.combos[0].sectionId = 's2'; }), 'sectionIdが不正'],
    ['未知のキャラ', mut((d) => { d.combos[0].characterId = 'nobody'; }), 'characterIdが不正'],
    ['sectionの未知のキャラ', mut((d) => { d.sections[0].characterId = 'nobody'; }), '1件目のsectionsのcharacterIdが不正'],
    ['combos_id重複', mut((d) => { d.combos[1].id = 'c1'; }), 'combosのidが重複'],
    ['sections_id重複', mut((d) => { d.sections[1].id = 's1'; }), 'sectionsのidが重複'],
    ['positionが不正', mut((d) => { d.combos[0].position = 'left'; }), 'positionが不正'],
    ['controlTypeがmodern', mut((d) => { d.combos[0].controlType = 'modern'; }), 'controlTypeが不正'],
    ['tagsが文字列配列でない', mut((d) => { d.combos[0].tags = [1]; }), 'tagsが不正'],
    ['tagsに空文字', mut((d) => { d.combos[0].tags = ['']; }), 'tagsが不正'],
    ['tags21個', mut((d) => { d.combos[0].tags = Array.from({ length: 21 }, (_, i) => `t${i}`); }), 'tagsが不正'],
    ['tagが31文字', mut((d) => { d.combos[0].tags = ['a'.repeat(31)]; }), 'tagsが不正'],
    ['favoriteが真偽値でない', mut((d) => { d.combos[0].favorite = 'yes'; }), 'favoriteが不正'],
    ['titleが101文字', mut((d) => { d.combos[0].title = 'a'.repeat(101); }), 'titleが不正'],
    ['memoが2001文字', mut((d) => { d.combos[0].memo = 'a'.repeat(2001); }), 'memoが不正'],
    ['memoが2000文字は有効なので別理由で落とす', mut((d) => { d.combos[0].memo = 'a'.repeat(2000); d.combos[0].createdAt = -1; }), 'createdAtが不正'],
    ['updatedAtがNaN', mut((d) => { d.combos[0].updatedAt = NaN; }), 'updatedAtが不正'],
    ['sectionのorderが負', mut((d) => { d.sections[0].order = -1; }), 'orderが不正'],
    ['sectionのnameが空', mut((d) => { d.sections[0].name = ''; }), 'nameが不正'],
    ['sectionのnameが空白のみ', mut((d) => { d.sections[0].name = '  \u3000 '; }), 'nameが不正'],
    ['tagが空白のみ', mut((d) => { d.combos[0].tags = ['   ']; }), 'tagsが不正'],
    ['createdAtがupdatedAtより後', mut((d) => { d.combos[0].createdAt = T0 + 1; }), 'updatedAtが不正'],
    ['updatedAtがDateの最大値超え', mut((d) => { d.combos[0].createdAt = 8.64e15 + 1; d.combos[0].updatedAt = 8.64e15 + 2; }), 'createdAtが不正'],
    ['comboがnull', mut((d) => { d.combos[0] = null; }), '1件目のcombosの形式が不正'],
    ['文書に未知のキー', mut((d) => { d.extra = 1; }), '文書に未対応の項目'],
    ['sectionに未知のキー', mut((d) => { d.sections[1].extra = 1; }), '2件目のsectionsに未対応の項目'],
    ['comboに未知のキー', mut((d) => { d.combos[1].extra = 1; }), '2件目のcombosに未対応の項目'],
    ['idに空文字', mut((d) => { d.combos[1].id = ''; }), 'idが不正'],
    ['idが65文字', mut((d) => { d.combos[1].id = 'a'.repeat(65); }), 'idが不正'],
    ['idにHTML文字', mut((d) => { d.combos[1].id = '<img src=x onerror=alert(1)>'; }), 'idが不正'],
    ['idに改行', mut((d) => { d.combos[1].id = 'c2\n'; }), 'idが不正'],
    ['idが数値', mut((d) => { d.sections[0].id = 1; }), 'idが不正'],
  ];
  for (const [name, doc, expected] of cases) {
    const r = validateDoc(doc);
    assert.equal(r.ok, false, name);
    assert.ok(r.reason.includes(expected), `${name}: ${r.reason}`);
    assert.ok(!r.reason.includes('\n'), name);
  }
  assert.equal(parseDocText('{oops').reason, 'JSONとして読めません');
  assert.equal(parseDocText('').reason, 'JSONとして読めません');
  assert.equal(parseDocText('5').ok, false);
  assert.equal(parseDocText(JSON.stringify(cases[2][1])).ok, false);
});

test('上限ちょうどの値は有効', () => {
  const d = sampleDoc();
  Object.assign(d.combos[0], {
    title: 'a'.repeat(100), memo: 'a'.repeat(2000), tags: Array.from({ length: 20 }, () => 'a'.repeat(30)),
    tokens: Array.from({ length: 200 }, () => N('stand', 'L', 'P')), id: 'A-z_9'.repeat(12) + 'abcd',
  });
  assert.equal(d.combos[0].id.length, 64);
  assert.deepEqual(validateDoc(d), { ok: true });
});

test('reasonに入力の文字列値を埋め込まない（HTML文字・id）', () => {
  const evil = '<script>alert(1)</script>';
  const probes = [
    (d) => { d.combos[0].id = evil; },
    (d) => { d.sections[0].id = evil; },
    (d) => { d.combos[0].sectionId = evil; },
    (d) => { d.combos[0].characterId = evil; },
    (d) => { d.app = evil; },
    (d) => { d.combos[0].title = evil.repeat(10); },
    (d) => { d.combos[0].tags = [evil.repeat(5)]; },
    (d) => { d.extra = evil; },
    (d) => { d.combos[0].tokens.push({ type: evil }); },
    (d) => { d.schemaVersion = evil; },
  ];
  for (const f of probes) {
    const d = sampleDoc();
    f(d);
    const r = validateDoc(d);
    assert.equal(r.ok, false);
    assert.ok(!r.reason.includes('<') && !r.reason.includes('script'), r.reason);
  }
  // 重複idの理由にもidの値を含めない
  const dup = sampleDoc();
  dup.combos[1].id = 'c1';
  assert.ok(!validateDoc(dup).reason.includes('c1'));
});

test('プロトタイプ汚染・深いネストの未知フィールドは拒否される', () => {
  const polluted = `{"app":"sf6-strategy-memo","schemaVersion":1,"sections":[],"combos":[],"__proto__":{"isAdmin":true}}`;
  const r = parseDocText(polluted);
  assert.equal(r.ok, false);
  assert.equal(({}).isAdmin, undefined);
  const inCombo = JSON.parse(JSON.stringify(sampleDoc()).replace('"favorite":false', '"favorite":false,"__proto__":{"x":1}'));
  assert.equal(validateDoc(inCombo).ok, false);

  let nest = '1';
  for (let i = 0; i < 3000; i++) nest = `{"a":${nest}}`;
  const text = JSON.stringify(sampleDoc()).replace('"memo":"メモ"', `"memo":"メモ","deep":${nest}`);
  const deep = parseDocText(text);
  assert.equal(deep.ok, false);
  assert.match(deep.reason, /未対応の項目/);
});

test('isMotionの許可・拒否表', () => {
  for (const m of ['[4]6', '[2]8', '360', '22', '236', '63214', '1'.repeat(20)]) assert.equal(isMotion(m), true, m);
  for (const m of ['1', '[4]', '0', '[0]6', '3600', ' 236', '236\n', '', null, undefined, 236, '1'.repeat(21), '[4]6\n']) {
    assert.equal(isMotion(m), false, String(m));
  }
});

test('mergeImport: 追加・更新・同時刻は端末側・端末のみは残る', () => {
  const local = sampleState();
  local.combos.push({ ...structuredClone(local.combos[0]), id: 'c9', title: '端末のみ' });
  const incoming = sampleDoc();
  incoming.combos[0].title = '取り込み側(同時刻)'; // 同時刻 -> 端末側
  incoming.combos[1].title = '取り込み側(新しい)';
  incoming.combos[1].updatedAt = T0 + 1; // 更新
  incoming.combos.push({ ...structuredClone(incoming.combos[0]), id: 'c3' }); // 追加
  incoming.sections[0].name = '古い'; incoming.sections[0].updatedAt = T0 - 1; // 端末が新しい
  const lSnap = structuredClone(local);
  const iSnap = structuredClone(incoming);
  const r = mergeImport(local, incoming);
  assert.equal(r.ok, true);
  assert.deepEqual(local, lSnap);
  assert.deepEqual(incoming, iSnap);
  // 記録とセクションの内訳は別々に数える。unchanged: s1(古い)・s2(同時刻)、c1(同時刻)
  assert.deepEqual({ c: r.combos, s: r.sections }, { c: { added: 1, updated: 1, unchanged: 1 }, s: { added: 0, updated: 0, unchanged: 2 } });
  assert.equal(r.doc.combos.find((c) => c.id === 'c1').title, '基本');
  assert.equal(r.doc.combos.find((c) => c.id === 'c2').title, '取り込み側(新しい)');
  assert.equal(r.doc.combos.find((c) => c.id === 'c9').title, '端末のみ');
  assert.deepEqual(r.doc.combos.map((c) => c.id), ['c1', 'c2', 'c9', 'c3']);
  assert.deepEqual(r.doc.sections, lSnap.sections);
  r.doc.combos[0].tokens.pop(); // 結果は入力とメモリを共有しない
  assert.deepEqual(local, lSnap);
  assert.deepEqual(validateDoc(exportDoc(r.doc)), { ok: true });
});

test('mergeImport: マージ結果が参照整合を崩す場合は ok:false で拒否する（M3）', () => {
  // 再現1: 同じidのセクションが取り込み側で別キャラに変わり、端末側のコンボが別キャラのセクションを指す
  const local = sampleState();
  const inc1 = sampleDoc();
  inc1.sections[0].characterId = 'luke';
  inc1.sections[0].updatedAt = T0 + 1;
  inc1.combos[0].characterId = 'luke'; // 取り込み側の文書単体は整合している
  inc1.combos[0].createdAt = T0 - 1;
  inc1.combos[0].updatedAt = T0 - 1; // コンボは端末側が残る -> ryuのコンボがlukeのセクションを指す
  assert.deepEqual(validateDoc(inc1), { ok: true });
  const r1 = mergeImport(local, inc1);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /sectionIdが不正/);
  // 再現2: 取り込み側の新しいコンボが、端末側では別キャラのセクションを指す
  const inc2 = sampleDoc();
  inc2.sections[0].characterId = 'luke'; // 同時刻なので端末側(ryu)が残る
  inc2.combos[0].characterId = 'luke';
  inc2.combos[0].updatedAt = T0 + 1; // コンボだけ更新される
  assert.deepEqual(validateDoc(inc2), { ok: true });
  const r2 = mergeImport(local, inc2);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /sectionIdが不正/);
  // 入力は変更されない
  assert.deepEqual(local, sampleState());
});

test('mergeImport: 不正な取り込み文書は拒否する', () => {
  const inc = sampleDoc();
  inc.combos[0].extra = 1;
  const r = mergeImport(sampleState(), inc);
  assert.equal(r.ok, false);
  assert.match(r.reason, /未対応の項目/);
});

test('往復: mergeImport(空, exportDoc(state)) は state と一致する', () => {
  const state = sampleState();
  const r = mergeImport({ sections: [], combos: [] }, JSON.parse(JSON.stringify(exportDoc(state))));
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc, state);
  assert.deepEqual([r.sections, r.combos], [{ added: 2, updated: 0, unchanged: 0 }, { added: 2, updated: 0, unchanged: 0 }]);
  const again = mergeImport(r.doc, exportDoc(state));
  assert.deepEqual(again.doc, state);
  assert.deepEqual([again.sections, again.combos], [{ added: 0, updated: 0, unchanged: 2 }, { added: 0, updated: 0, unchanged: 2 }]);
});

// ===== セクション操作（T-009） =====
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const sec = (id, characterId, order) => ({ id, characterId, name: id, order, updatedAt: T0 });
const combo = (id, characterId, sectionId) => ({ ...structuredClone(sampleState().combos[0]), id, characterId, sectionId });
const valid = (st) => assert.deepEqual(validateDoc(exportDoc(st)), { ok: true });
const orders = (st, cid) => sectionsOf(st, cid).map((s) => `${s.id}:${s.order}`);
// ryu: a0,a1,a2 / ken: k0 / a1 に記録2件、k0 に ken の記録
const secState = () => ({
  sections: [sec('a0', 'ryu', 0), sec('a1', 'ryu', 1), sec('a2', 'ryu', 2), sec('k0', 'ken', 0)],
  combos: [combo('c1', 'ryu', 'a1'), combo('c2', 'ryu', 'a1'), { ...combo('c3', 'ken', 'k0') }],
});

test('セクション候補は仕様の7件', () => {
  assert.deepEqual(SECTION_PRESETS, ['通常', 'カウンター', 'パニッシュカウンター', 'インパクト壁やられ', 'スタン', '画面端', '起き攻め']);
});

test('addSection: 末尾に追加・idは規則どおり・キャラごとにorder・入力は不変', () => {
  const before = secState();
  const snap = structuredClone(before);
  const a = addSection(before, 'ryu', '  新規  ', T0 + 5);
  const b = addSection(a, 'luke', '通常', T0 + 6);
  assert.deepEqual(before, snap);
  valid(a); valid(b);
  const added = a.sections.at(-1);
  assert.match(added.id, ID_OK);
  assert.deepEqual({ ...added, id: 0 }, { id: 0, characterId: 'ryu', name: '新規', order: 3, updatedAt: T0 + 5 });
  assert.equal(b.sections.at(-1).order, 0); // 別キャラは0から
  assert.notEqual(a.sections.at(-1).id, addSection(before, 'ryu', 'x', T0).sections.at(-1).id);
  for (const bad of ['', '   ', 'あ'.repeat(51), null, 7]) assert.throws(() => addSection(before, 'ryu', bad, T0), /1〜50/);
  assert.throws(() => addSection(before, 'nobody', 'x', T0), /キャラクター/);
  assert.equal(addSection(before, 'ryu', 'あ'.repeat(50), T0).sections.length, 5);
});

test('renameSection: 名称とupdatedAtだけ変わる・不正は例外', () => {
  const before = secState();
  const snap = structuredClone(before);
  const r = renameSection(before, 'a1', ' 改名 ', T0 + 1);
  assert.deepEqual(before, snap);
  valid(r);
  assert.deepEqual(r.sections.find((s) => s.id === 'a1'), { id: 'a1', characterId: 'ryu', name: '改名', order: 1, updatedAt: T0 + 1 });
  assert.deepEqual(r.sections.filter((s) => s.id !== 'a1'), snap.sections.filter((s) => s.id !== 'a1'));
  assert.throws(() => renameSection(before, 'a1', '', T0), /1〜50/);
  assert.throws(() => renameSection(before, 'zz', 'x', T0), /見つかりません/);
});

test('moveSection: 同キャラ内で移動し、orderを詰め直す。端は何もしない', () => {
  const before = secState();
  const snap = structuredClone(before);
  const up = moveSection(before, 'a2', -1, T0 + 1);
  assert.deepEqual(before, snap);
  valid(up);
  assert.deepEqual(orders(up, 'ryu'), ['a0:0', 'a2:1', 'a1:2']);
  assert.deepEqual(orders(up, 'ken'), ['k0:0']);
  // 変わったセクションだけ updatedAt が進む
  assert.deepEqual(up.sections.filter((s) => s.updatedAt === T0 + 1).map((s) => s.id).sort(), ['a1', 'a2']);
  assert.deepEqual(orders(moveSection(before, 'a0', 1, T0), 'ryu'), ['a1:0', 'a0:1', 'a2:2']);
  assert.deepEqual(orders(moveSection(before, 'a0', 2, T0), 'ryu'), ['a1:0', 'a2:1', 'a0:2']);
  assert.equal(moveSection(before, 'a0', -1, T0), before); // 先頭の上へ
  assert.equal(moveSection(before, 'a2', 1, T0), before); // 末尾の下へ
  // 欠番があっても詰め直す
  const gap = { ...before, sections: [sec('a0', 'ryu', 0), sec('a1', 'ryu', 5), sec('a2', 'ryu', 9)] };
  assert.deepEqual(orders(moveSection(gap, 'a2', -1, T0), 'ryu'), ['a0:0', 'a2:1', 'a1:2']);
  assert.throws(() => moveSection(before, 'a0', 0.5, T0), /移動量/);
});

test('deleteSection: 空のセクションは即時削除でき、orderを詰める', () => {
  const before = secState();
  const snap = structuredClone(before);
  const r = deleteSection(before, 'a0', null, T0 + 1);
  assert.deepEqual(before, snap);
  assert.equal(r.ok, true);
  valid(r.state);
  assert.deepEqual(orders(r.state, 'ryu'), ['a1:0', 'a2:1']);
  assert.deepEqual(r.state.combos, snap.combos);
  // 他にセクションがなくても、空なら削除できる
  const only = deleteSection(r.state, 'k0', null, T0);
  assert.equal(only.ok, false); // k0 は中身あり（c3）
  const empty = { sections: [sec('x', 'ryu', 0)], combos: [] };
  assert.deepEqual(deleteSection(empty, 'x', null, T0), { ok: true, state: { sections: [], combos: [] } });
});

test('deleteSection: 中身があれば同キャラの移動先が必須。他にセクションがなければ削除不可', () => {
  const before = secState();
  const snap = structuredClone(before);
  assert.deepEqual(deleteSection(before, 'a1', null, T0), { ok: false, reason: '移動先を選んでください' });
  assert.equal(deleteSection(before, 'a1', 'a1', T0).ok, false); // 自分自身
  assert.equal(deleteSection(before, 'a1', 'k0', T0).ok, false); // 別キャラ
  assert.equal(deleteSection(before, 'a1', 'zz', T0).ok, false);
  assert.match(deleteSection(before, 'k0', 'a0', T0).reason, /他にセクションがない/); // ken は k0 のみ
  assert.equal(deleteSection(before, 'nope', null, T0).ok, false);
  assert.deepEqual(before, snap);

  const r = deleteSection(before, 'a1', 'a2', T0 + 9);
  assert.equal(r.ok, true);
  valid(r.state);
  assert.deepEqual(orders(r.state, 'ryu'), ['a0:0', 'a2:1']);
  assert.deepEqual(r.state.combos.map((c) => [c.id, c.sectionId, c.updatedAt]), [['c1', 'a2', T0 + 9], ['c2', 'a2', T0 + 9], ['c3', 'k0', T0]]);
  assert.deepEqual(before, snap);
});

test('方向5のラベルは「ニュートラル」、数字表記は「5」のまま', () => {
  const t = { type: 'special', motion: '2565', key: 'P', str: 'H' };
  assert.equal(tokenLabel(t), '↓ニュートラル→ニュートラル 強P');
  assert.equal(tokenLabel(t, 'numpad'), '2565 強P');
});

test('newId: 32桁の16進でid規則を満たし、衝突しない', () => {
  const ids = Array.from({ length: 2000 }, newId);
  assert.ok(ids.every((id) => /^[0-9a-f]{32}$/.test(id) && ID_OK.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('isTime: 0以上の安全な整数だけ', () => {
  for (const v of [0, 1, T0, 8.64e15]) assert.equal(isTime(v), true);
  for (const v of [-1, 1.5, NaN, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1, 8.64e15 + 1]) assert.equal(isTime(v), false);
});

test('isTime の上限は Date の最大値: 通る値は dateText・exportFilename が NaN にならず、超える値は拒否する', () => {
  for (const t of [0, 8.64e15]) {
    assert.doesNotMatch(dateText(t), /NaN/);
    assert.doesNotMatch(exportFilename(t), /NaN/);
  }
  assert.match(dateText(8.64e15 + 1), /NaN/); // 上限を超えると Invalid Date。isTime が止めている
});

test('セクションは1000件まで: 1001個目を足した state は validateDoc を通らない（commit が保存を拒否する根拠）', () => {
  let st = { sections: [], combos: [] };
  for (let i = 0; i < 1000; i++) st = addSection(st, 'ryu', `s${i}`, T0);
  valid(st);
  const over = addSection(st, 'ryu', 'もう1つ', T0);
  assert.equal(over.sections.length, 1001);
  const r = validateDoc(exportDoc(over));
  assert.equal(r.ok, false);
  assert.match(r.reason, /sectionsが多すぎます/);
});

// ===== 編集画面の補助（T-010・T-011） =====
const SPc = (motion, str, key) => ({ type: 'special', motion, key, str });
const mkCombo = (id, tokens, extra = {}) => ({
  id, characterId: 'ryu', controlType: 'classic', sectionId: 's1', title: 't', position: 'any', tokens, memo: '', tags: [], favorite: false, createdAt: 1, updatedAt: 1, ...extra,
});

test('strengthChoices: 通常技=弱中強＋強度なし、必殺技=さらにOD、SA=1〜3、システム技・注記・移動は空', () => {
  assert.deepEqual(strengthChoices(N('stand', 'M', 'P')), ['L', 'M', 'H', 'N']);
  assert.deepEqual(strengthChoices(SPc('236', 'H', 'P')), ['L', 'M', 'H', 'N', 'OD']);
  assert.deepEqual(strengthChoices({ type: 'move', id: 'FWD_STEP' }), []);
  assert.deepEqual(strengthChoices({ type: 'sa', level: 1 }), [1, 2, 3]);
  assert.deepEqual(strengthChoices({ type: 'system', id: 'CDR' }), []);
  assert.deepEqual(strengthChoices({ type: 'note', id: 'CH' }), []);
});

test('changeStrength: 強度だけ置き換え、元は変えない。結果は常に有効なトークン', () => {
  const t = SPc('236', 'H', 'P');
  const od = changeStrength(t, 'OD');
  assert.deepEqual(od, SPc('236', 'OD', 'P'));
  assert.equal(t.str, 'H');
  assert.ok(isValidToken(od));
  assert.deepEqual(changeStrength({ ...N('crouch', 'M', 'K', 4) }, 'L'), N('crouch', 'L', 'K', 4));
  assert.deepEqual(changeStrength({ type: 'sa', level: 3 }, 1), { type: 'sa', level: 1 });
  assert.throws(() => changeStrength(N('stand', 'M', 'P'), 'OD')); // 通常技にODはない
  assert.throws(() => changeStrength({ type: 'sa', level: 1 }, 'L'));
  assert.throws(() => changeStrength({ type: 'system', id: 'DI' }, 'L'));
});

test('applyPadInput strength: 指定位置だけ置き換える（カーソル・ペンディングは保つ）', () => {
  const s0 = run([stance('crouch'), btn('M', 'K'), preset('236'), btn('H', 'P'), stance('jump')]);
  const s1 = applyPadInput(s0, { type: 'strength', index: 1, value: 'OD' });
  assert.deepEqual(s1.tokens, [N('crouch', 'M', 'K'), SPc('236', 'OD', 'P')]);
  assert.equal(s1.cursor, 2);
  assert.equal(s1.pending.stance, 'jump');
  assert.equal(s0.tokens[1].str, 'H');
  assert.throws(() => applyPadInput(s0, { type: 'strength', index: 2, value: 'L' }));
  assert.throws(() => applyPadInput(s0, { type: 'strength', index: 0, value: 'OD' }));
});

test('applyPadInput remove: 指定位置を消し、カーソルが後ろにあれば1つ詰める', () => {
  const s0 = run([btn('L', 'P'), btn('M', 'P'), btn('H', 'P')]);
  const mid = applyPadInput(s0, { type: 'remove', index: 1 });
  assert.deepEqual(mid.tokens.map((t) => t.str), ['L', 'H']);
  assert.equal(mid.cursor, 2);
  const s1 = applyPadInput(s0, { type: 'cursor', index: 1 });
  assert.equal(applyPadInput(s1, { type: 'remove', index: 2 }).cursor, 1); // カーソルより後ろの削除
  assert.equal(applyPadInput(s1, { type: 'remove', index: 0 }).cursor, 0); // 前の削除
  assert.throws(() => applyPadInput(s0, { type: 'remove', index: 3 }));
  assert.equal(s0.tokens.length, 3);
});

test('recentTokens: 最新の記録の後ろの技から、重複・注記を除いて最大8件。他キャラは含めない', () => {
  const a = mkCombo('a', [N('stand', 'L', 'P'), SPc('236', 'H', 'P'), { type: 'system', id: 'CDR' }], { updatedAt: 5 });
  const b = mkCombo('b', [{ type: 'note', id: 'CH' }, SPc('236', 'H', 'P'), { type: 'sa', level: 3 }], { updatedAt: 9 });
  const other = { ...mkCombo('o', [N('stand', 'H', 'K')], { updatedAt: 99 }), characterId: 'ken' };
  const r = recentTokens([a, b, other], 'ryu');
  assert.deepEqual(r.map((t) => tokenLabel(t)), ['SA3', '波動 ↓↘→ 強P', 'CDR', '立ち弱P']);
  const many = mkCombo('m', [1, 3, 4, 6, 7, 8, 9].flatMap((d) => [N('stand', 'L', 'P', d), N('crouch', 'L', 'P', d)]));
  assert.equal(recentTokens([many], 'ryu').length, 8);
  assert.equal(recentTokens([many], 'ryu', 3).length, 3);
  r[0].level = 1;
  assert.equal(b.tokens[2].level, 3); // 複製を返す
});

test('tagCandidates: そのキャラのタグ（多い順）、続けて他キャラのタグ。重複なし', () => {
  const c = [
    mkCombo('1', [], { tags: ['基本', '画面端'] }), mkCombo('2', [], { tags: ['基本'] }),
    { ...mkCombo('3', [], { tags: ['画面端', '起き攻め'] }), characterId: 'ken' },
  ];
  assert.deepEqual(tagCandidates(c, 'ryu'), ['基本', '画面端', '起き攻め']);
  assert.deepEqual(tagCandidates(c, 'ken'), ['画面端', '起き攻め', '基本']);
  assert.deepEqual(tagCandidates([], 'ryu'), []);
});

test('duplicateCombo: 新しいid・日時、同じセクション、タイトルは「のコピー」。上限を超えない', () => {
  const src = mkCombo('src', [SPc('236', 'H', 'P')], { title: '基本', tags: ['x'], createdAt: 1, updatedAt: 2 });
  const d = duplicateCombo(src, 777);
  assert.notEqual(d.id, 'src');
  assert.equal(d.title, '基本のコピー');
  assert.equal(d.sectionId, 's1');
  assert.deepEqual([d.createdAt, d.updatedAt], [777, 777]);
  assert.deepEqual(d.tokens, src.tokens);
  d.tokens[0].str = 'L';
  d.tags.push('y');
  assert.equal(src.tokens[0].str, 'H'); // 深い複製
  assert.deepEqual(src.tags, ['x']);
  assert.equal(duplicateCombo(mkCombo('e', [], { title: '' }), 1).title, 'コピー');
  const long = duplicateCombo(mkCombo('l', [], { title: 'あ'.repeat(LIMITS.title) }), 1);
  assert.equal(long.title.length, LIMITS.title);
  assert.ok(long.title.endsWith('のコピー'));
  const doc = { sections: [{ id: 's1', characterId: 'ryu', name: 'n', order: 0, updatedAt: 1 }], combos: [src, d, long] };
  assert.ok(validateDoc(exportDoc(doc)).ok);
});

test('sanitizeDraft: 正しい形はそのまま、壊れた項目は捨てる、オブジェクト以外はnull', () => {
  const ok = { sectionId: 's1', title: 'a', position: 'corner', tokens: [N('stand', 'L', 'P')], memo: 'm', tags: ['x'], savedAt: 5 };
  assert.deepEqual(sanitizeDraft(ok), ok);
  for (const bad of [null, 5, 'x', [], undefined]) assert.equal(sanitizeDraft(bad), null);
  const r = sanitizeDraft({ sectionId: 3, title: 9, position: 'zzz', tokens: [{ type: 'bad' }, N('stand', 'L', 'P')], memo: null, tags: ['', '  ', 5, 'ok'], savedAt: -1 });
  assert.deepEqual(r, { sectionId: null, title: '', position: 'any', tokens: [N('stand', 'L', 'P')], memo: '', tags: ['ok'], savedAt: null });
  // 形の違う項目は fresh（新規または保存済みの値）で補う
  const fresh = { sectionId: 's9', title: '保存済み', position: 'corner', memo: 'メモ', tags: ['t'] };
  assert.deepEqual(sanitizeDraft({ sectionId: 3, title: 9, position: 'zzz', tokens: [], memo: null, tags: 'x' }, fresh), { ...fresh, tokens: [], savedAt: null });
  assert.equal(sanitizeDraft({ tokens: [], title: '' }, fresh).title, ''); // 空文字は有効な入力（タイトルを消した下書き）
  const big = sanitizeDraft({ title: 'a'.repeat(500), tokens: Array.from({ length: 300 }, () => N('stand', 'L', 'P')), tags: Array.from({ length: 50 }, (_, i) => `t${i}`) });
  assert.equal(big.title.length, LIMITS.title);
  assert.equal(big.tokens.length, LIMITS.tokens);
  assert.equal(big.tags.length, LIMITS.tags);
});

// ===== 前ステ・バクステ、強度なし、データ版2（D-013） =====
const MV = (id) => ({ type: 'move', id });

test('move: 検証・ラベル（矢印・数字とも同じ）・applyPadInput（ペンディング破棄、カーソル位置に挿入）', () => {
  for (const [id, name] of [['FWD_STEP', '前ステ'], ['BACK_STEP', 'バクステ']]) {
    assert.ok(isValidToken(MV(id)));
    assert.equal(tokenLabel(MV(id)), name);
    assert.equal(tokenLabel(MV(id), 'numpad'), name);
  }
  for (const bad of [MV('DASH'), MV(undefined), { type: 'move' }, { ...MV('FWD_STEP'), str: 'N' }, { type: 'move', id: 'FWD_STEP', extra: 1 }]) assert.equal(isValidToken(bad), false, JSON.stringify(bad));
  const s = run([stance('crouch'), dir(6), { type: 'move', id: 'BACK_STEP' }]);
  assert.deepEqual(s.tokens, [MV('BACK_STEP')]);
  assert.deepEqual(s.pending, { stance: 'stand', dirs: [] });
  assert.equal(s.cursor, 1);
  const mid = run([btn('L', 'P'), btn('M', 'P'), { type: 'cursor', index: 1 }, { type: 'move', id: 'FWD_STEP' }]);
  assert.deepEqual(mid.tokens.map((t) => t.type), ['normal', 'move', 'normal']);
  assert.equal(mid.cursor, 2);
  assert.throws(() => applyPadInput(initialPadState(), { type: 'move', id: 'DASH' }), /不正な移動/);
});

test('move: 行動トークンとして▶でつながり、CH・PCの付き先になる。直近の技にも入る', () => {
  const T = [N('stand', 'L', 'P'), MV('FWD_STEP'), { type: 'note', id: 'CH' }, MV('BACK_STEP'), { type: 'note', id: 'PC' }, N('stand', 'M', 'K')];
  const row = describeRow(T);
  assert.deepEqual(row.map((d) => d.kind), ['group', 'conn', 'group', 'conn', 'group', 'conn', 'group']);
  assert.deepEqual(row.filter((d) => d.kind === 'group').map((d) => d.label), ['立ち弱P', '前ステ', 'バクステ', '立ち中K']);
  assert.deepEqual(row[4].notes, [{ id: 'CH', index: 2 }]); // バクステにCHが付く
  assert.deepEqual(row[6].notes, [{ id: 'PC', index: 4 }]);
  const r = recentTokens([mkCombo('m', [MV('FWD_STEP'), N('stand', 'L', 'P')])], 'ryu');
  assert.deepEqual(r.map((t) => tokenLabel(t)), ['立ち弱P', '前ステ']);
  assert.deepEqual(r[1], MV('FWD_STEP'));
});

test('強度なし(N): 検証・ラベル・strengthChoices・changeStrength・applyPadInput', () => {
  assert.ok(isValidToken(N('stand', 'N', 'P')));
  assert.ok(isValidToken(SPc('236', 'N', 'K')));
  assert.equal(tokenLabel(N('stand', 'N', 'P')), '立ちP');
  assert.equal(tokenLabel(N('crouch', 'N', 'K')), '屈K');
  assert.equal(tokenLabel(N('jump', 'N', 'P')), 'ジャンプP');
  assert.equal(tokenLabel(N('stand', 'N', 'K', 4)), '引きK');
  assert.equal(tokenLabel(SPc('236', 'N', 'P')), '波動 ↓↘→ P');
  assert.equal(tokenLabel(SPc('236', 'N', 'K'), 'numpad'), '波動 236 K');
  assert.deepEqual(run([dir(2), btn('N', 'P')]).tokens, [N('crouch', 'N', 'P')]);
  assert.deepEqual(run([preset('236'), btn('N', 'K')]).tokens, [SPc('236', 'N', 'K')]);
  assert.deepEqual(run([stance('jump'), preset('623'), btn('N', 'P')]).tokens, [{ ...SPc('623', 'N', 'P'), stance: 'jump' }]);
  assert.deepEqual(changeStrength(N('stand', 'H', 'P'), 'N'), N('stand', 'N', 'P'));
  assert.deepEqual(changeStrength(SPc('236', 'N', 'P'), 'OD'), SPc('236', 'OD', 'P'));
  const s = applyPadInput(run([btn('M', 'K')]), { type: 'strength', index: 0, value: 'N' });
  assert.deepEqual(s.tokens, [N('stand', 'N', 'K')]);
  assert.equal(applyPadInput(run([btn('OD', 'P')]), btn('N', 'P')).tokens.length, 1); // Nは必殺技でなくても確定できる（ODと違いモーション不要）
});

test('データ版: 版1と2を受け付け、版3以上を拒否。書き出しは版2', () => {
  assert.equal(exportDoc({ sections: [], combos: [] }).schemaVersion, 2);
  for (const v of [1, 2]) {
    const d = sampleDoc();
    d.schemaVersion = v;
    assert.deepEqual(validateDoc(d), { ok: true }, `版${v}`);
    assert.equal(parseDocText(JSON.stringify(d)).ok, true, `版${v}`);
    assert.equal(mergeImport({ sections: [], combos: [] }, d).ok, true, `版${v}`);
  }
  for (const v of [3, 4, 99]) {
    const d = sampleDoc();
    d.schemaVersion = v;
    const r = validateDoc(d);
    assert.equal(r.ok, false, `版${v}`);
    assert.match(r.reason, /新しい版\(schemaVersion \d+\)/);
    assert.equal(mergeImport({ sections: [], combos: [] }, d).ok, false, `版${v}`);
  }
  // 版1の文書にmove・Nを含んでも、検証は通す（版を見てトークンを制限しない。変換もしない）
  const v1 = sampleDoc();
  v1.schemaVersion = 1;
  v1.combos[0].tokens.push(MV('FWD_STEP'), N('stand', 'N', 'P'));
  assert.deepEqual(validateDoc(v1), { ok: true });
  // 版1の文書を取り込んでも内容は変換されず、書き出すと版2になる
  const m = mergeImport({ sections: [], combos: [] }, v1);
  assert.deepEqual(m.doc.combos, v1.combos);
  assert.equal(exportDoc(m.doc).schemaVersion, 2);
});

test('move・Nを含む文書: 書き出し→JSON→取り込みの往復で一致し、複製・下書きの整形でも保たれる', () => {
  const state = sampleState();
  state.combos[0].tokens.push(MV('BACK_STEP'), { type: 'note', id: 'CH' }, MV('FWD_STEP'), N('crouch', 'N', 'P'), SPc('236', 'N', 'K'));
  const r = parseDocText(JSON.stringify(exportDoc(state)));
  assert.ok(r.ok);
  assert.equal(r.doc.schemaVersion, 2);
  assert.deepEqual(mergeImport({ sections: [], combos: [] }, r.doc).doc, state);
  assert.deepEqual(duplicateCombo(state.combos[0], 5).tokens, state.combos[0].tokens);
  // 主項目 tokens が配列でない壊れた下書きは捨てる（空の記録として復元しない）
  for (const bad of [{ tokens: 'x' }, { title: 'a' }, { tokens: null }, { tokens: {} }]) assert.equal(sanitizeDraft(bad), null, JSON.stringify(bad));
  const draft = sanitizeDraft({ tokens: [MV('FWD_STEP'), MV('X'), N('stand', 'N', 'K'), N('stand', 'Z', 'K')] });
  assert.deepEqual(draft.tokens, [MV('FWD_STEP'), N('stand', 'N', 'K')]);
});

// ===== ダメージ（D-012） =====
test('damage: 未入力（キーなし）の既存データと、0・99999・途中の整数は通る', () => {
  assert.ok(validateDoc(sampleDoc()).ok); // 既存データ（damageなし）
  for (const v of [0, 1, 3240, DAMAGE_MAX]) {
    const d = sampleDoc();
    d.combos[0].damage = v;
    assert.deepEqual(validateDoc(d), { ok: true }, String(v));
  }
});

test('damage: 範囲外・非整数・負数・文字列などは個別の理由で拒否する', () => {
  const cases = [
    ['上限超え 100000', 100000], ['負数 -1', -1], ['小数 1.5', 1.5], ['数値文字列 "3240"', '3240'], ['空文字', ''],
    ['NaN', NaN], ['Infinity', Infinity], ['null', null], ['真偽値', true], ['配列', [3240]], ['オブジェクト', { v: 1 }],
  ];
  for (const [name, v] of cases) {
    const d = sampleDoc();
    d.combos[0].damage = v;
    const r = validateDoc(d);
    assert.equal(r.ok, false, name);
    assert.ok(r.reason.includes('1件目のcombosのdamageが不正です'), `${name}: ${r.reason}`);
    assert.ok(!isDamage(v), name);
  }
});

test('damage: 書き出し→JSON→取り込みの往復で値が一致し、複製と下書きの整形でも保たれる', () => {
  const state = sampleState();
  state.combos[0].damage = 3240;
  const text = JSON.stringify(exportDoc(state));
  const r = parseDocText(text);
  assert.ok(r.ok);
  assert.equal(r.doc.combos[0].damage, 3240);
  assert.equal('damage' in r.doc.combos[1], false); // 未入力のコンボはキーを持たない
  const merged = mergeImport({ sections: [], combos: [] }, r.doc);
  assert.deepEqual(merged.doc.combos, state.combos);
  assert.equal(duplicateCombo(state.combos[0], 5).damage, 3240);
  assert.equal('damage' in duplicateCombo(state.combos[1], 5), false);
  assert.equal(sanitizeDraft({ tokens: [], damage: 3240 }).damage, 3240);
  for (const bad of [-1, 100000, 1.5, '3240', null, NaN]) assert.equal('damage' in sanitizeDraft({ tokens: [], damage: bad }), false, String(bad));
  assert.equal('damage' in sanitizeDraft({ tokens: [] }), false);
});

// ---- 書き出しの案内・ファイル名（T-012） ----
const D = 86_400_000;
const NOW = new Date(2026, 9, 15, 9, 5).getTime(); // ローカル時刻 2026-10-15 09:05
const settingsOf = (o = {}) => ({ lastExportAt: null, lastChangeAt: null, firstChangeAt: null, remindSnoozeUntil: null, ...o });
const withCombos = { combos: [{}] };

test('exportFilename: sf6-memo-YYYYMMDD-HHMM.json（ローカル時刻、ゼロ埋め）。tag は日付の前に入る', () => {
  assert.equal(exportFilename(NOW), 'sf6-memo-20261015-0905.json');
  assert.equal(exportFilename(new Date(2027, 0, 2, 23, 59).getTime()), 'sf6-memo-20270102-2359.json');
  assert.equal(exportFilename(NOW, '-raw'), 'sf6-memo-raw-20261015-0905.json');
  assert.equal(dateText(NOW), '2026-10-15');
});

test('daysSince: 日数は切り捨て。未来の時刻は0', () => {
  assert.equal(daysSince(NOW - 21 * D, NOW), 21);
  assert.equal(daysSince(NOW - 21 * D + 1, NOW), 20);
  assert.equal(daysSince(NOW + D, NOW), 0);
  assert.equal(snoozeUntil(NOW) - NOW, 7 * D);
});

test('shouldRemindExport: 書き出し済みは14日以上かつその後に変更があるときだけ（境界: 13日・14日）', () => {
  const s = (days, changeDaysAgo) => settingsOf({ lastExportAt: NOW - days * D, lastChangeAt: changeDaysAgo === null ? null : NOW - changeDaysAgo * D });
  assert.equal(shouldRemindExport(s(13, 1), withCombos, NOW), false, '13日');
  assert.equal(shouldRemindExport(s(14, 1), withCombos, NOW), true, '14日ちょうど');
  assert.equal(shouldRemindExport({ ...s(14, 1), lastExportAt: NOW - 14 * D + 1 }, withCombos, NOW), false, '14日に1ms足りない');
  assert.equal(shouldRemindExport(s(30, 40), withCombos, NOW), false, '書き出し後に変更なし');
  assert.equal(shouldRemindExport(s(30, null), withCombos, NOW), false, '変更の記録なし');
  assert.equal(shouldRemindExport(settingsOf({ lastExportAt: NOW - 30 * D, lastChangeAt: NOW - 30 * D }), withCombos, NOW), false, '変更と書き出しが同時刻');
  assert.equal(shouldRemindExport(s(30, 1), { combos: [] }, NOW), true, '書き出し済みなら記録が0件でも変更があれば案内（削除の控え）');
});

test('shouldRemindExport: 未書き出しは記録1件以上かつ最初の変更から14日以上', () => {
  const s = (days) => settingsOf({ firstChangeAt: NOW - days * D, lastChangeAt: NOW });
  assert.equal(shouldRemindExport(s(13), withCombos, NOW), false, '13日');
  assert.equal(shouldRemindExport(s(14), withCombos, NOW), true, '14日');
  assert.equal(shouldRemindExport(s(30), { combos: [] }, NOW), false, '記録0件');
  assert.equal(shouldRemindExport(settingsOf(), withCombos, NOW), false, '変更の記録なし');
});

test('shouldRemindExport: スヌーズ中は出さず、期限が来たら出す', () => {
  const base = { lastExportAt: NOW - 30 * D, lastChangeAt: NOW - D };
  assert.equal(shouldRemindExport(settingsOf({ ...base, remindSnoozeUntil: NOW + 1 }), withCombos, NOW), false);
  assert.equal(shouldRemindExport(settingsOf({ ...base, remindSnoozeUntil: NOW }), withCombos, NOW), true);
  assert.equal(shouldRemindExport(settingsOf({ ...base, remindSnoozeUntil: snoozeUntil(NOW - 7 * D) }), withCombos, NOW), true, '7日前のあとで');
});

test('neonLevel: 閾値の境界（design-spec-v2.1 1.1）', () => {
  assert.deepEqual(NEON_STEPS, [1, 2, 3, 5, 8, 12, 18, 28, 45, 70]);
  const cases = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 3], [5, 4], [7, 4], [8, 5], [11, 5], [12, 6], [17, 6], [18, 7], [27, 7], [28, 8], [44, 8], [45, 9], [69, 9], [70, 10], [5000, 10]];
  for (const [n, lv] of cases) assert.equal(neonLevel(n), lv, `${n}件`);
});

// ===== 必殺技の技名（D-017、docs/design-spec-v2.2.md 5・6章。実データ） =====
const sp = (motion, key, str, stance) => ({ type: 'special', motion, key, str, ...(stance && { stance }) });
const nm = (key, str, dir, stance = 'stand') => ({ type: 'normal', stance, key, str, ...(dir && { dir }) });
const NOTE = (id) => ({ type: 'note', id });
// 技名（なければ理由）の列。null は技名を付けない行動
const nameOf = (tokens, cid) => specialNames(tokens, cid).map((r) => (r === null ? null : r.name ?? r.why));

test('技名: リュウの強度つき判定（基準1・5a）', () => {
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), sp('623', 'P', 'L'), sp('236', 'P', 'N'), sp('236', 'P', 'OD'), sp('623', 'P', 'H')], 'ryu'),
    ['中波動拳', '弱昇龍拳', '波動拳', 'OD波動拳', '強昇龍拳']);
  assert.deepEqual(nameOf([sp('236', 'K', 'H'), sp('214', 'P', 'L')], 'ryu'), ['強上段足刀蹴り', '弱波掌撃']);
});

test('技名: 登録されていない組み合わせ・辞書のないキャラ・通常技は技名なし', () => {
  // 41236P は一覧になく、22K も一覧にない。通常技とシステム技は null
  assert.deepEqual(nameOf([sp('41236', 'P', 'M'), sp('22', 'K', 'M'), nm('P', 'M', 6), { type: 'system', id: 'CDR' }], 'ryu'), ['unlisted', 'unlisted', null, null]);
  for (const cid of ['nobody', 'constructor', '__proto__', 'toString']) {
    assert.deepEqual(nameOf([sp('236', 'P', 'M')], cid), [null], cid);
    assert.equal(hasSpecials(cid), false, cid);
  }
  assert.equal(hasSpecials('ryu'), true);
});

test('技名: 空中の技はジャンプのときだけ当たる（地上の技はジャンプでは当たらない）', () => {
  assert.deepEqual(nameOf([sp('214', 'K', 'M'), sp('214', 'K', 'M', 'jump'), sp('236', 'P', 'M', 'jump')], 'ryu'), ['中竜巻旋風脚', '中空中竜巻旋風脚', 'unlisted']);
  // 名前に「空中」がなく、注記だけで空中と決めた技
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), sp('236', 'P', 'M', 'jump')], 'gouki_akuma'), ['中豪波動拳', '中斬空波動拳']);
  assert.deepEqual(nameOf([sp('214', 'K', 'M'), sp('214', 'K', 'M', 'jump')], 'jamie'), ['unlisted', '中無影蹴']);
});

test('技名: ガイルの「46」P は溜め［4］6の技名（［ ］を外して比べる）', () => {
  assert.deepEqual(nameOf([sp('46', 'P', 'L'), sp('[4]6', 'P', 'M'), sp('28', 'K', 'H'), sp('[2]8', 'K', 'N')], 'guile'),
    ['弱ソニックブーム', '中ソニックブーム', '強サマーソルトキック', 'サマーソルトキック']);
  assert.deepEqual(nameOf([sp('360', 'P', 'H')], 'zangief'), ['強スクリューパイルドライバー']);
  assert.deepEqual(nameOf([sp('36', 'P', 'H')], 'zangief'), ['unlisted'], '360 はプリセットの360だけ');
});

test('技名: 同じ入力に複数の技が当たるときは技名なし（候補は全て）', () => {
  const r = specialNames([sp('63214', 'K', 'M')], 'zangief')[0];
  assert.equal(r.name, null);
  assert.equal(r.why, 'multi');
  assert.deepEqual(r.choices, ['ロシアンスープレックス', 'シベリアンエクスプレス']);
  assert.deepEqual(nameOf([sp('236', 'P', 'M')], 'jamie'), ['multi'], '流酔拳と流酔脚は最初の入力が同じ');
});

test('強度の接頭辞（基準5a）: 弱中強OD・強度なし・区別がない技・ODなしの技', () => {
  const pre = (str) => specialNames([sp('623', 'P', str)], 'ryu')[0].name;
  assert.deepEqual(['L', 'M', 'H', 'OD', 'N'].map(pre), ['弱昇龍拳', '中昇龍拳', '強昇龍拳', 'OD昇龍拳', '昇龍拳']);
  assert.equal(specialNames([sp('623', 'P', 'H')], 'ryu')[0].base, '昇龍拳', 'base は接頭辞なし');
  // 強度が強だけの技（アルジュンの不撓の警衛 22K）: 強の入力でも接頭辞なし。強度なしも技名。ほかの強度は一覧にない
  assert.deepEqual(nameOf([sp('22', 'K', 'H'), sp('22', 'K', 'N'), sp('22', 'K', 'L'), sp('22', 'K', 'OD')], 'arjun'), ['不撓の警衛', '不撓の警衛', 'unlisted', 'unlisted']);
  // ODのない技（リュウの電刃錬気 22P）: ODは一覧にない（コマンド表示）、ほかは接頭辞つき
  assert.deepEqual(nameOf([sp('22', 'P', 'OD'), sp('22', 'P', 'M'), sp('22', 'P', 'N')], 'ryu'), ['unlisted', '中電刃錬気', '電刃錬気']);
  // 強さの区別がない派生: どの強度でも接頭辞なし
  for (const str of ['L', 'M', 'H', 'N']) assert.equal(nameOf([sp('236', 'P', 'M'), nm('P', str, 6)], 'arjun')[1], '追撃', str);
  assert.ok(!specialNames([sp('623', 'P', 'M')], 'ryu')[0].name.includes(' '), '接頭辞と技名の間に空白を入れない');
});

test('強度別の技名がある技: その強度の技名をそのまま出し、接頭辞なし。強度なしとODは名前が決まらない', () => {
  // ケンの迅雷脚(236K)の派生 6K: 弱=風鎌蹴り、中=轟雷落とし、強=閃火脚
  const ken = (str) => nameOf([sp('236', 'K', 'M'), nm('K', str, 6)], 'ken')[1];
  assert.deepEqual(['L', 'M', 'H', 'N'].map(ken), ['風鎌蹴り', '轟雷落とし', '閃火脚', 'strength']);
  assert.equal(specialNames([sp('236', 'K', 'M'), nm('K', 'H', 6)], 'ken')[1].parent, '迅雷脚');
  assert.deepEqual(nameOf([nm('K', 'H', 6)], 'ken'), [null], '親がなければ名前なし');
  // キンバリーの疾駆け(236K)の派生: K は強度別（胴刎ね…）、P は区別なし（急停止）
  const kim = (key, str) => nameOf([sp('236', 'K', 'L'), nm(key, str)], 'kimberly')[1];
  assert.deepEqual([kim('K', 'L'), kim('K', 'M'), kim('K', 'H'), kim('P', 'M')], ['胴刎ね', '影すくい', '首狩り', '急停止']);
  // 立ちの必殺技で強度別（ジュリの236K）: 弱歳破衝ではなく歳破衝。強度なしは名前が決まらず、ODは一覧にない
  assert.deepEqual(['L', 'M', 'H', 'N', 'OD'].map((x) => nameOf([sp('236', 'K', x)], 'juri')[0]), ['歳破衝', '暗剣殺', '五黄殺', 'strength', 'unlisted']);
  // 弱と中が同名のとき（テリーの236P）
  assert.deepEqual(['L', 'M', 'H'].map((x) => nameOf([sp('236', 'P', x)], 'terry')[0]), ['パワーウェイブ', 'パワーウェイブ', 'ラウンドウェイブ']);
});

test('派生の基本（基準11）: アルジュンの 236P ▶ 6P', () => {
  const r = specialNames([sp('236', 'P', 'M'), nm('P', 'N', 6)], 'arjun');
  assert.equal(r[0].name, '中大義の巨腕');
  assert.deepEqual([r[1].name, r[1].derived, r[1].parent], ['追撃', true, '大義の巨腕']);
  // 読み上げ名（4章）。技名表示は派生名・親の派生・コマンド、コマンド表示は逆順
  const tk = nm('P', 'N', 6);
  assert.equal(specialLabel(tk, r[1], 'name'), `追撃、大義の巨腕の派生、${tokenLabel(tk)}`);
  assert.equal(specialLabel(tk, r[1], 'cmd'), `${tokenLabel(tk)}、追撃、大義の巨腕の派生`);
  assert.equal(specialLabel(sp('236', 'P', 'M'), r[0], 'name'), '中大義の巨腕、波動 ↓↘→ 中P');
  assert.equal(specialLabel(sp('236', 'P', 'M'), r[0], 'cmd'), '波動 ↓↘→ 中P、中大義の巨腕');
  assert.equal(specialLabel(sp('236', 'P', 'M'), null, 'name'), '波動 ↓↘→ 中P', '技名がなければコマンドのまま');
  assert.equal(specialLabel(sp('41236', 'P', 'M'), specialNames([sp('41236', 'P', 'M')], 'ryu')[0], 'name'), tokenLabel(sp('41236', 'P', 'M')));
});

test('派生: 6Pが2つの親に当たるケース（追撃と息吹の震撼）と、親なしの6P', () => {
  assert.deepEqual(nameOf([sp('236', 'P', 'L'), nm('P', 'N', 6)], 'arjun'), ['弱大義の巨腕', '追撃']);
  assert.deepEqual(nameOf([sp('236', 'K', 'L'), nm('P', 'N', 6)], 'arjun'), ['弱息吹の円筒', '息吹の震撼']);
  const second = specialNames([sp('236', 'K', 'L'), nm('P', 'N', 6)], 'arjun')[1];
  assert.equal(second.parent, '息吹の円筒');
  assert.deepEqual(nameOf([nm('P', 'N', 6)], 'arjun'), [null], '行頭の6P');
  assert.deepEqual(nameOf([nm('P', 'N', 6), sp('236', 'P', 'M')], 'arjun'), [null, '中大義の巨腕']);
  // 派生の判定はキャラごとの辞書による: リュウの 236P ▶ 6P は派生ではない
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), nm('P', 'M', 6)], 'ryu'), ['中波動拳', null]);
  // 形が違えば派生にならない（6K、立ちPで方向なし、しゃがみ、ジャンプ、ボタン違い）
  for (const t of [nm('K', 'N', 6), nm('P', 'N'), nm('P', 'N', undefined, 'crouch'), nm('P', 'N', 6, 'jump'), nm('P', 'N', 4)]) {
    assert.deepEqual(nameOf([sp('236', 'P', 'M'), t], 'arjun'), ['中大義の巨腕', null], JSON.stringify(t));
  }
  // 親が辞書にない・派生のない技の直後: 厳酷な岩肩(623P)の自動派生は入力表記がなく辞書に入れていない
  assert.deepEqual(nameOf([sp('623', 'P', 'M'), nm('P', 'N', 6)], 'arjun'), ['中厳酷な岩肩', null]);
  // 方向なし・しゃがみの形（キャミィのフーリガンコンビネーションの派生: K、2K、P）
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), nm('K', 'N')], 'cammy'), ['中フーリガンコンビネーション', 'キャノンストライク']);
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), nm('K', 'N', undefined, 'crouch')], 'cammy'), ['中フーリガンコンビネーション', 'リバースエッジ']);
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), nm('K', 'N', 3)], 'cammy').at(1), null, '方向が違う（3K）');
});

test('派生が成り立たないとき（基準12）: 直前が別の技・移動・システム技・SA', () => {
  const kid = nm('P', 'N', 6);
  assert.deepEqual(nameOf([sp('214', 'P', 'M'), kid], 'arjun'), ['unlisted', null], '直前が一覧にない技');
  assert.deepEqual(nameOf([sp('623', 'P', 'M'), kid], 'arjun').at(1), null, '直前が別の技');
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), nm('K', 'M'), kid], 'arjun').at(2), null, '間に通常技');
  for (const mid of [{ type: 'move', id: 'FWD_STEP' }, { type: 'system', id: 'CDR' }, { type: 'sa', level: 1 }]) {
    assert.deepEqual(nameOf([sp('236', 'P', 'M'), mid, kid], 'arjun').at(2), null, `間に${mid.type}`);
  }
  // 技名のない必殺技（複数の技が当たる）の直後も派生にならない
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), nm('P', 'N', 6)], 'jamie'), ['multi', null]);
});

test('派生: 親と派生の間の注記（CH・PC）は飛ばす（基準12）', () => {
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), NOTE('CH'), nm('P', 'N', 6)], 'arjun'), ['中大義の巨腕', null, '追撃']);
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), NOTE('CH'), NOTE('PC'), nm('P', 'N', 6)], 'arjun').at(3), '追撃');
  // 注記を飛ばしても、間に別の行動があれば派生にならない
  assert.deepEqual(nameOf([sp('236', 'P', 'M'), NOTE('CH'), nm('K', 'M'), NOTE('PC'), nm('P', 'N', 6)], 'arjun').at(4), null);
});

test('派生の引き直し（基準13）: 親の削除・挿入・強度変更で技名が付いたり外れたりする。複製しても同じ', () => {
  const toks = [sp('236', 'P', 'M'), nm('P', 'N', 6)];
  assert.equal(nameOf(toks, 'arjun')[1], '追撃');
  assert.deepEqual(nameOf(toks.slice(1), 'arjun'), [null], '親を削除');
  assert.equal(nameOf([...toks.slice(0, 1), nm('K', 'L'), toks[1]], 'arjun')[2], null, '間に別の技を挿入');
  assert.equal(nameOf(toks, 'arjun')[1], '追撃', '元に戻す');
  // 親の強度を条件の外へ: 舞の乱れ花蝶扇（花蝶扇のODのあとだけ）
  const mai = (str) => nameOf([sp('236', 'P', str), nm('P', 'N', 6)], 'mai')[1];
  assert.deepEqual(['OD', 'L', 'M', 'H', 'N'].map(mai), ['乱れ花蝶扇', null, null, null, null]);
  // 複製: 保存した記録はトークンが同じなので判定も同じ
  const dup = duplicateCombo({ id: 'x', title: 't', tokens: toks, createdAt: 1, updatedAt: 1 }, 5);
  assert.deepEqual(nameOf(dup.tokens, 'arjun'), nameOf(toks, 'arjun'));
});

test('連鎖（基準14）: 親 ▶ 派生1 ▶ 派生2 で両方に技名が付く', () => {
  // ディージェイ ジョスクール(214K) → ジャグリンステップ(6P) → ジャグリンスウェイ(4P)
  const chain = [sp('214', 'K', 'L'), nm('P', 'N', 6), nm('P', 'N', 4)];
  assert.deepEqual(nameOf(chain, 'deejay'), ['弱ジョスクール', 'ジャグリンステップ', 'ジャグリンスウェイ']);
  assert.equal(specialNames(chain, 'deejay')[2].parent, 'ジャグリンステップ');
  assert.deepEqual(nameOf([chain[0], chain[2]], 'deejay'), ['弱ジョスクール', null], '派生1を削除すると派生2は親の派生でなくなる');
  assert.deepEqual(nameOf([chain[1], chain[2]], 'deejay'), [null, null]);
  // ラシード アラビアン・サイクロン(214P) → アサルト・ロール(6K) → アサルト・ネイル(K)、ベガ シャドウライズ → ヘッドプレス(K) → サマーソルトスカルダイバー(P)
  assert.deepEqual(nameOf([sp('214', 'P', 'H'), nm('K', 'M', 6), nm('K', 'L')], 'rashid'), ['強アラビアン・サイクロン', 'アサルト・ロール', 'アサルト・ネイル']);
  assert.deepEqual(nameOf([sp('[2]8', 'K', 'M'), nm('K', 'N'), nm('P', 'N')], 'vega_mbison'), ['中シャドウライズ', 'ヘッドプレス', 'サマーソルトスカルダイバー']);
  // 派生の派生にならない並び: ヘッドプレスのあとのKはなし
  assert.deepEqual(nameOf([sp('[2]8', 'K', 'M'), nm('K', 'N'), nm('K', 'N')], 'vega_mbison').at(2), null);
});

test('強度条件（基準15）: 親の強度条件と派生の強度を、データのとおりに判定する', () => {
  // 豪鬼 百鬼襲(236K)のOD後だけ 236P=百鬼豪斬空・214K=百鬼豪螺旋。それ以外の236Pは豪波動拳
  const gouki = (str, t) => nameOf([sp('236', 'K', str), t], 'gouki_akuma')[1];
  assert.equal(gouki('OD', sp('236', 'P', 'M')), '百鬼豪斬空');
  assert.equal(gouki('OD', sp('214', 'K', 'N')), '百鬼豪螺旋');
  assert.equal(gouki('M', sp('236', 'P', 'M')), '中豪波動拳', '条件の外では単独の技');
  assert.equal(gouki('N', sp('236', 'P', 'M')), '中豪波動拳', '強度なしの親は、条件が弱中強をすべて含まなければ親ではない');
  assert.equal(gouki('M', nm('P', 'N')), '百鬼豪衝', '条件のない派生は親の強度が何でもよい');
  assert.equal(gouki('N', nm('P', 'N')), '百鬼豪衝');
  assert.equal(gouki('OD', nm('K', 'N')), '百鬼豪刃');
  // 派生の判定でも、派生が単独の技と同じ形なら派生が先（キンバリーの召雷細工 22P → 細工手裏剣 22P）
  assert.deepEqual(nameOf([sp('22', 'P', 'M'), sp('22', 'P', 'M'), sp('22', 'P', 'M')], 'kimberly'), ['中召雷細工', '細工手裏剣', '中召雷細工']);
  // A.K.I. 紫煙追(6P)は、強度別の親 紫煙砲 のうち弱(214P)だけ
  const aki = (str) => nameOf([sp('214', 'P', str), nm('P', 'N', 6)], 'aki');
  assert.deepEqual(aki('L'), ['紫煙砲', '紫煙追']);
  assert.deepEqual(aki('M'), ['紫泡泉', null]);
  assert.deepEqual(aki('N'), ['strength', null]);
});

test('強度条件: 同じ入力が2つの派生に当たるときはコマンド表示（その次の行動は親なし）', () => {
  // 実データには残っていないので、同じ親に同じ形の派生が2つある辞書で確かめる
  const dict = { t: [
    { name: '親', motion: '236', button: 'P' },
    { name: '派生A', motion: '6', button: 'P', follows: ['親'] },
    { name: '派生B', motion: '6', button: 'P', follows: ['親'] },
    { name: '孫', motion: '4', button: 'P', follows: ['派生A'] },
  ] };
  const r = specialNames([sp('236', 'P', 'M'), nm('P', 'N', 6), nm('P', 'N', 4)], 't', dict);
  assert.deepEqual([r[1].name, r[1].why, r[1].choices], [null, 'multi', ['派生A', '派生B']]);
  assert.equal(r[2], null, '親が複数の候補なら次は派生にならない');
});

test('候補（基準3・16）: 方向なしは派生、続けて全必殺技（辞書の順）。ジャンプ中は空中の技だけ', () => {
  const after = specialCandidates({ characterId: 'arjun', tokens: [sp('236', 'P', 'M')] });
  assert.equal(after[0].name, '追撃');
  assert.deepEqual([after[0].derived, after[0].parent, after[0].motion, after[0].button], [true, '大義の巨腕', '6', 'P']);
  assert.deepEqual(after[0].instant, { type: 'normal', stance: 'stand', dir: 6, key: 'P', str: 'N' }, '強さの区別がない派生はそのまま入れる');
  assert.deepEqual(after.slice(1).map((c) => c.name), SPECIALS.arjun.filter((e) => !e.follows).map((e) => e.name));
  assert.ok(after.slice(1).every((c) => !c.derived && c.instant === null));
  // カーソルを親の後ろ以外へ動かすと派生の候補は消える
  const toks = [sp('236', 'P', 'M'), nm('K', 'L')];
  assert.equal(specialCandidates({ characterId: 'arjun', tokens: toks, cursor: 1 })[0].derived, true);
  assert.equal(specialCandidates({ characterId: 'arjun', tokens: toks, cursor: 2 })[0].derived, false);
  assert.equal(specialCandidates({ characterId: 'arjun', tokens: toks, cursor: 0 })[0].derived, false);
  // 間の注記は飛ばす
  assert.equal(specialCandidates({ characterId: 'arjun', tokens: [sp('236', 'P', 'M'), NOTE('CH')] })[0].name, '追撃');
  // 親の強度条件を満たさないときは出ない（舞: 花蝶扇のODのあとだけ）
  assert.equal(specialCandidates({ characterId: 'mai', tokens: [sp('236', 'P', 'M')] }).some((c) => c.derived), false);
  assert.equal(specialCandidates({ characterId: 'mai', tokens: [sp('236', 'P', 'OD')] })[0].name, '乱れ花蝶扇');
  // ジャンプ中は空中の技だけ（派生の通常技形も出ない）
  const air = specialCandidates({ characterId: 'ryu', jump: true });
  assert.deepEqual(air.map((c) => c.name), ['空中竜巻旋風脚']);
  assert.equal(air[0].air, true);
  assert.deepEqual(specialCandidates({ characterId: 'arjun', tokens: [sp('236', 'P', 'M')], jump: true }), []);
  assert.deepEqual(specialCandidates({ characterId: 'nobody' }), []);
});

test('候補: 方向ありは 派生 → 一致 → 入力で始まる（溜めの［ ］は外して比べる）', () => {
  const names = (o) => specialCandidates({ characterId: 'ryu', ...o }).map((c) => c.name);
  assert.deepEqual(names({ motion: '236' }), ['波動拳', '上段足刀蹴り']);
  assert.deepEqual(names({ motion: '23' }), ['波動拳', '上段足刀蹴り']);
  assert.deepEqual(names({ motion: '2' }), ['波動拳', '竜巻旋風脚', '空中竜巻旋風脚', '上段足刀蹴り', '波掌撃', '電刃錬気'], '2 で始まる技を辞書の順に');
  assert.deepEqual(names({ motion: '22' }), ['電刃錬気']);
  assert.deepEqual(names({ motion: '41' }), []);
  assert.deepEqual(specialCandidates({ characterId: 'guile', motion: '[4]6' }).map((c) => c.name), ['ソニックブーム']);
  assert.deepEqual(specialCandidates({ characterId: 'guile', motion: '46' }).map((c) => c.name), ['ソニックブーム']);
  assert.deepEqual(specialCandidates({ characterId: 'guile', motion: '4' }).map((c) => c.name), ['ソニックブーム']);
  // 一致が先、入力で始まるものが後: 22 は 22 に一致する技のあとに 2 で始まる技が並ぶ。360 は360だけで当たる
  assert.deepEqual(specialCandidates({ characterId: 'zangief', motion: '360' }).map((c) => c.name), ['スクリューパイルドライバー', 'ボルシチダイナマイト']);
  assert.deepEqual(specialCandidates({ characterId: 'zangief', motion: '36' }), []);
  // 派生が先: 6 の入力で、カーソル直前が親ならアルジュンの追撃が先頭
  const arj = specialCandidates({ characterId: 'arjun', tokens: [sp('236', 'P', 'L')], motion: '6' });
  assert.deepEqual(arj.map((c) => c.name), ['追撃', '厳酷な岩肩', '鬼気迫る尋問']);
  assert.deepEqual(specialCandidates({ characterId: 'arjun', tokens: [sp('236', 'P', 'L')], motion: '2' })[0].derived, false);
  // 強度別の派生は即確定しない。名前は「／」でつなぐ
  const ken = specialCandidates({ characterId: 'ken', tokens: [sp('236', 'K', 'M')] })[0];
  assert.deepEqual([ken.name, ken.instant, ken.motion, ken.derived], ['風鎌蹴り／轟雷落とし／閃火脚', null, '6', true]);
  // 空中の技の候補は、ジャンプ中でなくても出る（選ぶとジャンプになる）。ジャンプ中は空中だけ
  assert.deepEqual(names({ motion: '214' }), ['竜巻旋風脚', '空中竜巻旋風脚', '波掌撃']);
  assert.deepEqual(names({ motion: '214', jump: true }), ['空中竜巻旋風脚']);
});

test('候補: 方向のない派生と必殺技形の派生は即確定のトークンを持つ', () => {
  const inst = (cid, parent, name) => specialCandidates({ characterId: cid, tokens: [parent] }).find((c) => c.name === name).instant;
  assert.deepEqual(inst('cammy', sp('236', 'P', 'M'), 'サイレントステップ'), { type: 'normal', stance: 'stand', key: 'P', str: 'N' });
  assert.deepEqual(inst('cammy', sp('236', 'P', 'M'), 'リバースエッジ'), { type: 'normal', stance: 'crouch', key: 'K', str: 'N' });
  assert.deepEqual(inst('kimberly', sp('22', 'P', 'M'), '細工手裏剣'), { type: 'special', motion: '22', key: 'P', str: 'N' });
  assert.deepEqual(inst('gouki_akuma', sp('236', 'K', 'OD'), '百鬼豪斬空'), { type: 'special', motion: '236', key: 'P', str: 'N' });
  // 入れるトークンは常に有効で、そのまま判定すると派生になる
  for (const [cid, list] of Object.entries(SPECIALS)) {
    for (const e of list.filter((x) => x.follows)) {
      const parent = list.find((p) => (p.v ? Object.values(p.v) : [p.name]).includes(e.follows[0]));
      const ps = e.follows[1]?.[0] ?? (parent.s ?? ['L', 'M', 'H', 'OD'])[0] ?? 'N';
      const pt = isMotion(parent.motion) ? sp(parent.motion, parent.button, ps, parent.air ? 'jump' : undefined) : null;
      if (!pt) continue; // 親が派生の連鎖は上の連鎖のテストで確かめる
      const c = specialCandidates({ characterId: cid, tokens: [pt] }).find((x) => x.derived && x.motion === e.motion && x.button === e.button && x.name.includes(e.name ?? Object.values(e.v)[0]));
      assert.ok(c, `${cid} ${e.name ?? JSON.stringify(e.v)} が候補にある`);
      if (c.instant) {
        assert.ok(isValidToken(c.instant), `${cid} ${e.name}`);
        const r = specialNames([pt, c.instant], cid)[1];
        assert.equal(r.derived, true, `${cid} ${e.name}`);
      }
    }
  }
});

test('読み上げ名（候補）: 4章の形', () => {
  const find = (cid, name, tokens = []) => specialCandidates({ characterId: cid, tokens }).find((c) => c.name === name);
  assert.equal(candidateLabel(find('ryu', '昇龍拳')), '昇龍拳、昇龍 →↓↘ P');
  assert.equal(candidateLabel(find('ryu', '昇龍拳'), 'numpad'), '昇龍拳、昇龍 623 P');
  assert.equal(candidateLabel(find('ryu', '空中竜巻旋風脚')), '空中竜巻旋風脚、ジャンプ 竜巻 ↓↙← K');
  assert.equal(candidateLabel(find('arjun', '追撃', [sp('236', 'P', 'M')])), '追撃、大義の巨腕の派生、→ P');
  assert.equal(candidateLabel(find('cammy', 'サイレントステップ', [sp('236', 'P', 'M')])), 'サイレントステップ、フーリガンコンビネーションの派生、P');
});

test('必殺技の表記の設定: 既定はコマンド、不正な値は既定値に戻す（キー名は specialNotation）', () => {
  assert.deepEqual(SPECIAL_NOTATIONS, ['cmd', 'name']);
  assert.equal(DEFAULT_SPECIAL_NOTATION, 'cmd');
  for (const v of ['cmd', 'name']) assert.equal(sanitizeSpecialNotation(v), v);
  for (const v of [undefined, null, '', 'arrow', 'NAME', 1, {}, ['name']]) assert.equal(sanitizeSpecialNotation(v), 'cmd', String(v));
});

test('保存形式は変わらない（基準2）: 技名を保存せず、書き出し→取り込みで元と一致。schemaVersionは2', () => {
  const tokens = [sp('236', 'P', 'M'), nm('P', 'N', 6), NOTE('CH'), sp('623', 'P', 'OD'), sp('46', 'P', 'H')];
  const state = { sections: [{ id: 's1', characterId: 'arjun', name: '通常', order: 0, updatedAt: T0 }],
    combos: [{ id: 'c1', characterId: 'arjun', controlType: 'classic', sectionId: 's1', title: '', position: 'any', tokens, memo: '', tags: [], favorite: false, createdAt: T0, updatedAt: T0 }] };
  const doc = exportDoc(state);
  assert.equal(doc.schemaVersion, 2);
  const text = JSON.stringify(doc);
  for (const e of SPECIALS.arjun) assert.ok(!text.includes(e.name), '技名の文字列を保存しない');
  for (const w of ['追撃', '波動拳', 'derived', 'parent', '派生']) assert.ok(!text.includes(w), w);
  const back = parseDocText(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.doc, doc);
  assert.deepEqual(nameOf(back.doc.combos[0].tokens, 'arjun'), nameOf(tokens, 'arjun'));
  assert.ok(tokens.every(isValidToken));
});

// ===== 辞書の整合 =====
test('辞書: キーはすべて CHARACTERS にあり、32キャラ分ある', () => {
  const ids = CHARACTERS.map((c) => c.id);
  assert.deepEqual(Object.keys(SPECIALS).sort(), [...ids].sort());
  assert.ok(Object.values(SPECIALS).every((list) => Array.isArray(list) && list.length > 0));
});

test('辞書: 項目の形（motion・button・s・follows）が揃っている', () => {
  const STR = ['L', 'M', 'H', 'OD', 'N'];
  const known = ['name', 'v', 'motion', 'button', 's', 'air', 'follows'];
  for (const [cid, list] of Object.entries(SPECIALS)) {
    for (const e of list) {
      const id = `${cid} ${e.name ?? JSON.stringify(e.v)}`;
      assert.ok(Object.keys(e).every((k) => known.includes(k)), `${id} 未知のキー`);
      assert.ok((typeof e.name === 'string' && e.name !== '') !== (e.v !== undefined), `${id} name か v のどちらか一方`);
      if (e.v) assert.ok(Object.keys(e.v).every((k) => ['L', 'M', 'H'].includes(k)) && Object.values(e.v).every((n) => typeof n === 'string' && n !== ''), `${id} v`);
      assert.ok(['P', 'K'].includes(e.button), `${id} button`);
      assert.ok(e.motion === null || isMotion(e.motion) || /^[1-9]$/.test(e.motion), `${id} motion=${e.motion}`);
      if (e.s !== undefined) assert.ok(!e.v && Array.isArray(e.s) && e.s.length > 0 && e.s.every((x) => STR.slice(0, 4).includes(x)), `${id} s`);
      if (e.air !== undefined) assert.equal(e.air, true, `${id} air`);
      if (e.follows) {
        // 派生: 親は同じキャラの項目に1つだけある。条件は強度の配列。必殺技形の motion でなければ通常技形（単一方向か null）
        assert.ok(Array.isArray(e.follows) && e.follows.length >= 1 && e.follows.length <= 2 && typeof e.follows[0] === 'string', `${id} follows`);
        const parents = list.filter((p) => (p.v ? Object.values(p.v) : [p.name]).includes(e.follows[0]));
        assert.equal(parents.length, 1, `${id} の親「${e.follows[0]}」は辞書内に1つだけある`);
        assert.notEqual(parents[0], e, `${id} 自分の派生`);
        if (e.follows[1] !== undefined) assert.ok(Array.isArray(e.follows[1]) && e.follows[1].length > 0 && e.follows[1].every((x) => STR.slice(0, 4).includes(x)), `${id} 親の条件`);
        // OD条件の親は、OD を出せる（強度別の項目でなく、通常技形の派生でもない）
        if (e.follows[1]?.includes('OD')) assert.ok(!parents[0].v && (parents[0].s ?? ['OD']).includes('OD') && (!parents[0].follows || isMotion(parents[0].motion)), `${id} OD条件の親`);
        // 通常技形の派生でODを表せないので、strengths に OD を持たない
        if (!isMotion(e.motion)) assert.ok(!(e.s ?? []).includes('OD'), `${id} 通常技形でOD`);
      } else {
        assert.ok(isMotion(e.motion), `${id} 単独の技は必殺技の motion`);
      }
    }
  }
});

test('辞書: 単独の技は、同じキャラ内で同じ入力・空中かの重複が実データの分かっている組だけ', () => {
  // 同じ入力に複数の技が当たるのは、ジェイミー（流酔拳と流酔脚、酔疾歩と疾歩仙掌）とザンギエフ（近距離と遠距離）だけ
  const dup = [];
  for (const [cid, list] of Object.entries(SPECIALS)) {
    const seen = new Map();
    for (const e of list.filter((x) => !x.follows)) {
      const k = `${e.motion.replace(/[[\]]/g, '')}${e.button}${e.air ? 'J' : ''}`;
      if (seen.has(k)) dup.push(`${cid} ${seen.get(k)}/${e.name ?? '強度別'}`);
      else seen.set(k, e.name ?? '強度別');
    }
  }
  assert.deepEqual(dup, ['jamie 流酔拳/流酔脚', 'jamie 酔疾歩/疾歩仙掌', 'zangief ロシアンスープレックス/シベリアンエクスプレス']);
});

test('辞書: URL・HTML・画像・説明文を含まず、30KB以内。出典と権利のコメントを持つ', () => {
  const src = readFileSync(new URL('../app/specials.js', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(src) <= 30 * 1024, `${Buffer.byteLength(src)} バイト`);
  assert.ok(!/https?:|www\.|<[a-zA-Z/!]|\.(png|jpe?g|gif|svg|webp)|src=|©|&[a-z]+;/i.test(src), 'URL・HTML・画像参照・©を含まない');
  const head = src.split('\n').slice(0, 3).join('\n');
  assert.ok(head.includes('Capcom') && head.includes('2026-10-16') && head.includes('権利') && head.includes('取り下げ'), '冒頭に出典・取得日・権利・取り下げ');
  assert.ok(!/import|fetch|require/.test(src), '外部ファイルを読み込まない');
  // 文字は技名とコマンドだけ（公式の説明文のような長い文はない）
  const longest = Math.max(...Object.values(SPECIALS).flat().flatMap((e) => (e.v ? Object.values(e.v) : [e.name])).map((n) => n.length));
  assert.ok(longest <= 16, `最長の技名 ${longest} 文字`);
});

// 辞書の中身の固定（技名とコマンドだけ）。形: 名前（強度別は 強度:名前 を／でつなぐ）|motion（方向なしは -）|button|s|air|親の技名（強度条件は :弱中強OD の記号）
const DICT_SNAPSHOT = {
  ryu: [
    '波動拳|236|P|||',
    '昇龍拳|623|P|||',
    '竜巻旋風脚|214|K|||',
    '空中竜巻旋風脚|214|K||air|',
    '上段足刀蹴り|236|K|||',
    '波掌撃|214|P|||',
    '電刃錬気|22|P|L,M,H||',
  ],
  luke: [
    'サンドブラスト|236|P|||',
    'フラッシュナックル|214|P|||',
    'エアフラッシュナックル|214|P||air|',
    'アベンジャー|236|K|||',
    'ノーチェイサー|-|P|||アベンジャー',
    'インパラー|-|K|||アベンジャー',
    'ライジングアッパー|623|P|||',
  ],
  jamie: [
    '魔身|22|P|L,M,H||',
    '流酔拳|236|P|||',
    '流酔脚|236|P|||',
    '酔疾歩|214|P|||',
    '張弓腿|623|K|||',
    '無影蹴|214|K||air|',
    '爆廻|236|K|||',
    '点辰|63214|K|||',
    '疾歩仙掌|214|P|||',
  ],
  chunli: [
    '気功拳|[4]6|P|||',
    '百裂脚|236|K|||',
    '空中百裂脚|236|K||air|',
    'スピニングバードキック|[2]8|K|||',
    '覇山蹴|214|K|||',
    '天昇脚|22|K|||',
  ],
  guile: [
    'ソニックブーム|[4]6|P|||',
    'サマーソルトキック|[2]8|K|||',
    'ソニックブレイド|214|P|||',
    'ソニッククロス|6|P|||ソニックブレイド',
  ],
  kimberly: [
    '武神旋風脚|214|K|||',
    '空中武神旋風脚|214|K||air|',
    '疾駆け|236|K|||',
    '急停止|-|P|||疾駆け',
    'L:胴刎ね/M:影すくい/H:首狩り|-|K|||疾駆け',
    '流転一文字|236|P|||',
    '彩隠形|214|P|||',
    '召雷細工|22|P|||',
    '細工手裏剣|22|P|||召雷細工',
    '荒鵺捻り|236|P||air|',
  ],
  juri: [
    '風破刃|214|K|||',
    'L:歳破衝/M:暗剣殺/H:五黄殺|236|K|||',
    '天穿輪|623|P|||',
    '疾空閃|214|K||air|',
    '死連閃|-|K|||疾空閃',
  ],
  ken: [
    '波動拳|236|P|||',
    '昇龍拳|623|P|||',
    '竜巻旋風脚|214|K|||',
    '空中竜巻旋風脚|214|K||air|',
    '龍尾脚|623|K|||',
    '迅雷脚|236|K|||',
    'L:風鎌蹴り/M:轟雷落とし/H:閃火脚|6|K|||迅雷脚',
  ],
  blanka: [
    'エレクトリックサンダー|214|P|||',
    'ローリングアタック|[4]6|P|||',
    'バーチカルローリング|[2]8|K|||',
    'バックステップローリング|63214|K|||',
    'エリアルローリング|[4]6|P||air|',
    'ワイルドハント|236|K|||',
    'ブランカちゃん爆弾|22|P|L,M,H||',
  ],
  dhalsim: [
    'ヨガファイア|236|P|||',
    'ヨガアーチ|236|K|||',
    'ヨガフレイム|63214|P|||',
    'ヨガブラスト|63214|K|||',
    'ヨガコメット|63214|P||air|',
  ],
  ehonda: [
    '百裂張り手|214|P|||',
    'スーパー頭突き|[4]6|P|||',
    'スーパー百貫落とし|[2]8|K|||',
    '大銀杏投げ|63214|K|||',
    '相撲ステップ|236|K|||',
    '鉄砲|-|P|||相撲ステップ',
    '大砲|2|P|||相撲ステップ',
    '猫だまし|22|P|L,M,H||',
    '肩屋入り|22|K|L,M,H||',
  ],
  deejay: [
    'エアスラッシャー|[4]6|P|||',
    'ジャックナイフマキシマム|[2]8|K|||',
    'L:フェイクロールステップ/M:クイックローリングソバット/H:ダブルローリングソバット|236|K|||',
    'マシンガンアッパー|214|P|||',
    'ジョスクール|214|K|||',
    'L:ファンキースライサー/M:ワニングムーン/H:マキシマムストライク|-|K|||ジョスクール',
    'ジャグリンステップ|6|P|||ジョスクール',
    'ジャグリンスウェイ|4|P|||ジャグリンステップ',
  ],
  manon: [
    'マネージュ・ドレ|63214|P|||',
    'ロン・ポワン|236|K|||',
    'デガジェ|214|K|||',
    'ランヴェルセ|236|P|||',
    'グラン・フェッテ|-|K|||ランヴェルセ',
  ],
  marisa: [
    'グラディウス|236|P|||',
    'ディマカイルス|214|P|||',
    'ファランクス|623|P|||',
    'クアドリガ|236|K|||',
    'スクトゥム|214|K|||',
    'トニトルス|-|P|||スクトゥム',
    'プロケッラ|-|K|||スクトゥム',
  ],
  jp: [
    'トリグラフ|22|P|||',
    'ストリボーグ|236|P|||',
    'ヴィーハト|214|P|||',
    'L:ヴィーハト・アクノ/M:ヴィーハト・アクノ/H:ヴィーハト・チェーニ|214|P|||ヴィーハト',
    'アムネジア|22|K|||',
    'トルバラン|236|K|||',
    'アブニマーチ|214|K|||',
  ],
  zangief: [
    'スクリューパイルドライバー|360|P|||',
    'ボルシチダイナマイト|360|K||air|',
    'ロシアンスープレックス|63214|K|||',
    'シベリアンエクスプレス|63214|K|||',
    'ツンドラストーム|22|K|H||',
  ],
  lily: [
    'コンドルウィンド|214|P|||',
    'コンドルスパイア|236|K|||',
    'トマホークバスター|623|P|||',
    'メキシカンタイフーン|360|P|||',
  ],
  cammy: [
    'スパイラルアロー|236|K|||',
    'キャノンスパイク|623|K|||',
    'アクセルスピンナックル|214|P|||',
    'キャノンストライク|214|K||air|',
    'フーリガンコンビネーション|236|P|||',
    'キャノンストライク|-|K|||フーリガンコンビネーション',
    'リバースエッジ|2|K|||フーリガンコンビネーション',
    'サイレントステップ|-|P|||フーリガンコンビネーション',
  ],
  rashid: [
    'スピニング・ミキサー|236|P|||',
    'イーグル・スパイク|214|K|||',
    'ワールウインド・ショット|236|K|||',
    'アラビアン・サイクロン|214|P|||',
    'ウイング・ストローク|4|K|||アラビアン・サイクロン',
    'アサルト・ロール|6|K|||アラビアン・サイクロン',
    'アサルト・ネイル|-|K|||アサルト・ロール',
    'アラビアン・スカイハイ|214|K||air|',
  ],
  aki: [
    'L:紫煙砲/M:紫泡泉/H:紫泡撒|214|P|||',
    '紫煙追|6|P|||紫煙砲:L',
    '蛇頭鞭|236|P|||',
    '凶襲突|214|K|||',
    '蛇軽功|236|K|||',
  ],
  ed: [
    'サイコスパーク|236|P|||',
    'サイコシュート|6|P|||サイコスパーク',
    'サイコアッパー|623|P|||',
    'サイコブリッツ|214|P|||',
    'サイコフリッカー|236|K|||',
  ],
  gouki_akuma: [
    '豪波動拳|236|P|||',
    '斬空波動拳|236|P||air|',
    '豪昇龍拳|623|P|||',
    '竜巻斬空脚|214|K|||',
    '空中竜巻斬空脚|214|K||air|',
    '金剛灼火|214|P|||',
    '百鬼襲|236|K|||',
    '百鬼豪衝|-|P|||百鬼襲',
    '百鬼豪刃|-|K|||百鬼襲',
    '百鬼豪斬空|236|P|||百鬼襲:OD',
    '百鬼豪螺旋|214|K|||百鬼襲:OD',
  ],
  vega_mbison: [
    'サイコクラッシャーアタック|[4]6|P|||',
    'ダブルニープレス|236|K|||',
    'バックフィストコンボ|214|P|||',
    'シャドウライズ|[2]8|K|||',
    'ヘッドプレス|-|K|||シャドウライズ',
    'サマーソルトスカルダイバー|-|P|||ヘッドプレス',
    'デビルリバース|-|P|||シャドウライズ',
  ],
  terry: [
    'L:パワーウェイブ/M:パワーウェイブ/H:ラウンドウェイブ|236|P|||',
    'L:クイックバーン/M:バーンナックル/H:バーンナックル|214|P|||',
    'パワーチャージ|236|K|||',
    'クラックシュート|214|K|||',
    'ライジングタックル|623|P|||',
  ],
  mai: [
    '花蝶扇|236|P|||',
    '乱れ花蝶扇|6|P|||花蝶扇:OD',
    '龍炎舞|214|P|||',
    '必殺忍蜂|236|K|||',
    '飛翔龍炎陣|623|K|||',
    'ムササビの舞|214|P||air|',
  ],
  elena: [
    'ライノホーン|236|K|||',
    'スクラッチホイール|623|K|||',
    'リンクシング|236|P|||',
    'L:レオパードスナップ/M:ハーベストサークル/H:マレットスマッシュ|6|K|||リンクシング',
    'リンクスワール|6|P|||リンクシング',
    'スピンサイズ|214|K|||',
    'リンクスワール|6|P|||スピンサイズ',
    'ムーングライド|214|P|||',
  ],
  sagat: [
    'L:グランドタイガーショット/M:タイガーショット/H:タイガーショット|236|P|||',
    'タイガーアッパーカット|623|P|||',
    'タイガーニークラッシュ|236|K|||',
    'タイガーネクサス|214|K|||',
    'L:タイガーマイト/M:タイガーグリード/H:タイガーノヴァ|6|K|||タイガーネクサス',
  ],
  cviper: [
    'サンダースラップ|214|P|||',
    'フェイント|-|K|||サンダースラップ',
    'バーニングキック|236|K|||',
    '空中バーニングキック|236|K||air|',
    'セイスモハンマー|623|P|||',
    'フェイント|-|K|||セイスモハンマー',
    'セービングフォース|214|K|||',
  ],
  alex: [
    'L:フラッシュアックス/M:フラッシュアックス/H:フラッシュチョップ|236|P|||',
    'エアニースマッシュ|623|K|||',
    'パワーボム|63214|P|||',
  ],
  ingrid: [
    'サンシュート|236|P|||',
    'サンフレア|214|P|||',
    'ソーラーフレア|214|P||air|',
    'サンライズ|236|K|||',
    'サンヴェール|22|K|||',
  ],
  yasmine: [
    'ダロイ・ン・トゥビグ|236|P|||',
    'アロン|6|P|||ダロイ・ン・トゥビグ',
    'タリム・ン・ハンギン|214|P|||',
    'ムカ・ン・ランギット|236|K|||',
    'ウラン|-|P|||ムカ・ン・ランギット',
    'クロッグ|-|K|||ムカ・ン・ランギット',
    'リパ・ン・アギラ|623|K|||',
    'パンギル・サ・リクラン|22|P|||',
  ],
  arjun: [
    '大義の巨腕|236|P|||',
    '追撃|6|P|||大義の巨腕',
    '厳酷な岩肩|623|P|||',
    '息吹の円筒|236|K|||',
    '息吹の震撼|6|P|||息吹の円筒',
    '神気の巨巌|214|K|||',
    '鬼気迫る尋問|63214|P|||',
    '不撓の警衛|22|K|H||',
    '倫理の崩壊|-|P|||不撓の警衛',
  ],
};
const dictLine = (e) => [e.v ? Object.entries(e.v).map(([k, n]) => `${k}:${n}`).join('/') : e.name, e.motion ?? '-', e.button, e.s ? e.s.join(',') : '', e.air ? 'air' : '',
  e.follows ? e.follows[0] + (e.follows[1] ? ':' + e.follows[1].join('') : '') : ''].join('|');

test('辞書: 件数（212項目 = 単独167 + 派生45。強度別の技名13、空中18）', () => {
  const all = Object.values(SPECIALS).flat();
  assert.deepEqual(
    { all: all.length, single: all.filter((e) => !e.follows).length, derived: all.filter((e) => e.follows).length, v: all.filter((e) => e.v).length, air: all.filter((e) => e.air).length },
    { all: 212, single: 167, derived: 45, v: 13, air: 18 });
});

test('辞書: キャラごとの技名・コマンド・強度・空中・親の一覧を固定する', () => {
  assert.deepEqual(Object.keys(SPECIALS), Object.keys(DICT_SNAPSHOT));
  for (const [cid, list] of Object.entries(DICT_SNAPSHOT)) assert.deepEqual(SPECIALS[cid].map(dictLine), list, cid);
});

test('辞書: 親が除外された派生は辞書にない（ガイルのソニックブレイク派生。ソニックブームのあとの5Pは通常技）', () => {
  assert.deepEqual(nameOf([sp('[4]6', 'P', 'M'), nm('P', 'N')], 'guile'), ['中ソニックブーム', null]);
  assert.ok(!SPECIALS.guile.some((e) => e.name?.startsWith('ソニックブレイク')));
});

test('技名: 派生の項目にODの接頭辞は付かない（OD百鬼襲 → 236 OD P は「百鬼豪斬空」）。JPのHは「ヴィーハト・チェーニ」', () => {
  assert.deepEqual(nameOf([sp('236', 'K', 'OD'), sp('236', 'P', 'OD')], 'gouki_akuma'), ['OD百鬼襲', '百鬼豪斬空']);
  assert.deepEqual(nameOf([sp('214', 'P', 'H'), sp('214', 'P', 'H')], 'jp'), ['強ヴィーハト', 'ヴィーハト・チェーニ']);
  assert.deepEqual(nameOf([sp('214', 'P', 'L'), sp('214', 'P', 'L')], 'jp'), ['弱ヴィーハト', 'ヴィーハト・アクノ']);
  for (const e of Object.values(SPECIALS).flat().filter((x) => x.follows)) assert.ok(!e.s?.includes('OD'), `${e.name ?? '強度別'} は派生でODを持たない`);
});

test('技名: ジェイミーの点辰は63214K（Pでは当たらない）', () => {
  assert.deepEqual(nameOf([sp('63214', 'K', 'M'), sp('63214', 'P', 'M')], 'jamie'), ['中点辰', 'unlisted']);
});

test('技名: 強度別の名前の派生は、強度なしでは単独の技へ落ちず「強さで変わる」（JP 214P 弱 ▶ 214P 強度なし）', () => {
  assert.deepEqual(nameOf([sp('214', 'P', 'L'), sp('214', 'P', 'N')], 'jp'), ['弱ヴィーハト', 'strength']);
  // 単独の技の強度なしは今までどおり技名だけ（親がなければ）
  assert.deepEqual(nameOf([sp('214', 'P', 'N')], 'jp'), ['ヴィーハト']);
});

test('候補: 方向キー5（motion "5"）で、方向なし（null）の派生が出る', () => {
  const c = specialCandidates({ characterId: 'luke', tokens: [sp('236', 'K', 'M')], motion: '5' });
  assert.deepEqual(c.map((x) => x.name), ['ノーチェイサー', 'インパラー']);
  // 方向キー5以外では、方向なしの派生は出ない（6で始まる単独の技だけ）
  assert.deepEqual(specialCandidates({ characterId: 'luke', tokens: [sp('236', 'K', 'M')], motion: '6' }).map((x) => x.name), ['ライジングアッパー']);
});
