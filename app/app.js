import {
  CHARACTERS, SECTION_PRESETS, SECTION_NAME_MAX, describeRow, motionToArrows, parseDocText, exportDoc,
  sectionsOf, addSection, renameSection, moveSection, deleteSection, validateDoc, isTime,
} from './core.js';

// ===== SECTION: コマンド列の描画 =====
// describeRow の記述子から DOM を作る。文字列は textContent / setAttribute のみで入れる（innerHTML は使わない）。
// 記号は index.html の SVGスプライトを <use> で参照する（Unicodeでは描かない）。
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROTATE = { 6: 0, 3: 45, 2: 90, 1: 135, 4: 180, 7: 225, 8: 270, 9: 315 }; // i-arrow は右向き
const STR_CLASS = { L: 'str-l', M: 'str-m', H: 'str-h' };
const STR_TEXT = { L: '弱', M: '中', H: '強' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(id, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function arrow(dir) {
  if (dir === '5') { // ニュートラルは矢印ではなく素の文字「N」（矢印の箱と同じ幅で中央寄せ）
    const n = el('span', 'ltr neutral', 'N');
    n.setAttribute('aria-hidden', 'true');
    return n;
  }
  const a = icon('i-arrow', 'arrow');
  a.style.transform = `rotate(${ROTATE[dir]}deg)`;
  return a;
}

function dot(key, colorCls, str) {
  const d = el('span', `dot ${colorCls}${str ? ' has-str' : ''}`);
  d.append(icon(key === 'P' ? 'i-dot-p' : 'i-dot-k', 'dot-svg'));
  if (str) d.append(el('span', 'badge', STR_TEXT[str]));
  return d;
}

// 方向の列（arrow表記は矢印のSVG、numpad表記は数字の文字）
function dirNodes(motion, notation) {
  if (notation === 'numpad') return [el('span', 'num', motion)];
  return motionToArrows(motion).flatMap((a) => {
    if (a.dir === '360') return [icon('i-360', 'cw')];
    if (!a.charge) return [arrow(a.dir)];
    const c = el('span', 'charge');
    c.append(icon('i-br-l', 'br'), arrow(a.dir), icon('i-br-r', 'br'));
    return [c];
  });
}

function chipNodes(token, label, notation) {
  switch (token.type) {
    case 'normal': {
      const dirs = `${token.stance === 'crouch' ? '2' : ''}${token.dir ?? ''}`;
      return [
        ...(token.stance === 'jump' ? [el('span', 'ltr', 'J')] : []),
        ...(dirs ? dirNodes(dirs, notation) : []),
        dot(token.key, STR_CLASS[token.str], token.str),
      ];
    }
    case 'special': {
      const od = token.str === 'OD';
      return [
        ...(token.stance === 'jump' ? [el('span', 'ltr', 'J')] : []),
        ...dirNodes(token.motion, notation),
        ...(od
          ? [el('span', 'ltr od', 'OD'), dot(token.key, 'od'), dot(token.key, 'od')]
          : [dot(token.key, STR_CLASS[token.str], token.str)]),
      ];
    }
    default: // system / sa。表示文字は読み上げ名と同じ（CDR、DI、DP、Dリバ、SA3）
      return [document.createTextNode(label)];
  }
}

// tokens → .row 要素。opts: { size: 'L'|'S', notation: 'arrow'|'numpad', strengthLabels: boolean }
export function renderRow(tokens, { size = 'L', notation = 'arrow', strengthLabels = false } = {}) {
  const row = el('div', `row ${size}${strengthLabels ? ' str-labels' : ''}`);
  let grp = null;
  for (const d of describeRow(tokens, notation)) {
    if (d.kind === 'conn') {
      // ▶は直前の技のグループ末尾に入れる（行頭に来ない）。読み上げでは「、次、」に置き換える
      grp.append(el('span', 'sr-only', '、次、'), icon('i-conn', 'conn'));
      continue;
    }
    grp = el('span', 'grp');
    for (const n of d.notes) grp.append(el('span', 'tag', n.id));
    if (d.token) {
      const chip = el('span', d.token.type === 'system' || d.token.type === 'sa' ? 'chip sys' : 'chip');
      chip.setAttribute('role', 'img');
      chip.setAttribute('aria-label', d.label);
      chip.append(...chipNodes(d.token, d.label, notation));
      grp.append(chip);
    }
    row.append(grp);
  }
  return row;
}

// ===== SECTION: 小さなDOM部品 =====
// 外部由来の文字列は append（Textノード）と setAttribute だけで入れる。innerHTML は使わない。
const h = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};
const at = (e, attrs) => {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const svgIcon = (id, rotate = 0) => {
  const s = icon(id, 'ic');
  if (rotate) s.style.transform = `rotate(${rotate}deg)`;
  return s;
};
const btn = (cls, label, onClick, attrs = {}) => {
  const b = at(h('button', `btn ${cls}`.trim(), ...[label].flat()), { type: 'button', ...attrs });
  b.addEventListener('click', onClick);
  return b;
};
const iconBtn = (id, label, onClick, attrs = {}, rotate = 0) => {
  const b = at(h('button', 'icon-btn', svgIcon(id, rotate)), { type: 'button', 'aria-label': label, ...attrs });
  b.addEventListener('click', onClick);
  return b;
};
const pad2 = (n) => String(n).padStart(2, '0');
const charName = (id) => CHARACTERS.find((c) => c.id === id)?.name;
const byFk = (k) => document.querySelector(`[data-fk="${CSS.escape(k)}"]`);

// ===== SECTION: 保存層 =====
// D-003: 文書全体をまとめて書く。読み込みは必ず parseDocText（validateDoc）を通す（不正データでは renderRow が落ちる）。
// ponytail: 書き出しJSONが2MBを超えたらIndexedDBへ移行する（D-003）。
const KEYS = { data: 'sf6memo.data', settings: 'sf6memo.settings', drafts: 'sf6memo.drafts' /* T-010で使う */ };
let data = { sections: [], combos: [] };
let settings;
let loadError = null; // 非nullなら読み取り専用（既存の値を上書きしない）
let saveError = null; // 直近のデータ保存の失敗（Error、{ invalid }、{ conflict }）。次のデータ保存が成功するまで画面に出し続ける
let lastSeen = null; // sf6memo.data を最後に読んだ・書いた文字列。他タブの書き込みの検出に使う
let persisted = false;

const DEFAULT_SETTINGS = () => ({ notation: 'arrow', strengthLabels: false, recentCharacters: [], lastExportAt: null, lastChangeAt: null, collapsed: {} });

// settings は端末ごとの表示設定。壊れていても既定値で起動し、必要なフィールドだけ型を確かめて取り込む。
function sanitizeSettings(raw) {
  const out = DEFAULT_SETTINGS();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (raw.notation === 'numpad') out.notation = 'numpad';
  out.strengthLabels = raw.strengthLabels === true;
  if (Array.isArray(raw.recentCharacters)) {
    out.recentCharacters = [...new Set(raw.recentCharacters.filter((id) => charName(id)))].slice(0, 3);
  }
  for (const k of ['lastExportAt', 'lastChangeAt']) if (isTime(raw[k])) out[k] = raw[k];
  for (const [cid, map] of Object.entries(raw.collapsed ?? {})) {
    if (!charName(cid) || map === null || typeof map !== 'object') continue;
    out.collapsed[cid] = Object.fromEntries(Object.keys(map).filter((id) => map[id] === true).map((id) => [id, true]));
  }
  return out;
}

// sf6memo.data を読み直して data / loadError / lastSeen を更新する（起動時と他タブの変更の検知時）
function loadData() {
  loadError = null;
  data = { sections: [], combos: [] };
  try {
    lastSeen = localStorage.getItem(KEYS.data);
  } catch {
    lastSeen = null;
    loadError = 'ブラウザの保存領域にアクセスできません';
    return;
  }
  if (lastSeen === null) return;
  const r = parseDocText(lastSeen);
  if (r.ok) data = { sections: r.doc.sections, combos: r.doc.combos };
  else loadError = r.reason;
}

function loadSettings() {
  let raw = null;
  try {
    const st = localStorage.getItem(KEYS.settings);
    if (st !== null) raw = JSON.parse(st);
  } catch { /* 読めない・壊れている settings は既定値で続行する（dataは別キーで検証する） */ }
  settings = sanitizeSettings(raw);
}

// 成功なら null、失敗なら例外を返す。永続化の要求は、データの初回保存成功時だけ行う。
function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    return e;
  }
  if (key === KEYS.data && !persisted) {
    persisted = true;
    navigator.storage?.persist?.()?.catch(() => {});
  }
  return null;
}
// settings の保存失敗は握りつぶす（メモリ上の値は保つ。画面のエラーはデータの失敗だけに出す）
const saveSettings = () => write(KEYS.settings, JSON.stringify(settings));

// 変更を確定してメモリに反映し、保存する。成功したら true。
// - 検証に通らない state は書かず、メモリも変えない。
// - 他タブが書いていた場合は上書きせず、他タブの内容を読み直す（変更は破棄）。
// - 保存だけ失敗した場合はメモリ上の状態を保つ。いずれの失敗も saveError を画面に出す。
function commit(next) {
  if (loadError) return false;
  dismissToast(); // 取り消しの対象は直前の1操作だけにする
  saveError = null;
  const check = validateDoc(exportDoc(next));
  if (!check.ok) { saveError = { invalid: check.reason }; return false; }
  let current;
  try { current = localStorage.getItem(KEYS.data); } catch { current = lastSeen; }
  if (current !== lastSeen) {
    loadData();
    saveError = { conflict: true };
    return false;
  }
  data = next;
  const text = JSON.stringify(exportDoc(data));
  saveError = write(KEYS.data, text);
  if (saveError) return false;
  lastSeen = text;
  settings.lastChangeAt = Date.now(); // D-006: 書き出し案内の判定用
  saveSettings();
  return true;
}

const isQuota = (e) => e?.name === 'QuotaExceededError' || e?.code === 22;
function errorBox(title, body) {
  return at(h('div', 'err', svgIcon('i-warn'), h('div', '', h('h2', '', title), h('p', '', body))), { role: 'alert' });
}
// 画面の上部バーの下に張り付ける（スクロール位置に関係なく見える）。理由はすべて textContent で入れる。
function banners() {
  const out = [];
  if (loadError) out.push(errorBox('保存データを読み込めませんでした（データは変更していません）', `${loadError}。読み取り専用で開いています。`));
  if (saveError?.conflict) out.push(errorBox('保存しませんでした', '他のタブで変更されたため、最新の内容を読み込み直しました。もう一度操作してください。'));
  else if (saveError?.invalid) out.push(errorBox('保存できませんでした', `この変更は保存できないデータになるため、行いませんでした（${saveError.invalid}）。`));
  else if (saveError) {
    out.push(errorBox('保存できませんでした', isQuota(saveError)
      ? '端末の保存領域がいっぱいです。入力内容はこの画面に残っています。'
      : 'ブラウザが保存を許可していません。変更はこの画面にだけ残っています。'));
  }
  return out.length ? [h('div', 'banners', ...out)] : [];
}

// ===== SECTION: トースト =====
// role="status" の #toast に1件だけ入れる。キーボードのフォーカスかマウスのホバー中は時間を止める（タッチのホバーは無視）。
let toastTimer = null;
function dismissToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast')?.replaceChildren();
}
function showToast(msg, { label, onAction, ms = 6000 } = {}) {
  dismissToast();
  const box = h('div', 'toast', h('span', 'toast-msg', msg));
  if (onAction) box.append(btn('toast-act', label, () => { dismissToast(); onAction(); }));
  let left = ms;
  let started = null;
  let hover = false;
  let focus = false;
  const sync = () => {
    if (hover || focus) {
      if (started !== null) { clearTimeout(toastTimer); left -= Date.now() - started; started = null; }
    } else if (started === null) {
      started = Date.now();
      toastTimer = setTimeout(dismissToast, left);
    }
  };
  box.addEventListener('pointerenter', (e) => { hover = e.pointerType === 'mouse'; sync(); });
  box.addEventListener('pointerleave', () => { hover = false; sync(); });
  box.addEventListener('focusin', (e) => { focus = e.target.matches(':focus-visible'); sync(); }); // キーボード操作のときだけ。タップ後の自動フォーカスで消えなくならないように
  box.addEventListener('focusout', () => { focus = false; sync(); });
  document.getElementById('toast').append(box);
  sync();
}

function announce(msg) {
  const live = document.getElementById('live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 50);
}

// ===== SECTION: ボトムシート =====
// 開くときに pushState し、戻る操作（popstate）で閉じる。開いている間は #app を inert にして Tab を閉じ込める。
let activeSheet = null;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href]';

function openSheet(opener) {
  const key = opener?.dataset?.fk;
  const scrim = h('div', 'scrim');
  const box = at(h('div', 'sheet'), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' });
  scrim.append(box);
  history.pushState({ n: navN, sheet: true }, '');
  document.getElementById('layer').append(scrim);
  appRoot.inert = true;
  const sheet = {
    closing: false,
    then: null,
    // body は本体のノード。actions は下端の［閉じる］の右に並べるボタン（主ボタンを最後に）
    show(title, body, ...actions) {
      box.replaceChildren(
        at(h('h2', '', title), { id: 'sheet-title' }),
        body,
        h('div', 'sheet-foot', btn('', '閉じる', () => sheet.close()), ...actions),
      );
      (body.querySelector(FOCUSABLE) ?? box.querySelector(FOCUSABLE))?.focus();
    },
    // then は閉じた後に実行する（操作の反映は閉じてから行う）
    close(then) {
      if (sheet.closing) return;
      sheet.closing = true;
      sheet.then = then;
      if (history.state?.sheet) history.back(); // popstate -> dispose
      else sheet.dispose();
    },
    dispose() {
      if (activeSheet !== sheet) return;
      activeSheet = null;
      appRoot.inert = false;
      scrim.classList.add('closing');
      box.classList.add('closing');
      setTimeout(() => scrim.remove(), 150);
      sheet.then?.();
      const a = document.activeElement;
      if (!activeSheet && (!a || a === document.body || scrim.contains(a))) { // 操作側がフォーカスを置かなければ、開いた要素へ戻す（消えていれば画面の見出しへ）
        (key && byFk(key) || document.querySelector('.screen h1'))?.focus({ preventScroll: true });
      }
    },
  };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) sheet.close(); });
  scrim.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { sheet.close(); return; }
    if (e.key !== 'Tab') return;
    // Tab停止位置を自前で巡回する。ラジオは1グループ1停止（選択中、なければ先頭）なので、素のDOM順では端を判定できない
    const stops = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.type !== 'radio'
      || (box.querySelector(`input[name="${el.name}"]:checked`) ?? box.querySelector(`input[name="${el.name}"]`)) === el);
    e.preventDefault();
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement);
    stops[e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i + 1) % stops.length].focus();
  });
  activeSheet = sheet;
  return sheet;
}

// ===== SECTION: セクション操作の画面側 =====
const now = () => Date.now();

// 変更を確定して再描画する。undo があれば取り消しトーストを出す（元の state へ戻す）。
// 保存に失敗した操作には取り消しを出さない（エラー表示が出る）。削除の直後は［元に戻す］へフォーカスを移す。
function mutate(next, message, focus, undoFocus) {
  if (loadError) return;
  const prev = data;
  const ok = commit(next);
  const undo = ok && message;
  if (undo) showToast(message, { label: '元に戻す', onAction: () => { commit(prev); render({ keepScroll: true, focus: undoFocus }); } });
  render({ keepScroll: true, focus });
  if (undo) document.querySelector('.toast-act')?.focus();
}

function moveBy(s, delta, focus) {
  const next = moveSection(data, s.id, delta, now());
  if (next === data) return;
  const pos = sectionsOf(next, s.characterId).findIndex((x) => x.id === s.id) + 1;
  mutate(next, null, focus);
  announce(`${s.name}を${pos}番目に移動`);
}

function removeSection(s, moveToId) {
  const r = deleteSection(data, s.id, moveToId, now());
  if (!r.ok) return; // 画面側で防いでいる（移動先未選択・他にセクションなし）
  const n = data.combos.filter((c) => c.sectionId === s.id).length;
  const dest = data.sections.find((x) => x.id === moveToId)?.name;
  mutate(r.state, n ? `「${s.name}」を削除し、${n}件を「${dest}」へ移動しました` : `「${s.name}」を削除しました`, undefined, [`fold:${s.id}`]);
}

function nameForm(sh, { title, value = '', submit, onSubmit }) {
  const input = at(h('input', 'field'), {
    type: 'text', id: 'sheet-name', maxlength: String(SECTION_NAME_MAX), autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'sheet-name-err',
  });
  input.value = value;
  const err = at(h('p', 'field-err'), { id: 'sheet-name-err', role: 'alert' });
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); err.textContent = ''; });
  const form = at(h('form', 'sheet-body', at(h('label', 'field-label', 'セクション名'), { for: 'sheet-name' }), input, err), { id: 'sheet-form', novalidate: '' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      err.textContent = 'セクション名を入力してください';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    onSubmit(name);
  });
  sh.show(title, form, btn('primary', submit, () => {}, { type: 'submit', form: 'sheet-form' }));
  input.select();
}

function candidateButtons(cid, onPick) {
  const have = new Set(sectionsOf(data, cid).map((s) => s.name));
  return h('div', 'chips', ...SECTION_PRESETS.filter((p) => !have.has(p)).map((p) => btn('', p, () => onPick(p))));
}
function addNamed(cid, name) {
  const next = addSection(data, cid, name, now());
  mutate(next, null, [`fold:${next.sections.at(-1).id}`]);
}

function addSectionSheet(opener, cid) {
  const sh = openSheet(opener);
  const body = h('div', 'sheet-body',
    candidateButtons(cid, (name) => sh.close(() => addNamed(cid, name))),
    btn('', '名前を付けて作る', () => nameForm(sh, { title: 'セクションを追加', submit: '追加', onSubmit: (name) => sh.close(() => addNamed(cid, name)) })));
  sh.show('セクションを追加', body);
}

function deleteSheet(sh, s, items) {
  const others = sectionsOf(data, s.characterId).filter((x) => x.id !== s.id);
  let dest = null;
  const go = btn('primary', '移動して削除', () => sh.close(() => removeSection(s, dest)), { disabled: '' });
  const body = h('div', 'sheet-body', h('p', 'note', `「${s.name}」には記録が${items}件あります。移動先を選ぶと、記録を移してから削除します。`));
  if (others.length) {
    const group = at(h('fieldset', 'radios', h('legend', 'field-label', '移動先')), {});
    for (const o of others) {
      const radio = at(h('input'), { type: 'radio', name: 'dest' });
      radio.value = o.id;
      radio.addEventListener('change', () => { dest = o.id; go.disabled = false; });
      const n = data.combos.filter((c) => c.sectionId === o.id).length;
      group.append(h('label', 'radio', radio, h('span', 'radio-name', o.name), h('span', 'muted', `${n}件`)));
    }
    body.append(group);
  } else {
    body.append(at(h('p', 'note', '他にセクションがないため削除できません。先に別のセクションを作ってください。'), { id: 'delete-why' }));
    go.setAttribute('aria-describedby', 'delete-why');
  }
  sh.show(`「${s.name}」を削除`, body, go);
}

function sectionMenu(opener, s) {
  const sh = openSheet(opener);
  const list = sectionsOf(data, s.characterId);
  const i = list.findIndex((x) => x.id === s.id);
  const item = (label, onClick, disabled) => {
    const b = at(h('button', 'menu-item', label), { type: 'button', ...(disabled && { disabled: '' }) });
    b.addEventListener('click', onClick);
    return b;
  };
  const items = data.combos.filter((c) => c.sectionId === s.id).length;
  sh.show(s.name, h('div', 'sheet-body flush',
    item('名称変更', () => nameForm(sh, {
      title: '名称変更', value: s.name, submit: '保存', onSubmit: (name) => sh.close(() => mutate(renameSection(data, s.id, name, now()))),
    })),
    item('上へ', () => sh.close(() => moveBy(s, -1)), i === 0),
    item('下へ', () => sh.close(() => moveBy(s, 1)), i === list.length - 1),
    item('削除', () => (items ? deleteSheet(sh, s, items) : sh.close(() => removeSection(s, null)))),
  ));
}

// ===== SECTION: 画面 =====
const POS = { any: 'どこでも', corner: '画面端', midscreen: '画面中央' };

function shell({ title, back, right = [], notices = [], main, bottom }) {
  const bar = h('header', 'topbar');
  if (back) bar.append(iconBtn('i-chev', back.label, () => goBack(back.to), {}, 180));
  bar.append(at(h('h1', back ? '' : 'solo', title), { tabindex: '-1' }), ...right);
  return h('div', 'screen', bar, ...notices, h('main', 'main', ...main), ...(bottom ? [bottom] : []));
}

function homeScreen() {
  const counts = new Map();
  for (const c of data.combos) counts.set(c.characterId, (counts.get(c.characterId) ?? 0) + 1);
  const grid = at(h('nav', 'grid'), { 'aria-label': 'キャラクター' });
  for (const c of CHARACTERS) {
    const n = counts.get(c.id);
    grid.append(at(h('a', 'cell', h('span', 'cell-name', c.name), ...(n ? [h('span', 'cell-n', `${n}件`)] : [])), { href: `#/c/${c.id}` }));
  }
  const recent = settings.recentCharacters;
  const bottom = h('footer', 'bottombar recent', ...(recent.length
    ? [at(h('div', 'recent-list', ...recent.map((id) => at(h('a', 'btn', charName(id)), { href: `#/c/${id}` }))), { role: 'group', 'aria-label': '最近使ったキャラクター' })]
    : [h('p', 'hint', 'キャラクターを選ぶと記録を始められます')]));
  return shell({ title: 'SF6戦略メモ', right: [at(h('a', 'btn top-action', '設定'), { href: '#/settings' })], notices: banners(), main: [grid], bottom });
}

function recordRow(c) {
  const meta = [POS[c.position], c.tags.join(' '), `全${c.tokens.filter((t) => t.type !== 'note').length}手`].filter(Boolean).join('・');
  return at(h('a', 'item',
    ...(c.title ? [h('div', 'item-title', c.title)] : []),
    h('div', 'preview', renderRow(c.tokens, { size: 'S', notation: settings.notation, strengthLabels: settings.strengthLabels })),
    h('div', 'item-meta', meta)), { href: `#/c/${c.characterId}/r/${c.id}` });
}

function sectionHead(s, i, count, collapsed, canEdit) {
  const toggle = at(h('button', 'sec-toggle',
    svgIcon('i-chev', collapsed ? 0 : 90), h('span', 'sec-no', pad2(i + 1)), h('span', 'sec-name', s.name), h('span', 'sec-count', `${count}件`)),
  { type: 'button', 'aria-expanded': String(!collapsed), 'data-fk': `fold:${s.id}` });
  toggle.addEventListener('click', () => {
    const map = (settings.collapsed[s.characterId] ??= {});
    if (collapsed) delete map[s.id]; else map[s.id] = true;
    saveSettings();
    render({ keepScroll: true, focus: [`fold:${s.id}`] });
  });
  const head = h('div', 'sec-head', toggle);
  if (canEdit) {
    const menuBtn = iconBtn('i-more', `${s.name}のメニュー`, () => sectionMenu(menuBtn, s), { 'data-fk': `menu:${s.id}`, 'aria-haspopup': 'dialog' });
    head.append(at(h('a', 'icon-btn', svgIcon('i-plus')), { href: `#/c/${s.characterId}/new?s=${s.id}`, 'aria-label': `${s.name}に記録を追加` }), menuBtn);
  }
  return head;
}

function reorderHead(s, i, count, last) {
  const mv = (delta) => moveBy(s, delta, [`${delta < 0 ? 'up' : 'down'}:${s.id}`, `${delta < 0 ? 'down' : 'up'}:${s.id}`]);
  return h('div', 'sec-head reorder',
    h('span', 'sec-no', pad2(i + 1)), h('span', 'sec-name', s.name), h('span', 'sec-count', `${count}件`),
    iconBtn('i-arrow', `${s.name}を上へ`, () => mv(-1), { 'data-fk': `up:${s.id}`, ...(i === 0 && { disabled: '' }) }, 270),
    iconBtn('i-arrow', `${s.name}を下へ`, () => mv(1), { 'data-fk': `down:${s.id}`, ...(last && { disabled: '' }) }, 90));
}

function listScreen({ cid }) {
  const name = charName(cid);
  const secs = sectionsOf(data, cid);
  const canEdit = !loadError;
  const reorder = canEdit && ui.reorder === cid && secs.length > 0;
  const collapsedMap = settings.collapsed[cid] ?? {};
  const main = [];
  const addHere = (s) => `#/c/${cid}/new?s=${s.id}`;

  if (!secs.length) {
    main.push(h('div', 'empty',
      h('p', '', canEdit ? 'このキャラクターの記録はまだありません。まず状況（セクション）を作ります。' : 'このキャラクターの記録はありません。'),
      ...(canEdit ? [
        candidateButtons(cid, (n) => addNamed(cid, n)),
        btn('', '名前を付けて作る', (e) => {
          const sh = openSheet(e.currentTarget);
          nameForm(sh, { title: 'セクションを追加', submit: '追加', onSubmit: (n) => sh.close(() => addNamed(cid, n)) });
        }, { 'data-fk': 'name-new' }),
      ] : [])));
  }
  secs.forEach((s, i) => {
    const items = data.combos.filter((c) => c.sectionId === s.id).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    if (reorder) { main.push(reorderHead(s, i, items.length, i === secs.length - 1)); return; }
    const collapsed = collapsedMap[s.id] === true;
    main.push(sectionHead(s, i, items.length, collapsed, canEdit));
    if (collapsed) return;
    if (items.length) main.push(...items.map(recordRow));
    else {
      main.push(h('div', 'empty-sec', h('span', 'muted', 'まだ記録がありません'),
        ...(canEdit ? [at(h('a', 'btn', svgIcon('i-plus'), '追加'), { href: addHere(s) })] : [])));
    }
  });

  let bottom = null;
  if (canEdit && reorder) {
    bottom = h('footer', 'bottombar', btn('primary', '完了', () => { ui.reorder = null; render({ keepScroll: true, focus: ['reorder'] }); }));
  } else if (canEdit) {
    const addRecord = secs.length
      ? at(h('a', 'btn primary', svgIcon('i-plus'), '記録'), { href: addHere(secs[0]) })
      : at(h('button', 'btn primary', svgIcon('i-plus'), '記録'), { type: 'button', disabled: '' });
    bottom = h('footer', 'bottombar',
      btn('', '並べ替え', () => { ui.reorder = cid; render({ keepScroll: true, focus: [`down:${secs[0].id}`, `up:${secs[0].id}`] }); },
        { 'data-fk': 'reorder', ...(secs.length < 2 && { disabled: '' }) }),
      (() => { const b = btn('', [svgIcon('i-plus'), 'セクション'], () => addSectionSheet(b, cid), { 'data-fk': 'add-section' }); return b; })(),
      addRecord);
  }
  return shell({ title: name, back: { label: 'キャラクター選択に戻る', to: '#/' }, notices: banners(), main, bottom });
}

// ponytail: 実装前の仮画面。詳細は T-010、編集・新規作成は T-011、設定は T-012 で置き換える（置き換えたらこの関数と SCREENS の呼び出しを削除する）。
function placeholder({ title, backLabel, to, lines }) {
  return shell({
    title, back: { label: backLabel, to },
    main: [h('div', 'placeholder', h('p', '', '次のタスクで実装します。'), ...lines.map((l) => h('p', 'muted', l)))],
  });
}

const SCREENS = {
  home: homeScreen,
  list: listScreen,
  detail: ({ cid, rid }) => placeholder({ title: '記録の詳細', backLabel: `${charName(cid)}の一覧に戻る`, to: `#/c/${cid}`, lines: [`記録: ${data.combos.find((c) => c.id === rid)?.title || rid}`] }),
  edit: ({ cid, rid }) => placeholder({ title: '記録の編集', backLabel: '詳細に戻る', to: `#/c/${cid}/r/${rid}`, lines: [`記録: ${rid}`] }),
  new: ({ cid, sid }) => placeholder({ title: '記録の新規作成', backLabel: `${charName(cid)}の一覧に戻る`, to: `#/c/${cid}`, lines: [`セクション: ${data.sections.find((s) => s.id === sid)?.name ?? '未指定'}`] }),
  settings: () => placeholder({ title: '設定', backLabel: 'キャラクター選択に戻る', to: '#/', lines: [] }),
};

// ===== SECTION: ルーティング =====
// hash ルーティング（D-002）。画面の深さで遷移の向きを決める（design-spec 7章）。
const DEPTH = { home: 0, settings: 1, list: 1, detail: 2, new: 2, edit: 3 };
const ROUTES = [
  [/^\/$/, 'home', []],
  [/^\/settings$/, 'settings', []],
  [/^\/c\/([\w-]+)$/, 'list', ['cid']],
  [/^\/c\/([\w-]+)\/r\/([\w-]+)$/, 'detail', ['cid', 'rid']],
  [/^\/c\/([\w-]+)\/r\/([\w-]+)\/edit$/, 'edit', ['cid', 'rid']],
  [/^\/c\/([\w-]+)\/new$/, 'new', ['cid']],
];
function parseRoute(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  for (const [re, name, keys] of ROUTES) {
    const m = (path || '/').match(re);
    if (!m) continue;
    const route = { name, ...Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])) };
    if (route.cid && !charName(route.cid)) return null;
    if (name === 'new') {
      const sid = new URLSearchParams(query).get('s');
      route.sid = /^[\w-]{1,64}$/.test(sid ?? '') ? sid : null;
    }
    return route;
  }
  return null;
}

const ui = { reorder: null }; // 並べ替えモード中のキャラクターid（画面を離れると解除）
let appRoot;
let currentRoute = null;
let currentHash = null;
let navN = 0; // 履歴内のこのアプリの深さ。0なら戻る先がないので親画面へ置き換える
const scrollPos = new Map();

function goBack(to) {
  if (navN > 0) history.back();
  else { history.replaceState({ n: 0 }, '', to); navigate(); }
}

function render({ keepScroll = false, focus, dir = null } = {}) {
  const route = currentRoute;
  if (route.name === 'list' && settings.recentCharacters[0] !== route.cid) {
    settings.recentCharacters = [route.cid, ...settings.recentCharacters.filter((x) => x !== route.cid)].slice(0, 3);
    saveSettings();
  }
  const y = window.scrollY;
  const screen = SCREENS[route.name](route);
  if (dir) screen.classList.add(`enter-${dir}`);
  appRoot.replaceChildren(screen);
  // 見出しの帯（sticky）をエラー帯の下に置くため、帯の高さを渡す
  screen.style.setProperty('--banner-h', `${screen.querySelector('.banners')?.offsetHeight ?? 0}px`);
  window.scrollTo(0, keepScroll ? y : (dir === 'back' ? scrollPos.get(location.hash) ?? 0 : 0));
  const target = (focus ?? []).map(byFk).find((t) => t && !t.disabled);
  if (target) target.focus({ preventScroll: true });
  else if (!keepScroll || focus) screen.querySelector('h1').focus({ preventScroll: true });
}

function navigate() {
  const route = parseRoute(location.hash);
  if (!route) { // 未知のhashは履歴を増やさず #/ へ
    history.replaceState({ n: navN }, '', '#/');
    navigate();
    return;
  }
  if (Number.isInteger(history.state?.n)) navN = history.state.n;
  else history.replaceState({ n: ++navN }, '');
  if (currentHash !== null) scrollPos.set(currentHash, window.scrollY);
  activeSheet?.dispose();
  const dir = currentRoute ? (DEPTH[route.name] >= DEPTH[currentRoute.name] ? 'fwd' : 'back') : null;
  currentRoute = route;
  currentHash = location.hash;
  ui.reorder = null;
  render({ dir });
}

function start() {
  appRoot = document.getElementById('app');
  loadSettings();
  loadData();
  history.scrollRestoration = 'manual';
  if (Number.isInteger(history.state?.n)) navN = history.state.n;
  else history.replaceState({ n: 0 }, '');
  if (history.state?.sheet) history.back(); // リロードで残った開きっぱなしのシート分の履歴を戻す
  addEventListener('hashchange', navigate);
  addEventListener('popstate', (e) => {
    if (activeSheet && !e.state?.sheet) activeSheet.dispose();
    else if (!activeSheet && e.state?.sheet) history.back(); // 進む操作で戻ってきた、開いていないシートの履歴は飛ばす
  });
  // 他タブがデータを書いたら読み直して描画する（開いているシートは古い内容を前提にしているので閉じる）
  addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage || (e.key !== KEYS.data && e.key !== null)) return;
    loadData();
    activeSheet?.close();
    render({ keepScroll: true });
  });
  navigate();
}

// tests/check.html は renderRow だけを使うため #app が無ければ起動しない
if (document.getElementById('app')) start();
