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

// ===== SECTION: トークン定義 =====
// トークンの種別は `type` で持つ（D-004）。dir は数値（1,3,4,6,7,8,9）、motion は文字列。
export const APP_ID = 'sf6-strategy-memo';
export const SCHEMA_VERSION = 1;
export const PRESETS = ['236', '214', '623', '22', '63214', '[4]6', '[2]8', '360'];
export const SYSTEM_IDS = ['RAW_DR', 'CDR', 'DI', 'PARRY', 'REVERSAL'];
export const NOTE_IDS = ['CH', 'PC'];
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
    case 'normal': return onlyKeys(t, ['type', 'stance', 'dir', 'key', 'str']) && STANCES.includes(t.stance) && (t.dir === undefined || DIRS.includes(t.dir)) && btn(['L', 'M', 'H']);
    case 'special': return onlyKeys(t, ['type', 'motion', 'key', 'str', 'stance']) && isMotion(t.motion) && btn(['L', 'M', 'H', 'OD']) && (t.stance === undefined || t.stance === 'jump');
    case 'system': return onlyKeys(t, ['type', 'id']) && SYSTEM_IDS.includes(t.id);
    case 'sa': return onlyKeys(t, ['type', 'level']) && (t.level === 1 || t.level === 2 || t.level === 3);
    case 'note': return onlyKeys(t, ['type', 'id']) && NOTE_IDS.includes(t.id);
    default: return false;
  }
}

// ===== SECTION: パッド入力の状態遷移 =====
// state: { tokens, cursor, pending: { stance, dirs }, notice }
// pending.dirs は押した順の入力（プリセット1個、または方向の数字）。motion は dirs.join('') で得る。
// action: { type: 'stance', value } | { type: 'preset', value } | { type: 'dir', value: 1-9 }
//   | { type: 'button', key: 'P'|'K', str: 'L'|'M'|'H'|'OD' } | { type: 'system', id } | { type: 'sa', level }
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
  if (!KEYS.includes(key) || !['L', 'M', 'H', 'OD'].includes(str)) throw new Error(`不正なボタン: ${key}${str}`);
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

// 強度の選択肢（チップのポップオーバー）: 通常技=弱中強、必殺技=+OD、SA=1〜3、システム技・注記は強度なし
export function strengthChoices(token) {
  switch (token.type) {
    case 'normal': return ['L', 'M', 'H'];
    case 'special': return ['L', 'M', 'H', 'OD'];
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
const STR_NAMES = { L: '弱', M: '中', H: '強' };
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

// ===== SECTION: 文書の検証 =====
// ponytail: 上限値は個人利用の目安。実データで足りなくなったら調整する。
export const LIMITS = { sections: 1000, combos: 10000, tokens: 200, tags: 20, name: 50, title: 100, tag: 30, memo: 2000 };
const COMBO_KEYS = ['id', 'characterId', 'controlType', 'sectionId', 'title', 'position', 'tokens', 'memo', 'tags', 'favorite', 'createdAt', 'updatedAt', 'damage'];
const POSITIONS = ['any', 'corner', 'midscreen'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isStr = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
export const isTime = (v) => Number.isSafeInteger(v) && v >= 0;
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
  if (v > SCHEMA_VERSION) return `新しい版(schemaVersion ${v})のデータです。アプリを更新してください`;
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
      ['name', isStr(s.name, LIMITS.name, 1)],
      ['order', Number.isSafeInteger(s.order) && s.order >= 0],
      ['updatedAt', isTime(s.updatedAt)],
    ].find(([, ok]) => !ok);
    if (!isObj(s) || bad) return `${i + 1}件目のsectionsの${bad ? bad[0] : '形式'}が不正です`;
    if (sectionChar.has(s.id)) return `sectionsのidが重複しています`;
    sectionChar.set(s.id, s.characterId);
  }

  const comboIds = new Set();
  for (const [i, c] of doc.combos.entries()) {
    if (isObj(c) && !onlyKeys(c, COMBO_KEYS)) return `${i + 1}件目のcombosに未対応の項目があります`;
    const bad = isObj(c) && [
      ['id', isId(c.id)],
      ['characterId', isCharacter(c.characterId)],
      ['controlType', c.controlType === 'classic'],
      ['sectionId', sectionChar.has(c.sectionId) && sectionChar.get(c.sectionId) === c.characterId],
      ['title', isStr(c.title, LIMITS.title)],
      ['position', POSITIONS.includes(c.position)],
      ['tokens', Array.isArray(c.tokens) && c.tokens.length <= LIMITS.tokens && c.tokens.every(isValidToken)],
      ['memo', isStr(c.memo, LIMITS.memo)],
      ['tags', Array.isArray(c.tags) && c.tags.length <= LIMITS.tags && c.tags.every((t) => isStr(t, LIMITS.tag, 1))],
      ['favorite', typeof c.favorite === 'boolean'],
      ['createdAt', isTime(c.createdAt)],
      ['updatedAt', isTime(c.updatedAt)],
      ['damage', !Object.hasOwn(c, 'damage') || isDamage(c.damage)],
    ].find(([, ok]) => !ok);
    if (!isObj(c) || bad) return `${i + 1}件目のcombosの${bad ? bad[0] : '形式'}が不正です`;
    if (comboIds.has(c.id)) return `combosのidが重複しています`;
    comboIds.add(c.id);
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
      combos: hasItems ? state.combos.map((c) => (c.sectionId === sectionId ? { ...c, sectionId: moveToId, updatedAt: now } : c)) : state.combos,
    },
  };
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

// 複製: 同じセクションに、新しいid・日時で。タイトルは「（元）のコピー」（上限を超えるときは元の側を削る）。
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

// localStorage の下書き（外部由来の値）を、編集画面に使える形へ整える。形が違う項目は捨てる。
export function sanitizeDraft(raw) {
  if (!isObj(raw)) return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    sectionId: typeof raw.sectionId === 'string' ? raw.sectionId : null,
    title: str(raw.title, LIMITS.title),
    position: POSITIONS.includes(raw.position) ? raw.position : 'any',
    tokens: Array.isArray(raw.tokens) ? raw.tokens.filter(isValidToken).slice(0, LIMITS.tokens) : [],
    memo: str(raw.memo, LIMITS.memo),
    ...(isDamage(raw.damage) && { damage: raw.damage }),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t) => typeof t === 'string' && t.length >= 1).map((t) => t.slice(0, LIMITS.tag)).slice(0, LIMITS.tags)
      : [],
    savedAt: isTime(raw.savedAt) ? raw.savedAt : null,
  };
}

// ===== SECTION: 書き出しと取り込み =====
// state: { sections, combos }。書き出し文書は state に app と schemaVersion を足したもの。
export function exportDoc(state) {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, ...structuredClone({ sections: state.sections, combos: state.combos }) };
}

// D-006: id一致は updatedAt の新しい方、同時刻は端末側。端末のみの記録は残す。入力は変更しない。
// マージ結果も validateDoc に通し、参照整合が崩れる場合は { ok: false, reason } を返す。
// 成功時は { ok: true, doc, added, updated, unchanged }（docは {sections, combos}）。
export function mergeImport(local, incoming) {
  const checked = validateDoc(incoming);
  if (!checked.ok) return checked;
  const stats = { added: 0, updated: 0, unchanged: 0 };
  const mergeList = (mine, theirs) => {
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
  const doc = {
    sections: mergeList(local.sections, incoming.sections),
    combos: mergeList(local.combos, incoming.combos),
  };
  const result = validateDoc(exportDoc(doc));
  return result.ok ? { ok: true, doc, ...stats } : result;
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
