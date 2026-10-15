import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTERS, PRESETS, NOTICE_TOO_LONG, applyPadInput, initialPadState, pendingMotion, isMotion, isValidToken, tokenLabel, describeRow, motionToArrows,
  validateDoc, parseDocText, exportDoc, mergeImport,
  SECTION_PRESETS, newId, isTime, addSection, renameSection, moveSection, deleteSection, sectionsOf,
  LIMITS, strengthChoices, changeStrength, recentTokens, tagCandidates, duplicateCombo, sanitizeDraft, isDamage, DAMAGE_MAX,
  exportFilename, dateText, daysSince, snoozeUntil, shouldRemindExport, NEON_STEPS, neonLevel,
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
