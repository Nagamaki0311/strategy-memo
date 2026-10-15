// ===== SECTION: キャラクターマスタ =====
// キャラクターマスタ（D-010）。id＝公式URLのスラッグ、配列順＝公式の並び順。追加はここへ1行足すだけ。
export const CHARACTERS = [
  { id: 'ryu', name: 'リュウ' },
  { id: 'luke', name: 'ルーク' },
  { id: 'jamie', name: 'ジェイミー' },
  { id: 'chunli', name: '春麗' },
  { id: 'guile', name: 'ガイル' },
  { id: 'kimberly', name: 'キンバリー' },
  { id: 'juri', name: 'ジュリ' },
  { id: 'ken', name: 'ケン' },
  { id: 'blanka', name: 'ブランカ' },
  { id: 'dhalsim', name: 'ダルシム' },
  { id: 'ehonda', name: 'エドモンド本田' },
  { id: 'deejay', name: 'ディージェイ' },
  { id: 'manon', name: 'マノン' },
  { id: 'marisa', name: 'マリーザ' },
  { id: 'jp', name: 'JP' },
  { id: 'zangief', name: 'ザンギエフ' },
  { id: 'lily', name: 'リリー' },
  { id: 'cammy', name: 'キャミィ' },
  { id: 'rashid', name: 'ラシード' },
  { id: 'aki', name: 'A.K.I.' },
  { id: 'ed', name: 'ED' },
  { id: 'gouki_akuma', name: '豪鬼' },
  { id: 'vega_mbison', name: 'ベガ' },
  { id: 'terry', name: 'テリー' },
  { id: 'mai', name: '舞' },
  { id: 'elena', name: 'エレナ' },
  { id: 'sagat', name: 'サガット' },
  { id: 'cviper', name: 'C.ヴァイパー' },
  { id: 'alex', name: 'アレックス' },
  { id: 'ingrid', name: 'イングリッド' },
  { id: 'yasmine', name: 'ヤスミン' },
  { id: 'arjun', name: 'アルジュン' },
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
export const isMotion = (m) => typeof m === 'string' && (m === '360' || /^(\[[1-9]\][1-9]+|[1-9]{2,})$/.test(m));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function isValidToken(t) {
  if (!isObj(t)) return false;
  const btn = (strs) => KEYS.includes(t.key) && strs.includes(t.str);
  switch (t.type) {
    case 'normal': return STANCES.includes(t.stance) && (t.dir === undefined || DIRS.includes(t.dir)) && btn(['L', 'M', 'H']);
    case 'special': return isMotion(t.motion) && btn(['L', 'M', 'H', 'OD']) && (t.stance === undefined || t.stance === 'jump');
    case 'system': return SYSTEM_IDS.includes(t.id);
    case 'sa': return t.level === 1 || t.level === 2 || t.level === 3;
    case 'note': return NOTE_IDS.includes(t.id);
    default: return false;
  }
}

// ===== SECTION: パッド入力の状態遷移 =====
// state: { tokens, cursor, pending: { stance, dirs }, notice }
// pending.dirs は押した順の入力（プリセット1個、または方向の数字）。motion は dirs.join('') で得る。
// action: { type: 'stance', value } | { type: 'preset', value } | { type: 'dir', value: 1-9 }
//   | { type: 'button', key: 'P'|'K', str: 'L'|'M'|'H'|'OD' } | { type: 'system', id } | { type: 'sa', level }
//   | { type: 'note', id } | { type: 'recent', token } | { type: 'undo' } | { type: 'cursor', index }
export const NOTICE_NEED_MOTION = '先にモーションを選んでください';

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

export function applyPadInput(state, action) {
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
      // モーション（2文字以上）になったら↓は破棄
      const stance = pending.stance === 'crouch' && dirs.join('').length >= 2 ? 'stand' : pending.stance;
      return { ...cleared, pending: { stance, dirs } };
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
      return { ...cleared, cursor: Math.max(0, Math.min(state.tokens.length, action.index)) };
    default:
      throw new Error(`不正なaction: ${action.type}`);
  }
}

// ===== SECTION: トークン表示 =====
const ARROWS = { 1: '↙', 2: '↓', 3: '↘', 4: '←', 5: '・', 6: '→', 7: '↖', 8: '↑', 9: '↗' };
const MOTION_NAMES = { 236: '波動', 214: '竜巻', 623: '昇龍', 22: '下下', '[4]6': '溜め横', '[2]8': '溜め縦', 360: '一回転' };
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
const LIMITS = { sections: 1000, combos: 10000, tokens: 200, tags: 20, id: 64, name: 50, title: 100, tag: 30, memo: 2000 };
const POSITIONS = ['any', 'corner', 'midscreen'];
const isStr = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const isTime = (v) => Number.isSafeInteger(v) && v >= 0;
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

  const sectionChar = new Map();
  for (const [i, s] of doc.sections.entries()) {
    const bad = isObj(s) && [
      ['id', isStr(s.id, LIMITS.id, 1)],
      ['characterId', isCharacter(s.characterId)],
      ['name', isStr(s.name, LIMITS.name, 1)],
      ['order', Number.isSafeInteger(s.order) && s.order >= 0],
      ['updatedAt', isTime(s.updatedAt)],
    ].find(([, ok]) => !ok);
    if (!isObj(s) || bad) return `${i + 1}件目のsectionsの${bad ? bad[0] : '形式'}が不正です`;
    if (sectionChar.has(s.id)) return `sectionsのidが重複しています(${s.id})`;
    sectionChar.set(s.id, s.characterId);
  }

  const comboIds = new Set();
  for (const [i, c] of doc.combos.entries()) {
    const bad = isObj(c) && [
      ['id', isStr(c.id, LIMITS.id, 1)],
      ['characterId', isCharacter(c.characterId)],
      ['controlType', c.controlType === 'classic'],
      ['sectionId', sectionChar.has(c.sectionId) && sectionChar.get(c.sectionId) === c.characterId],
      ['title', isStr(c.title, LIMITS.title)],
      ['position', POSITIONS.includes(c.position)],
      ['tokens', Array.isArray(c.tokens) && c.tokens.length <= LIMITS.tokens && c.tokens.every(isValidToken)],
      ['memo', isStr(c.memo, LIMITS.memo)],
      ['tags', Array.isArray(c.tags) && c.tags.length <= LIMITS.tags && c.tags.every((t) => isStr(t, LIMITS.tag))],
      ['favorite', typeof c.favorite === 'boolean'],
      ['createdAt', isTime(c.createdAt)],
      ['updatedAt', isTime(c.updatedAt)],
    ].find(([, ok]) => !ok);
    if (!isObj(c) || bad) return `${i + 1}件目のcombosの${bad ? bad[0] : '形式'}が不正です`;
    if (comboIds.has(c.id)) return `combosのidが重複しています(${c.id})`;
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

// ===== SECTION: 書き出しと取り込み =====
// state: { sections, combos }。書き出し文書は state に app と schemaVersion を足したもの。
export function exportDoc(state) {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, ...structuredClone({ sections: state.sections, combos: state.combos }) };
}

// D-006: id一致は updatedAt の新しい方、同時刻は端末側。端末のみの記録は残す。入力は変更しない。
export function mergeImport(local, incoming) {
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
  return { doc, ...stats };
}
