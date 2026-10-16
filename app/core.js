import { SPECIALS } from './specials.js';

// ===== SECTION: キャラクターマスタ =====
// キャラクターマスタ（D-010）。id＝公式URLのスラッグ、配列順＝公式の並び順。en＝看板の英字表記（design-spec-v2 2.4。日本版に合わせGOUKI・VEGA）。追加はここへ1行足すだけ。
export const CHARACTERS = [
  { id: 'ryu', en: 'RYU', name: 'リュウ' },
  { id: 'luke', en: 'LUKE', name: 'ルーク' },
  { id: 'jamie', en: 'JAMIE', name: 'ジェイミー' },
  { id: 'chunli', en: 'CHUN-LI', name: '春麗' },
  { id: 'guile', en: 'GUILE', name: 'ガイル' },
  { id: 'kimberly', en: 'KIMBERLY', name: 'キンバリー' },
  { id: 'juri', en: 'JURI', name: 'ジュリ' },
  { id: 'ken', en: 'KEN', name: 'ケン' },
  { id: 'blanka', en: 'BLANKA', name: 'ブランカ' },
  { id: 'dhalsim', en: 'DHALSIM', name: 'ダルシム' },
  { id: 'ehonda', en: 'E.HONDA', name: 'エドモンド本田' },
  { id: 'deejay', en: 'DEE JAY', name: 'ディージェイ' },
  { id: 'manon', en: 'MANON', name: 'マノン' },
  { id: 'marisa', en: 'MARISA', name: 'マリーザ' },
  { id: 'jp', en: 'JP', name: 'JP' },
  { id: 'zangief', en: 'ZANGIEF', name: 'ザンギエフ' },
  { id: 'lily', en: 'LILY', name: 'リリー' },
  { id: 'cammy', en: 'CAMMY', name: 'キャミィ' },
  { id: 'rashid', en: 'RASHID', name: 'ラシード' },
  { id: 'aki', en: 'A.K.I.', name: 'A.K.I.' },
  { id: 'ed', en: 'ED', name: 'ED' },
  { id: 'gouki_akuma', en: 'GOUKI', name: '豪鬼' },
  { id: 'vega_mbison', en: 'VEGA', name: 'ベガ' },
  { id: 'terry', en: 'TERRY', name: 'テリー' },
  { id: 'mai', en: 'MAI', name: '舞' },
  { id: 'elena', en: 'ELENA', name: 'エレナ' },
  { id: 'sagat', en: 'SAGAT', name: 'サガット' },
  { id: 'cviper', en: 'C.VIPER', name: 'C.ヴァイパー' },
  { id: 'alex', en: 'ALEX', name: 'アレックス' },
  { id: 'ingrid', en: 'INGRID', name: 'イングリッド' },
  { id: 'yasmine', en: 'YASMINE', name: 'ヤスミン' },
  { id: 'arjun', en: 'ARJUN', name: 'アルジュン' },
];

// ===== SECTION: ネオンの段階 =====
// 記録数に応じたキャラ選択の看板の点灯段階（design-spec-v2.1 1.1）。0件が0、70件以上が10。
export const NEON_STEPS = [1, 2, 3, 5, 8, 12, 18, 28, 45, 70];
export const neonLevel = (n) => NEON_STEPS.filter((t) => n >= t).length;

// ===== SECTION: トークン定義 =====
// トークンの種別は `type` で持つ（D-004）。dir は数値（1,3,4,6,7,8,9）、motion は文字列。
export const APP_ID = 'sf6-strategy-memo';
// D-013: 版2 = move・str:'N' を足した版。D-021: 版3 = 記録に任意の parentId（連携・分岐）を足した版。
// 読み込みは版1〜3（古い版は変換なしでそのまま有効。parentId は版3だけ）、書き出しは常に最新版。
export const SCHEMA_VERSION = 3;
export const PRESETS = ['236', '214', '623', '22', '63214', '[4]6', '[2]8', '360'];
export const SYSTEM_IDS = ['RAW_DR', 'CDR', 'DI', 'PARRY', 'REVERSAL'];
export const NOTE_IDS = ['CH', 'PC'];
export const MOVE_IDS = ['FWD_STEP', 'BACK_STEP'];
export const MOVE_NAMES = { FWD_STEP: '前ステ', BACK_STEP: 'バクステ' };
const STANCES = ['stand', 'crouch', 'jump'];
const DIRS = [1, 3, 4, 6, 7, 8, 9]; // 2（しゃがみ）と5（ニュートラル）はdirに持たない
const KEYS = ['P', 'K'];

// 仕様書の正規表現 ^(\[[1-9]\])?[1-9]{2,}$ は "[4]6" を弾くため、溜め入力は [d]d+ として許容する。
export const MOTION_MAX = 20;
export const isMotion = (m) =>
  typeof m === 'string' && m.length <= MOTION_MAX && (m === '360' || /^(\[[1-9]\][1-9]+|[1-9]{2,})$/.test(m));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// 未知のキー（余分なフィールド）を持たないこと。__proto__ をown propertyに持つJSONもここで弾かれる。
const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));

export function isValidToken(t) {
  if (!isObj(t)) return false;
  const btn = (strs) => KEYS.includes(t.key) && strs.includes(t.str);
  switch (t.type) {
    case 'normal': return onlyKeys(t, ['type', 'stance', 'dir', 'key', 'str']) && STANCES.includes(t.stance) && (t.dir === undefined || DIRS.includes(t.dir)) && btn(['L', 'M', 'H', 'N']);
    case 'special': return onlyKeys(t, ['type', 'motion', 'key', 'str', 'stance']) && isMotion(t.motion) && btn(['L', 'M', 'H', 'N', 'OD']) && (t.stance === undefined || t.stance === 'jump');
    case 'system': return onlyKeys(t, ['type', 'id']) && SYSTEM_IDS.includes(t.id);
    case 'sa': return onlyKeys(t, ['type', 'level']) && (t.level === 1 || t.level === 2 || t.level === 3);
    case 'note': return onlyKeys(t, ['type', 'id']) && NOTE_IDS.includes(t.id);
    case 'move': return onlyKeys(t, ['type', 'id']) && MOVE_IDS.includes(t.id);
    default: return false;
  }
}

// ===== SECTION: パッド入力の状態遷移 =====
// state: { tokens, cursor, pending: { stance, dirs }, notice }
// pending.dirs は押した順の入力（プリセット1個、または方向の数字）。motion は dirs.join('') で得る。
// action: { type: 'stance', value } | { type: 'preset', value } | { type: 'dir', value: 1-9 }
//   | { type: 'button', key: 'P'|'K', str: 'L'|'M'|'H'|'N'|'OD' } | { type: 'system', id } | { type: 'sa', level } | { type: 'move', id }
//   | { type: 'note', id } | { type: 'recent', token } | { type: 'undo' } | { type: 'cursor', index }
//   | { type: 'strength', index, value } | { type: 'remove', index }   （列のチップの強度変更・削除。index はトークン列の位置）
export const NOTICE_NEED_MOTION = '先にモーションを選んでください';
export const NOTICE_TOO_LONG = `方向は${MOTION_MAX}文字分までです`;

export function initialPadState(tokens = []) {
  return { tokens, cursor: tokens.length, pending: { stance: 'stand', dirs: [] }, notice: null };
}

export const pendingMotion = (pending) => pending.dirs.join('');

function insertAt(state, token) {
  const { tokens, cursor } = state;
  return {
    tokens: [...tokens.slice(0, cursor), token, ...tokens.slice(cursor)],
    cursor: cursor + 1,
    pending: { stance: 'stand', dirs: [] },
    notice: null,
  };
}

function confirmButton(state, { key, str }) {
  const { stance } = state.pending;
  const motion = pendingMotion(state.pending);
  if (!KEYS.includes(key) || !['L', 'M', 'H', 'N', 'OD'].includes(str)) throw new Error(`不正なボタン: ${key}${str}`);
  if (str === 'OD' && !isMotion(motion)) return { ...state, notice: NOTICE_NEED_MOTION };
  if (isMotion(motion)) {
    return insertAt(state, { type: 'special', motion, key, str, ...(stance === 'jump' && { stance }) });
  }
  const dir = motion === '' ? null : Number(motion);
  // 方向2のみはしゃがみに正規化（ジャンプ中は姿勢を優先）、5は修飾なし
  const crouch = dir === 2 && stance !== 'jump';
  return insertAt(state, {
    type: 'normal',
    stance: crouch ? 'crouch' : stance,
    ...(DIRS.includes(dir) && { dir }),
    key,
    str,
  });
}

function checkIndex(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.tokens.length) throw new Error(`不正なトークン位置: ${index}`);
}

// 強度の選択肢（チップのポップオーバー）: 通常技=弱中強＋強度なし(N)、必殺技=+OD、SA=1〜3、システム技・注記・移動は強度なし
export function strengthChoices(token) {
  switch (token.type) {
    case 'normal': return ['L', 'M', 'H', 'N'];
    case 'special': return ['L', 'M', 'H', 'N', 'OD'];
    case 'sa': return [1, 2, 3];
    default: return [];
  }
}

// 該当トークンの強度（SAはlevel）だけを置き換えた新しいトークンを返す。元は変更しない。
export function changeStrength(token, value) {
  if (!strengthChoices(token).includes(value)) throw new Error(`この技に指定できない強度: ${value}`);
  return token.type === 'sa' ? { ...token, level: value } : { ...token, str: value };
}

export function applyPadInput(state, action) {
  if (!isObj(action)) throw new Error('不正なactionです');
  const { pending } = state;
  const cleared = { ...state, notice: null };
  switch (action.type) {
    case 'stance':
      if (!STANCES.includes(action.value)) throw new Error(`不正な姿勢: ${action.value}`);
      return { ...cleared, pending: { ...pending, stance: pending.stance === action.value ? 'stand' : action.value } };
    case 'preset':
    case 'dir': {
      const v = String(action.value);
      if (action.type === 'preset' ? !PRESETS.includes(v) : !/^[1-9]$/.test(v)) throw new Error(`不正な入力: ${v}`);
      // 360 は連結できないので方向キーは置換になる
      const dirs = action.type === 'preset' || pending.dirs.at(-1) === '360' ? [v] : [...pending.dirs, v];
      if (dirs.join('').length > MOTION_MAX) return { ...state, notice: NOTICE_TOO_LONG };
      // ↓は保持する（undoが直前のpendingへ戻れるように）。モーションの確定時にspecialは↓を持たない
      return { ...cleared, pending: { ...pending, dirs } };
    }
    case 'button': return confirmButton(state, action);
    case 'system':
      if (!SYSTEM_IDS.includes(action.id)) throw new Error(`不正なシステム技: ${action.id}`);
      return insertAt(state, { type: 'system', id: action.id });
    case 'sa':
      if (![1, 2, 3].includes(action.level)) throw new Error(`不正なSA: ${action.level}`);
      return insertAt(state, { type: 'sa', level: action.level });
    case 'note':
      if (!NOTE_IDS.includes(action.id)) throw new Error(`不正な注記: ${action.id}`);
      return insertAt(state, { type: 'note', id: action.id });
    case 'move':
      if (!MOVE_IDS.includes(action.id)) throw new Error(`不正な移動: ${action.id}`);
      return insertAt(state, { type: 'move', id: action.id });
    case 'recent':
      if (!isValidToken(action.token)) throw new Error('不正なトークン');
      return insertAt(state, structuredClone(action.token));
    case 'undo':
      if (pending.dirs.length) return { ...cleared, pending: { ...pending, dirs: pending.dirs.slice(0, -1) } };
      if (pending.stance !== 'stand') return { ...cleared, pending: { ...pending, stance: 'stand' } };
      if (state.cursor === 0) return cleared;
      return {
        ...cleared,
        tokens: [...state.tokens.slice(0, state.cursor - 1), ...state.tokens.slice(state.cursor)],
        cursor: state.cursor - 1,
      };
    case 'cursor':
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > state.tokens.length) {
        throw new Error(`不正なカーソル位置: ${action.index}`);
      }
      return { ...cleared, cursor: action.index };
    case 'strength':
      checkIndex(state, action.index);
      return { ...cleared, tokens: state.tokens.map((t, i) => (i === action.index ? changeStrength(t, action.value) : t)) };
    case 'remove': {
      checkIndex(state, action.index);
      return {
        ...cleared,
        tokens: state.tokens.filter((_, i) => i !== action.index),
        cursor: state.cursor > action.index ? state.cursor - 1 : state.cursor,
      };
    }
    default:
      throw new Error(`不正なaction: ${action.type}`);
  }
}

// ===== SECTION: トークン表示 =====
const ARROWS = { 1: '↙', 2: '↓', 3: '↘', 4: '←', 5: 'ニュートラル', 6: '→', 7: '↖', 8: '↑', 9: '↗' };
export const MOTION_NAMES = { 236: '波動', 214: '竜巻', 623: '昇龍', 22: '下下', '[4]6': '溜め横', '[2]8': '溜め縦', 360: '一回転' };
const DIR_NAMES = { 1: '左下', 3: '右下', 4: '引き', 6: '前', 7: '左上', 8: '上', 9: '右上' };
const STANCE_NAMES = { stand: '立ち', crouch: '屈', jump: 'ジャンプ' };
const STR_NAMES = { L: '弱', M: '中', H: '強', N: '' }; // N=強度の指定なし（D-013）
const SYSTEM_NAMES = { RAW_DR: '生ラッシュ', CDR: 'CDR', DI: 'DI', PARRY: 'DP', REVERSAL: 'Dリバ' };

// "236" -> [{dir:'2',arrow:'↓',charge:false}, ...]、"[4]6" の4は charge:true、"360" は dir:'360' の1要素
export function motionToArrows(motion) {
  if (motion === '360') return [{ dir: '360', arrow: '↻', charge: false }];
  return [...motion.matchAll(/\[([1-9])\]|([1-9])/g)].map((m) => {
    const dir = m[1] ?? m[2];
    return { dir, arrow: ARROWS[dir], charge: m[1] !== undefined };
  });
}

function motionText(motion, notation) {
  if (notation === 'numpad') return motion;
  return motionToArrows(motion).map((a) => (a.charge ? `[${a.arrow}]` : a.arrow)).join('');
}

// aria用の日本語ラベル。例: 屈中K、立ち強P、波動 236 強P（arrow表示では 波動 ↓↘→ 強P）
export function tokenLabel(token, notation = 'arrow') {
  switch (token.type) {
    case 'normal': {
      const stance = token.stance === 'stand' && token.dir ? '' : STANCE_NAMES[token.stance];
      return `${stance}${DIR_NAMES[token.dir] ?? ''}${STR_NAMES[token.str]}${token.key}`;
    }
    case 'special': {
      const od = token.str === 'OD';
      return [
        token.stance === 'jump' ? 'ジャンプ' : null,
        od ? 'OD' : null,
        MOTION_NAMES[token.motion],
        motionText(token.motion, notation),
        od ? token.key : `${STR_NAMES[token.str]}${token.key}`,
      ].filter(Boolean).join(' ');
    }
    case 'system': return SYSTEM_NAMES[token.id];
    case 'sa': return `SA${token.level}`;
    case 'note': return token.id;
    case 'move': return MOVE_NAMES[token.id];
    default: throw new Error(`不正なトークン: ${token.type}`);
  }
}

// 表示記述子: { kind:'group', index, token, label, notes:[{id,index}] } と { kind:'conn' }（▶）の列。
// 注記は直後の行動に付くタグ。▶は行動のあるgroup同士の間にだけ入る。末尾に行動のない注記が残ればtoken:nullのgroupにする。
export function describeRow(tokens, notation = 'arrow') {
  const out = [];
  let notes = [];
  let hasAction = false;
  tokens.forEach((token, index) => {
    if (token.type === 'note') {
      notes.push({ id: token.id, index });
      return;
    }
    if (hasAction) out.push({ kind: 'conn' });
    out.push({ kind: 'group', index, token, label: tokenLabel(token, notation), notes });
    notes = [];
    hasAction = true;
  });
  if (notes.length) out.push({ kind: 'group', index: null, token: null, label: '', notes });
  return out;
}

// ===== SECTION: 必殺技の技名 =====
// 技名は保存せず、表示のたびに辞書（specials.js）から引く（D-017、docs/design-spec-v2.2.md 5章）。トークンの形は変えない。
// 辞書の項目: 必殺技 = follows なし、派生 = follows あり。親は同じキャラの項目を技名（強度別の v は値のどれか）で引く。
const LMH = ['L', 'M', 'H'];
const STR_PREFIX = { L: '弱', M: '中', H: '強', OD: 'OD' };
const norm = (m) => m.replace(/[[\]]/g, ''); // 溜めの［ ］を外して比べる
const entriesOf = (dict, characterId) => (Object.hasOwn(dict, characterId) ? dict[characterId] : []);
const namesOf = (e) => (e.v ? Object.values(e.v) : [e.name]);
// 入力できる強度。s の省略は、必殺技なら弱中強OD、派生なら強さの区別なし（空）
const strengthsOf = (e) => (e.v ? Object.keys(e.v) : e.s ?? (e.follows ? [] : [...LMH, 'OD']));
const normalDir = (t) => t.dir ?? (t.stance === 'crouch' ? 2 : 5);

/** そのキャラの技名の辞書があるか（なければ技名は常に「なし」） */
export const hasSpecials = (characterId) => entriesOf(SPECIALS, characterId).length > 0;

// 形の一致: 必殺技形（motion がモーション）は必殺技トークン、単一方向・null は通常技トークン（ジャンプは当たらない）
function shapeMatches(e, t) {
  if (t.key !== e.button) return false;
  if (isMotion(e.motion)) return t.type === 'special' && norm(t.motion) === norm(e.motion) && (t.stance === 'jump') === Boolean(e.air);
  return t.type === 'normal' && t.stance !== 'jump' && !e.air && normalDir(t) === (e.motion === null ? 5 : Number(e.motion));
}

// 強度 str のときの技名。null = 当たらない、'strength' = 強度なしでは名前が決まらない（強度別の名前がある技）
function nameFor(e, str) {
  if (e.v) return str === 'N' ? 'strength' : e.v[str] ?? null;
  return str === 'N' || (e.follows && !e.s) || strengthsOf(e).includes(str) ? e.name : null;
}

// 接頭辞: 弱中強の区別がある技（2つ以上）だけ弱/中/強、OD版がある技だけOD。強度別の名前の技・強度なしは付けない
function prefixOf(e, str) {
  if (e.v || str === 'N') return '';
  if (str === 'OD') return strengthsOf(e).includes('OD') ? 'OD' : '';
  return strengthsOf(e).filter((s) => s !== 'OD').length > 1 ? STR_PREFIX[str] : '';
}

// 親の強度条件（cond 省略 = 何でもよい）。強度なしの親は、条件が弱中強をすべて含むときだけ
const parentStrOk = (cond, str) => !cond || (str === 'N' ? LMH.every((s) => cond.includes(s)) : cond.includes(str));
// 派生 e の親が、直前の行動 prev（{ entry, token }）か
const followsPrev = (entries, e, prev) =>
  entries.find((p) => namesOf(p).includes(e.follows[0])) === prev.entry && parentStrOk(e.follows[1], prev.token.str);

// 1つの行動トークンを判定する。結果: null（通常技などで技名を付けない）または { entry, name, base, derived, parent, why, choices }
// name = 接頭辞つきの技名、base = 接頭辞なし、why = 名前がない理由（'unlisted' 一覧にない | 'multi' 複数 | 'strength' 強さで変わる）
function judge(entries, token, prev) {
  const hits = [];
  let blocked = false;
  const consider = (e) => {
    if (!shapeMatches(e, token)) return;
    const n = nameFor(e, token.str);
    if (n === 'strength') blocked = true;
    else if (n) hits.push(e);
  };
  if (prev) entries.filter((e) => e.follows && followsPrev(entries, e, prev)).forEach(consider);
  // 強度別の名前の派生が強度なしで決まらないときは、同じ形の単独の技へ落とさない（5章5）
  if (!hits.length && !blocked && token.type === 'special') entries.filter((e) => !e.follows).forEach(consider);
  if (hits.length > 1) return { entry: null, name: null, base: null, derived: false, parent: null, why: 'multi', choices: hits.map((e) => nameFor(e, token.str)) };
  if (hits.length === 0) {
    if (blocked) return { entry: null, name: null, base: null, derived: false, parent: null, why: 'strength', choices: null };
    return token.type === 'special' ? { entry: null, name: null, base: null, derived: false, parent: null, why: 'unlisted', choices: null } : null;
  }
  const [e] = hits;
  const base = nameFor(e, token.str);
  return { entry: e, name: prefixOf(e, token.str) + base, base, derived: Boolean(e.follows), parent: e.follows ? prev.base : null, why: null, choices: null };
}

/**
 * 記録1件のトークン列を先頭から判定する（5章）。tokens と同じ長さの配列で、各要素は
 * null（注記・移動・システム技・SA・技名を付けない通常技）または
 * { name, base, derived, parent, why, choices, entry }。name は接頭辞つきの技名（弱/中/強/OD + 技名）、
 * なければ null（why: 'unlisted' 一覧にない | 'multi' 複数の技（choices に技名）| 'strength' 強さで変わる）。
 * derived のとき parent は親の技名。entry は辞書の項目（内部用）。辞書のないキャラは全部 null。dict はテスト用。
 */
export function specialNames(tokens, characterId, dict = SPECIALS) {
  const entries = entriesOf(dict, characterId);
  let prev = null; // 直前の行動の判定結果。注記は飛ばし、移動・システム技・SA・技名のない行動のあとは null（派生は成り立たない）
  return tokens.map((token) => {
    if (token.type === 'note') return null;
    const r = entries.length && (token.type === 'special' || token.type === 'normal') ? judge(entries, token, prev) : null;
    prev = r?.entry ? { entry: r.entry, token, base: r.base } : null;
    return r;
  });
}

/**
 * 編集パッドR1の候補（1章）。tokens と cursor はカーソルの直前の行動を決めるため、motion は入力中の方向（pendingMotion）、
 * jump はジャンプ選択中か。派生（先頭）、次に入力と一致する技、次に入力で始まる技の順。方向なしなら派生と全必殺技（辞書の順）。
 * ジャンプ中は空中の技だけ。要素: { name, motion, button, air, derived, parent, instant }
 * name は強度別の名前の技なら「／」でつないだ全名。instant は、強さの区別がない派生を押した時点で入れるトークン（それ以外は null）。
 */
export function specialCandidates({ characterId, tokens = [], cursor = tokens.length, motion = '', jump = false }, dict = SPECIALS) {
  const entries = entriesOf(dict, characterId);
  const names = specialNames(tokens.slice(0, cursor), characterId, dict);
  const at = tokens.slice(0, cursor).findLastIndex((t) => t.type !== 'note');
  const prev = at >= 0 && names[at]?.entry ? { entry: names[at].entry, token: tokens[at], base: names[at].base } : null;
  const input = norm(motion);
  const starts = (e) => (isMotion(e.motion) ? (e.motion === '360' ? norm(e.motion) === input : norm(e.motion).startsWith(input)) : (e.motion ?? '5') === input); // 方向なし（null）は5
  const usable = entries.filter((e) => !jump || e.air);
  const derived = prev ? usable.filter((e) => e.follows && followsPrev(entries, e, prev) && (!input || starts(e))) : [];
  const own = usable.filter((e) => !e.follows);
  const list = input
    ? [...derived, ...own.filter((e) => norm(e.motion) === input), ...own.filter((e) => norm(e.motion) !== input && e.motion !== '360' && norm(e.motion).startsWith(input))]
    : [...derived, ...own];
  return list.map((e) => ({
    name: [...new Set(namesOf(e))].join('／'),
    motion: e.motion,
    button: e.button,
    air: Boolean(e.air),
    derived: Boolean(e.follows),
    parent: e.follows ? prev.base : null,
    instant: e.follows && !e.v && strengthsOf(e).length <= 1 ? instantToken(e) : null,
  }));
}

// 強さの区別がない派生（s なしは強度なし、1つだけならその値）の、押した時点で入れるトークン
function instantToken(e) {
  const str = strengthsOf(e)[0] ?? 'N';
  if (isMotion(e.motion)) return { type: 'special', motion: e.motion, key: e.button, str, ...(e.air && { stance: 'jump' }) };
  const dir = e.motion === null ? null : Number(e.motion);
  return { type: 'normal', stance: dir === 2 ? 'crouch' : 'stand', ...(DIRS.includes(dir) && { dir }), key: e.button, str };
}

/**
 * 読み上げ名（4章）。mode は 'name'（技名を先に）か 'cmd'（コマンドを先に）。info は specialNames の要素。
 * 技名がなければ tokenLabel と同じ。例: 技名表示「中波動拳、波動 ↓↘→ 中P」、派生「追撃、大義の巨腕の派生、前P」
 */
export function specialLabel(token, info, mode, notation = 'arrow') {
  const cmd = tokenLabel(token, notation);
  if (!info?.name) return cmd;
  const parts = [info.name, info.derived ? `${info.parent}の派生` : null];
  return (mode === 'name' ? [...parts, cmd] : [cmd, ...parts]).filter(Boolean).join('、');
}

/** 候補の読み上げ名。例: 「昇龍拳、昇龍 →↓↘ P」、派生は「追撃、大義の巨腕の派生、→ P」 */
export function candidateLabel(c, notation = 'arrow') {
  const dir = c.motion === null ? '' : isMotion(c.motion) ? `${MOTION_NAMES[c.motion] ?? ''} ${motionText(c.motion, notation)}` : notation === 'numpad' ? c.motion : ARROWS[c.motion];
  const cmd = [c.air ? 'ジャンプ' : null, dir.trim() || null, c.button].filter(Boolean).join(' ');
  return [c.name, c.derived ? `${c.parent}の派生` : null, cmd].filter(Boolean).join('、');
}

// 「必殺技の表記」の設定（sf6memo.settings の specialNotation）。cmd = コマンド、name = 技名。表記は保存せず、記録のトークンは変えない。
export const SPECIAL_NOTATIONS = ['cmd', 'name'];
export const DEFAULT_SPECIAL_NOTATION = 'cmd';
export const sanitizeSpecialNotation = (v) => (SPECIAL_NOTATIONS.includes(v) ? v : DEFAULT_SPECIAL_NOTATION);

// ===== SECTION: 文書の検証 =====
// ponytail: 上限値は個人利用の目安。実データで足りなくなったら調整する。
// depth = 連携・分岐の深さの上限（根を0とする。D-021）、children = 1つの親の直下の子を追加できる上限（追加時の addChildBlock だけが守る。検証は見ない）。
export const LIMITS = { sections: 1000, combos: 10000, tokens: 200, tags: 20, name: 50, title: 100, tag: 30, memo: 2000, depth: 3, children: 8 };
const COMBO_KEYS = ['id', 'characterId', 'controlType', 'sectionId', 'title', 'position', 'tokens', 'memo', 'tags', 'favorite', 'createdAt', 'updatedAt', 'damage', 'parentId'];
const POSITIONS = ['any', 'corner', 'midscreen'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isStr = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
// 上限は Date の最大値（8.64e15）。これを超えると new Date(t) が Invalid Date になり、dateText・hhmm が NaN になる
export const TIME_MAX = 8.64e15;
export const isTime = (v) => Number.isSafeInteger(v) && v >= 0 && v <= TIME_MAX;
const isName = (v, max) => isStr(v, max, 1) && v.trim() !== ''; // 空白のみは不可
export const DAMAGE_MAX = 99999;
// damage は任意（D-012）。キーがあるときだけ 0〜99999 の整数。未入力はキー自体を持たない。
export const isDamage = (v) => Number.isInteger(v) && v >= 0 && v <= DAMAGE_MAX;
const isCharacter = (v) => CHARACTERS.some((c) => c.id === v);

function docProblem(doc) {
  if (!isObj(doc)) return '文書がオブジェクトではありません';
  if (doc.app !== APP_ID) return 'このアプリの書き出しファイルではありません(appが一致しません)';
  const v = doc.schemaVersion;
  if (v === undefined) return 'schemaVersionがありません';
  if (!Number.isInteger(v) || v < 1) return 'schemaVersionが不正です';
  if (v > SCHEMA_VERSION) return `新しい版(schemaVersion ${v})のデータです。アプリを更新してください`; // 版1〜3は受け付ける（変換なしで有効）
  for (const list of ['sections', 'combos']) {
    if (!Array.isArray(doc[list])) return `${list}が配列ではありません`;
    if (doc[list].length > LIMITS[list]) return `${list}が多すぎます(上限${LIMITS[list]}件)`;
  }
  if (!onlyKeys(doc, ['app', 'schemaVersion', 'sections', 'combos'])) return '文書に未対応の項目があります';

  const sectionChar = new Map();
  for (const [i, s] of doc.sections.entries()) {
    if (isObj(s) && !onlyKeys(s, ['id', 'characterId', 'name', 'order', 'updatedAt'])) return `${i + 1}件目のsectionsに未対応の項目があります`;
    const bad = isObj(s) && [
      ['id', isId(s.id)],
      ['characterId', isCharacter(s.characterId)],
      ['name', isName(s.name, LIMITS.name)],
      ['order', Number.isSafeInteger(s.order) && s.order >= 0],
      ['updatedAt', isTime(s.updatedAt)],
    ].find(([, ok]) => !ok);
    if (!isObj(s) || bad) return `${i + 1}件目のsectionsの${bad ? bad[0] : '形式'}が不正です`;
    if (sectionChar.has(s.id)) return `sectionsのidが重複しています`;
    sectionChar.set(s.id, s.characterId);
  }

  const byId = new Map();
  const comboKeys = v >= 3 ? COMBO_KEYS : COMBO_KEYS.filter((k) => k !== 'parentId'); // parentId は版3から
  for (const [i, c] of doc.combos.entries()) {
    if (isObj(c) && !onlyKeys(c, comboKeys)) return `${i + 1}件目のcombosに未対応の項目があります`;
    const bad = isObj(c) && [
      ['id', isId(c.id)],
      ['characterId', isCharacter(c.characterId)],
      ['controlType', c.controlType === 'classic'],
      ['sectionId', sectionChar.has(c.sectionId) && sectionChar.get(c.sectionId) === c.characterId],
      ['title', isStr(c.title, LIMITS.title)],
      ['position', POSITIONS.includes(c.position)],
      ['tokens', Array.isArray(c.tokens) && c.tokens.length <= LIMITS.tokens && c.tokens.every(isValidToken)],
      ['memo', isStr(c.memo, LIMITS.memo)],
      ['tags', Array.isArray(c.tags) && c.tags.length <= LIMITS.tags && c.tags.every((t) => isName(t, LIMITS.tag))],
      ['favorite', typeof c.favorite === 'boolean'],
      ['createdAt', isTime(c.createdAt)],
      ['updatedAt', isTime(c.updatedAt) && c.updatedAt >= c.createdAt],
      ['damage', !Object.hasOwn(c, 'damage') || isDamage(c.damage)],
      ['parentId', !Object.hasOwn(c, 'parentId') || isId(c.parentId)],
    ].find(([, ok]) => !ok);
    if (!isObj(c) || bad) return `${i + 1}件目のcombosの${bad ? bad[0] : '形式'}が不正です`;
    if (byId.has(c.id)) return `combosのidが重複しています`;
    byId.set(c.id, c);
  }

  // 連携・分岐（D-021）: 親は同じキャラ・セクション・controlType、深さは根を0として LIMITS.depth 以下。子の個数は見ない（2端末のマージで9個以上になりうる。上限は追加時だけ）。
  // 親は配列の後ろにあってよいので、全件の登録後に調べる。深さの上限があるので、親を最大 LIMITS.depth+1 回たどれば足り、循環もここで拒否される（全体で線形）。
  for (const [i, c] of doc.combos.entries()) {
    if (c.parentId === undefined) continue;
    const bad = (why) => `${i + 1}件目のcombosのparentIdが不正です(${why})`;
    const p = byId.get(c.parentId);
    if (!p) return bad('親がありません');
    if (p.sectionId !== c.sectionId) return bad('親とセクションが違います'); // セクションは1キャラのもので、controlType は classic だけなので、同キャラ・同controlType もこれで保証される
    let depth = 0;
    for (let cur = c; cur.parentId !== undefined; cur = byId.get(cur.parentId)) {
      if (++depth > LIMITS.depth || !byId.has(cur.parentId)) return bad(`深さは${LIMITS.depth}までで、循環もできません`);
    }
  }
  return null;
}

// 例外を投げず { ok: true } または { ok: false, reason } を返す
export function validateDoc(doc) {
  const reason = docProblem(doc);
  return reason ? { ok: false, reason } : { ok: true };
}

// JSON文字列を検証して { ok: true, doc } または { ok: false, reason } を返す
export function parseDocText(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSONとして読めません' };
  }
  const result = validateDoc(doc);
  return result.ok ? { ok: true, doc } : result;
}

// ===== SECTION: セクション操作 =====
// すべて純粋関数。入力の state（{ sections, combos }）は変更せず、validateDoc を通る新しい state を返す。
// 不正な引数は例外、削除だけは UI が理由を表示できるよう { ok, state | reason } を返す。now はエポックミリ秒。
export const SECTION_PRESETS = ['通常', 'カウンター', 'パニッシュカウンター', 'インパクト壁やられ', 'スタン', '画面端', '起き攻め'];
export const SECTION_NAME_MAX = LIMITS.name;
// 128ビットの乱数の16進32文字（ID_RE を満たす）。randomUUID は secure context 限定なので使わない
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export const sectionsOf = (state, characterId) =>
  state.sections.filter((s) => s.characterId === characterId).sort((a, b) => a.order - b.order);

function checkName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || n.length > SECTION_NAME_MAX) throw new Error(`セクション名は1〜${SECTION_NAME_MAX}文字です`);
  return n;
}

function findSection(state, sectionId) {
  const s = state.sections.find((x) => x.id === sectionId);
  if (!s) throw new Error('セクションが見つかりません');
  return s;
}

// 同じキャラのセクションを orderedIds の順に order=0.. と詰め直す（値が変わったものだけ updatedAt を更新）
function repack(sections, orderedIds, now) {
  return sections.map((s) => {
    const order = orderedIds.indexOf(s.id);
    return order === -1 || s.order === order ? s : { ...s, order, updatedAt: now };
  });
}

export function addSection(state, characterId, name, now) {
  if (!CHARACTERS.some((c) => c.id === characterId)) throw new Error('不正なキャラクターです');
  const mine = sectionsOf(state, characterId);
  const section = { id: newId(), characterId, name: checkName(name), order: mine.length ? mine.at(-1).order + 1 : 0, updatedAt: now };
  return { sections: [...state.sections, section], combos: state.combos };
}

export function renameSection(state, sectionId, name, now) {
  findSection(state, sectionId);
  const n = checkName(name);
  return { sections: state.sections.map((s) => (s.id === sectionId ? { ...s, name: n, updatedAt: now } : s)), combos: state.combos };
}

// delta=-1 で上へ、+1 で下へ。端を越える移動は何もしない（同じ state を返す）。
export function moveSection(state, sectionId, delta, now) {
  if (!Number.isInteger(delta)) throw new Error('不正な移動量です');
  const ids = sectionsOf(state, findSection(state, sectionId).characterId).map((s) => s.id);
  const from = ids.indexOf(sectionId);
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (to === from) return state;
  ids.splice(to, 0, ...ids.splice(from, 1));
  return { sections: repack(state.sections, ids, now), combos: state.combos };
}

// 中身がある場合は同じキャラの別セクション moveToId が必須。他にセクションがなければ削除不可（D-005）。
export function deleteSection(state, sectionId, moveToId, now) {
  const target = state.sections.find((s) => s.id === sectionId);
  if (!target) return { ok: false, reason: 'セクションが見つかりません' };
  const rest = sectionsOf(state, target.characterId).filter((s) => s.id !== sectionId);
  const hasItems = state.combos.some((c) => c.sectionId === sectionId);
  if (hasItems && !rest.length) return { ok: false, reason: '他にセクションがないため削除できません。先に別のセクションを作ってください' };
  if (hasItems && !rest.some((s) => s.id === moveToId)) return { ok: false, reason: '移動先を選んでください' };
  const ids = rest.map((s) => s.id);
  return {
    ok: true,
    state: {
      sections: repack(state.sections.filter((s) => s.id !== sectionId), ids, now),
      combos: hasItems ? state.combos.map((c) => (c.sectionId === sectionId ? { ...c, sectionId: moveToId, updatedAt: Math.max(now, c.createdAt) } : c)) : state.combos,
    },
  };
}

// ===== SECTION: 連携・分岐（D-021） =====
// 記録の parentId で木を作る。parentId のない記録が根（従来のコンボ）、あるものが連携・分岐。木の整合は validateDoc が保証する。
// 兄弟の並びは createdAt の昇順、同じなら id の順（position は画面位置 any/corner/midscreen の列挙で順序を持たないため使わない）。新しい子は nextChildCreatedAt で末尾に並ぶ。
// 以下の関数は combos（state.combos）を受け取り、入力を変更しない。件数のうち、キャラ選択・neonLevel・読み上げ名は連携・分岐も含む combos 全体の数、
// セクションの帯と削除シートの件数は rootCount（一覧に出す行の数）、セクションの全件は comboCount。
const compareSiblings = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const childMap = (combos) => {
  const m = new Map();
  for (const c of combos) if (c.parentId !== undefined) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
  for (const list of m.values()) list.sort(compareSiblings);
  return m;
};

/** セクションの一覧に出す記録（根）。並びは配列の順 */
export const rootsOf = (combos, sectionId) => combos.filter((c) => c.sectionId === sectionId && c.parentId === undefined);

/** セクションの帯の「N件」・削除シートの件数: 一覧に出す行（根）の数 */
export const rootCount = (combos, sectionId) => rootsOf(combos, sectionId).length;

/** セクションの全件数（連携・分岐を含む） */
export const comboCount = (combos, sectionId) => combos.filter((c) => c.sectionId === sectionId).length;

/** 直下の子（createdAt の昇順、同じなら id の順） */
export const childrenOf = (combos, id) => childMap(combos).get(id) ?? [];

/** 子孫を先行順（親→子、兄弟は childrenOf の順）に並べた [{ combo, depth }]。depth は id の記録から数え、直下の子が1。id 自身は含まない */
export function descendantTree(combos, id) {
  const kids = childMap(combos);
  const out = [];
  const seen = new Set([id]); // 不正な入力（循環）でも止まる
  const stack = (kids.get(id) ?? []).map((combo) => ({ combo, depth: 1 })).reverse();
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n.combo.id)) continue;
    seen.add(n.combo.id);
    out.push(n);
    for (const combo of [...(kids.get(n.combo.id) ?? [])].reverse()) stack.push({ combo, depth: n.depth + 1 });
  }
  return out;
}

/** 子孫の件数（削除の確認文に使う） */
export const countDescendants = (combos, id) => descendantTree(combos, id).length;

/** id の記録の下に新しい連携・分岐を足せない理由。足せるなら null、深さの上限（その記録の深さが LIMITS.depth 以上）なら 'depth'、
 *  直下の子が LIMITS.children 個以上なら 'siblings'、記録がなければ 'missing'。連携・分岐の複製の可否は、その親の id で調べる */
export function addChildBlock(combos, id) {
  const byId = new Map(combos.map((c) => [c.id, c]));
  const c = byId.get(id);
  if (!c) return 'missing';
  let depth = 0;
  for (let cur = c; cur.parentId !== undefined; cur = byId.get(cur.parentId)) if (++depth >= LIMITS.depth) return 'depth';
  return combos.filter((x) => x.parentId === id).length >= LIMITS.children ? 'siblings' : null;
}

/** 新しい連携・分岐の createdAt（updatedAt にも使う）: 兄弟の最後に並ぶよう、now と、兄弟の最大の createdAt+1 の大きい方 */
export const nextChildCreatedAt = (combos, parentId, now) =>
  combos.reduce((t, c) => (c.parentId === parentId ? Math.max(t, c.createdAt + 1) : t), now);

/** 新しい連携・分岐の記録を作る。sectionId・characterId・controlType は親の値、favorite は false、position は 'any'、createdAt は nextChildCreatedAt。
 *  fields は { title, tokens, memo, tags, damage? }（省略は空）。足せない親（addChildBlock が null でない）なら例外。state.combos の末尾に足す */
export function newChildCombo(combos, parentId, fields, now) {
  const block = addChildBlock(combos, parentId);
  if (block) throw new Error({ missing: 'つなぐ元の記録が見つかりません', depth: '分岐は3段目までです', siblings: `分岐は${LIMITS.children}個までです` }[block]);
  const p = combos.find((c) => c.id === parentId);
  const { title = '', tokens = [], memo = '', tags = [], damage } = fields ?? {};
  const t = nextChildCreatedAt(combos, parentId, now);
  return {
    id: newId(), characterId: p.characterId, controlType: p.controlType, sectionId: p.sectionId, title, position: 'any',
    tokens, memo, tags, favorite: false, createdAt: t, updatedAt: t, ...(damage !== undefined && { damage }), parentId,
  };
}

/** 記録を子孫ごと削除した新しい state。元の state は変えない（取り消しは呼び出し側が持つ削除前の state を書き戻す）。記録がなければ例外 */
export function deleteCombo(state, id) {
  if (!state.combos.some((c) => c.id === id)) throw new Error('記録が見つかりません');
  const gone = new Set([id, ...descendantTree(state.combos, id).map((n) => n.combo.id)]);
  return { sections: state.sections, combos: state.combos.filter((c) => !gone.has(c.id)) };
}

/** 記録を子孫ごと新しい id で複製した配列（先頭が複製した記録。createdAt・updatedAt は now）。子孫は parentId を新しい id に付け替え、
 *  タイトルと createdAt・position は元のまま（兄弟の順序が保たれる）、updatedAt だけ now（createdAt より前にならないよう max）。
 *  連携・分岐の複製は同じ親の下の兄弟になるので、親の子が上限なら例外。呼び出し側は state.combos の末尾に足す */
export function duplicateTree(combos, id, now) {
  const src = combos.find((c) => c.id === id);
  if (!src) throw new Error('記録が見つかりません');
  if (src.parentId !== undefined && addChildBlock(combos, src.parentId) !== null) throw new Error('連携・分岐の数が上限のため複製できません');
  const copy = duplicateCombo(src, now);
  const ids = new Map([[id, copy.id]]);
  const out = [copy];
  for (const { combo } of descendantTree(combos, id)) { // 先行順なので親の新しい id は決まっている
    const d = { ...duplicateCombo(combo, now), title: combo.title, createdAt: combo.createdAt, updatedAt: Math.max(now, combo.createdAt), parentId: ids.get(combo.parentId) };
    ids.set(combo.id, d.id);
    out.push(d);
  }
  return out;
}

/** 根を同じキャラの別セクションへ、子孫ごと移した新しい state。連携・分岐だけの移動は例外（根と別のセクションになるため） */
export function moveCombo(state, id, sectionId, now) {
  const c = state.combos.find((x) => x.id === id);
  if (!c) throw new Error('記録が見つかりません');
  if (c.parentId !== undefined) throw new Error('連携・分岐だけを別のセクションへ移すことはできません');
  if (findSection(state, sectionId).characterId !== c.characterId) throw new Error('別のキャラクターのセクションには移せません');
  if (c.sectionId === sectionId) return state;
  const moved = new Set([id, ...descendantTree(state.combos, id).map((n) => n.combo.id)]);
  return { sections: state.sections, combos: state.combos.map((x) => (moved.has(x.id) ? { ...x, sectionId, updatedAt: Math.max(now, x.createdAt) } : x)) };
}

// ===== SECTION: 編集画面の補助 =====
// 直近の技（パッドの上段）: そのキャラの保存済み記録から、新しい記録の後ろの技から順に、重複と注記を除いて最大 limit 件。
export function recentTokens(combos, characterId, limit = 8) {
  const seen = new Set();
  const out = [];
  const mine = combos.filter((c) => c.characterId === characterId).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  for (const c of mine) {
    for (const t of [...c.tokens].reverse()) {
      if (t.type === 'note') continue;
      const k = tokenLabel(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(structuredClone(t));
      if (out.length === limit) return out;
    }
  }
  return out;
}

// タグの候補: そのキャラの使用済みタグ（多い順）、続けて他キャラのタグ。既定の候補は持たない（D-005）。
export function tagCandidates(combos, characterId) {
  const rank = (list) => {
    const count = new Map();
    for (const c of list) for (const t of c.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  };
  const mine = rank(combos.filter((c) => c.characterId === characterId));
  return [...mine, ...rank(combos.filter((c) => c.characterId !== characterId)).filter((t) => !mine.includes(t))];
}

// 複製: 同じセクションに、新しいid・日時で。タイトルは「（元）のコピー」（上限を超えるときは元の側を削る）。1件だけの複製で、子孫は複製しない（子孫ごとは duplicateTree）。
export function duplicateCombo(combo, now) {
  const suffix = 'のコピー';
  return {
    ...structuredClone(combo),
    id: newId(),
    title: combo.title ? `${combo.title.slice(0, LIMITS.title - suffix.length)}${suffix}` : 'コピー',
    createdAt: now,
    updatedAt: now,
  };
}

// localStorage の下書き（外部由来の値）を、編集画面に使える形へ整える。
// 主項目の tokens が配列でなければ壊れた下書きとして捨てる（null）。ほかの項目は、形が違えば fresh（新規または保存済みの値）を使う。
export function sanitizeDraft(raw, fresh = { sectionId: null, title: '', position: 'any', memo: '', tags: [] }) {
  if (!isObj(raw) || !Array.isArray(raw.tokens)) return null;
  const str = (v, max, d) => (typeof v === 'string' ? v.slice(0, max) : d);
  return {
    sectionId: typeof raw.sectionId === 'string' ? raw.sectionId : fresh.sectionId,
    title: str(raw.title, LIMITS.title, fresh.title),
    position: POSITIONS.includes(raw.position) ? raw.position : fresh.position,
    tokens: raw.tokens.filter(isValidToken).slice(0, LIMITS.tokens),
    memo: str(raw.memo, LIMITS.memo, fresh.memo),
    ...(isDamage(raw.damage) && { damage: raw.damage }),
    ...(isId(raw.parentId) && { parentId: raw.parentId }), // 新しい連携・分岐の下書き。親の存在は呼び出し側が確かめる
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => t.slice(0, LIMITS.tag)).slice(0, LIMITS.tags)
      : fresh.tags,
    savedAt: isTime(raw.savedAt) ? raw.savedAt : null,
  };
}

// ===== SECTION: 書き出しと取り込み =====
// state: { sections, combos }。書き出し文書は state に app と schemaVersion を足したもの。
export function exportDoc(state) {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, ...structuredClone({ sections: state.sections, combos: state.combos }) };
}

// D-006: id一致は updatedAt の新しい方、同時刻は端末側。端末のみの記録は残す。入力は変更しない。
// マージは記録単位なので、親子の整合（D-021）のうち同セクションだけは混ざりうる（片方の端末が根を木ごと別セクションへ移し、もう片方が子だけを編集した）。
// 根の移動は常に木ごとで、子の sectionId は表示に使わないので、根を正として子の sectionId を合わせる。子の個数は検証しない（9個以上になりうる）。
// parentId は編集できないので、深さや循環はマージで新しく生まれない（手書きの JSON だけ）。
// マージ結果も validateDoc に通し、崩れる場合は取り込み全体を { ok: false, reason } で拒否する。「N件目」はマージ後の配列の番号で読めないので、固定文にする。
// 成功時は { ok: true, doc, sections: { added, updated, unchanged }, combos: { added, updated, unchanged } }（docは {sections, combos}）。
const MERGE_CONFLICT = '他の端末での変更と、セクションや連携の親子関係が食い違うため取り込めません';
export function mergeImport(local, incoming) {
  const checked = validateDoc(incoming);
  if (!checked.ok) return checked;
  const mergeList = (mine, theirs, stats) => {
    const out = structuredClone(mine);
    const pos = new Map(out.map((x, i) => [x.id, i]));
    for (const item of theirs) {
      const i = pos.get(item.id);
      if (i === undefined) {
        pos.set(item.id, out.length);
        out.push(structuredClone(item));
        stats.added++;
      } else if (item.updatedAt > out[i].updatedAt) {
        out[i] = structuredClone(item);
        stats.updated++;
      } else {
        stats.unchanged++;
      }
    }
    return out;
  };
  const sections = { added: 0, updated: 0, unchanged: 0 };
  const combos = { added: 0, updated: 0, unchanged: 0 };
  const doc = {
    sections: mergeList(local.sections, incoming.sections, sections),
    combos: mergeList(local.combos, incoming.combos, combos),
  };
  const byId = new Map(doc.combos.map((c) => [c.id, c]));
  for (const c of doc.combos) {
    let r = c;
    for (let i = 0; r.parentId !== undefined && byId.has(r.parentId) && i <= LIMITS.depth; i++) r = byId.get(r.parentId);
    if (r.parentId === undefined) c.sectionId = r.sectionId;
  }
  const result = validateDoc(exportDoc(doc));
  return result.ok ? { ok: true, doc, sections, combos } : { ok: false, reason: /^\d+件目/.test(result.reason) ? MERGE_CONFLICT : result.reason };
}

// ===== SECTION: 書き出しの案内 =====
// D-006: 最終書き出しから14日以上経ち、かつその後に変更があるときだけ案内する。時刻はエポックミリ秒、日付と時刻の表記は端末のローカル時刻。
const DAY = 86_400_000;
const REMIND_AFTER = 14 * DAY;
const p2 = (n) => String(n).padStart(2, '0');
export const dateText = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
// tag は別種のファイルを見分けるための印（例: '-raw'）
export const exportFilename = (t, tag = '') => { const d = new Date(t); return `sf6-memo${tag}-${dateText(t).replaceAll('-', '')}-${p2(d.getHours())}${p2(d.getMinutes())}.json`; };
export const daysSince = (t, now) => Math.max(0, Math.floor((now - t) / DAY));
export const snoozeUntil = (now) => now + 7 * DAY;

// settings: { lastExportAt, lastChangeAt, firstChangeAt, remindSnoozeUntil }（いずれも null か時刻）。doc: { combos }。
// 一度も書き出していないときは、記録が1件以上あり、最初の変更から14日以上経っていれば案内する。
export function shouldRemindExport(settings, doc, now) {
  const { lastExportAt, lastChangeAt, firstChangeAt, remindSnoozeUntil } = settings;
  if (remindSnoozeUntil !== null && now < remindSnoozeUntil) return false;
  if (lastExportAt === null) return doc.combos.length > 0 && firstChangeAt !== null && now - firstChangeAt >= REMIND_AFTER;
  return lastChangeAt !== null && lastChangeAt > lastExportAt && now - lastExportAt >= REMIND_AFTER;
}
