import {
  CHARACTERS, SECTION_PRESETS, SECTION_NAME_MAX, PRESETS, MOTION_NAMES, LIMITS, describeRow, motionToArrows, tokenLabel, parseDocText, exportDoc,
  sectionsOf, addSection, renameSection, moveSection, deleteSection, validateDoc, isTime, newId,
  applyPadInput, initialPadState, pendingMotion, strengthChoices, recentTokens, tagCandidates, duplicateCombo, sanitizeDraft,
  mergeImport, exportFilename, dateText, daysSince, snoozeUntil, shouldRemindExport,
} from './core.js';

// ===== SECTION: コマンド列の描画 =====
// describeRow の記述子から DOM を作る。文字列は textContent / setAttribute のみで入れる（innerHTML は使わない）。
// 記号は index.html の SVGスプライトを <use> で参照する（Unicodeでは描かない）。
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROTATE = { 6: 0, 3: 45, 2: 90, 1: 135, 4: 180, 7: 225, 8: 270, 9: 315 }; // i-arrow は右向き
const STR_CLASS = { L: 'str-l', M: 'str-m', H: 'str-h' };
const STR_TEXT = { L: '弱', M: '中', H: '強' };
const SYS_KIND = { CDR: 'dr', RAW_DR: 'dr', DI: 'di', PARRY: 'dp', REVERSAL: 'dp' }; // システム技の種別。チップの色と枠の形（design-spec-v2 3章）

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
    default: // system / sa。表示文字は読み上げ名と同じ（CDR、DI、DP、Dリバ、SA3）。DR系だけ先頭に»を置く
      return [...(SYS_KIND[token.id] === 'dr' ? [icon('i-rush', 'rush')] : []), document.createTextNode(label)];
  }
}

// onChip を渡すと、技とタグを <button> にしてタップできる（詳細・編集）。渡さなければ読み上げ用の span のまま（一覧・直近のS）。
// 両画面が同じ呼び出しなので、DOM は画面によらず同じになる。
function tapPart(cls, label, index, token, nodes, onChip) {
  const b = el('button', cls);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-haspopup', 'dialog');
  b.dataset.i = index;
  b.dataset.fk = `chip:${index}`;
  b.append(...nodes);
  b.addEventListener('click', () => onChip(index, token, b));
  return b;
}

// tokens → .row 要素。opts: { size: 'L'|'S', notation: 'arrow'|'numpad', strengthLabels: boolean, onChip?: (index, token, button) => void }
export function renderRow(tokens, { size = 'L', notation = 'arrow', strengthLabels = false, onChip = null } = {}) {
  const row = el('div', `row ${size}${strengthLabels ? ' str-labels' : ''}`);
  let grp = null;
  for (const d of describeRow(tokens, notation)) {
    if (d.kind === 'conn') {
      // ▶は直前の技のグループ末尾に入れる（行頭に来ない）。読み上げでは「、次、」に置き換える
      grp.append(el('span', 'sr-only', '、次、'), icon('i-conn', 'conn'));
      continue;
    }
    grp = el('span', 'grp');
    for (const n of d.notes) grp.append(onChip ? tapPart('tag', n.id, n.index, { type: 'note', id: n.id }, [n.id], onChip) : el('span', 'tag', n.id));
    if (d.token) {
      const kind = d.token.type === 'sa' ? 'sa' : SYS_KIND[d.token.id]; // system・sa 以外は undefined
      const cls = kind ? `chip sys sys-${kind}` : 'chip';
      const nodes = chipNodes(d.token, d.label, notation);
      if (onChip) grp.append(tapPart(cls, d.label, d.index, d.token, nodes, onChip));
      else {
        const chip = el('span', cls);
        chip.setAttribute('role', 'img');
        chip.setAttribute('aria-label', d.label);
        chip.append(...nodes);
        grp.append(chip);
      }
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
const charEn = (id) => CHARACTERS.find((c) => c.id === id)?.en;
const fmtDamage = new Intl.NumberFormat('ja-JP');
const byFk = (k) => document.querySelector(`[data-fk="${CSS.escape(k)}"]`);

// ===== SECTION: 保存層 =====
// D-003: 文書全体をまとめて書く。読み込みは必ず parseDocText（validateDoc）を通す（不正データでは renderRow が落ちる）。
// ponytail: 書き出しJSONが2MBを超えたらIndexedDBへ移行する（D-003）。
const KEYS = { data: 'sf6memo.data', settings: 'sf6memo.settings', drafts: 'sf6memo.drafts' };
let data = { sections: [], combos: [] };
let settings;
let loadError = null; // 非nullなら読み取り専用（既存の値を上書きしない）
let saveError = null; // 直近のデータ保存の失敗（Error、{ invalid }、{ conflict }）。次のデータ保存が成功するまで画面に出し続ける
let lastSeen = null; // sf6memo.data を最後に読んだ・書いた文字列。他タブの書き込みの検出に使う
let persisted = false;

const DEFAULT_SETTINGS = () => ({ notation: 'arrow', strengthLabels: false, recentCharacters: [], lastExportAt: null, lastChangeAt: null, firstChangeAt: null, remindSnoozeUntil: null, collapsed: {} });

// settings は端末ごとの表示設定。壊れていても既定値で起動し、必要なフィールドだけ型を確かめて取り込む。
function sanitizeSettings(raw) {
  const out = DEFAULT_SETTINGS();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (raw.notation === 'numpad') out.notation = 'numpad';
  out.strengthLabels = raw.strengthLabels === true;
  if (Array.isArray(raw.recentCharacters)) {
    out.recentCharacters = [...new Set(raw.recentCharacters.filter((id) => charName(id)))].slice(0, 3);
  }
  for (const k of ['lastExportAt', 'lastChangeAt', 'firstChangeAt', 'remindSnoozeUntil']) if (isTime(raw[k])) out[k] = raw[k];
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
  settings.firstChangeAt ??= settings.lastChangeAt;
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

// pop: true ならチップに近接するポップオーバー（暗幕なし、タイトルと［閉じる］なし）。履歴・Tab閉じ込め・Escは共通。
function openSheet(opener, { pop = false } = {}) {
  const key = opener?.dataset?.fk;
  const scrim = h('div', pop ? 'scrim pop' : 'scrim');
  const box = at(h('div', pop ? 'popover' : 'sheet'), { role: 'dialog', 'aria-modal': 'true', ...(pop ? { 'aria-label': '技の詳細' } : { 'aria-labelledby': 'sheet-title' }) });
  if (pop) opener.classList.add('sel');
  scrim.append(box);
  history.pushState({ n: navN, sheet: true }, '');
  document.getElementById('layer').append(scrim);
  appRoot.inert = true;
  const sheet = {
    closing: false,
    then: null,
    closeLabel: '閉じる', // show() の前に変えられる（取り込みの確認は［やめる］）
    // body は本体のノード。actions は下端の［閉じる］の右に並べるボタン（主ボタンを最後に）
    show(title, body, ...actions) {
      box.replaceChildren(
        at(h('h2', '', title), { id: 'sheet-title' }),
        body,
        h('div', 'sheet-foot', btn('', sheet.closeLabel, () => sheet.close()), ...actions),
      );
      (body.querySelector(FOCUSABLE) ?? box.querySelector(FOCUSABLE))?.focus();
    },
    // 既定はチップの上、入らなければ下。幅は最大320。
    pop(body) {
      box.replaceChildren(body);
      box.tabIndex = -1;
      const r = opener.getBoundingClientRect();
      const w = Math.min(320, innerWidth - 16);
      box.style.width = `${w}px`;
      box.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
      const ph = box.offsetHeight;
      const top = r.top - ph - 6 >= document.querySelector('.topbar').getBoundingClientRect().bottom ? r.top - ph - 6 : r.bottom + 6;
      box.style.top = `${Math.max(8, Math.min(top, innerHeight - ph - 8))}px`;
      (body.querySelector(FOCUSABLE) ?? box).focus();
    },
    box,
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
      if (pop) {
        opener.classList.remove('sel');
        scrim.remove();
      } else {
        scrim.classList.add('closing');
        box.classList.add('closing');
        setTimeout(() => scrim.remove(), 150);
      }
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

const menuItem = (label, onClick, disabled) => {
  const b = at(h('button', 'menu-item', label), { type: 'button', ...(disabled && { disabled: '' }) });
  b.addEventListener('click', onClick);
  return b;
};

function sectionMenu(opener, s) {
  const sh = openSheet(opener);
  const list = sectionsOf(data, s.characterId);
  const i = list.findIndex((x) => x.id === s.id);
  const items = data.combos.filter((c) => c.sectionId === s.id).length;
  sh.show(s.name, h('div', 'sheet-body flush',
    menuItem('名称変更', () => nameForm(sh, {
      title: '名称変更', value: s.name, submit: '保存', onSubmit: (name) => sh.close(() => mutate(renameSection(data, s.id, name, now()))),
    })),
    menuItem('上へ', () => sh.close(() => moveBy(s, -1)), i === 0),
    menuItem('下へ', () => sh.close(() => moveBy(s, 1)), i === list.length - 1),
    menuItem('削除', () => (items ? deleteSheet(sh, s, items) : sh.close(() => removeSection(s, null)))),
  ));
}

// ===== SECTION: 画面 =====
const POS = { any: 'どこでも', corner: '画面端', midscreen: '画面中央' };

function shell({ title, back, right = [], notices = [], main, bottom }) {
  const bar = h('header', 'topbar');
  if (back) bar.append(iconBtn('i-chev', back.label, () => goBack(back.to), {}, 180));
  bar.append(at(h('h1', back ? '' : 'solo', ...[title].flat()), { tabindex: '-1' }), ...right);
  return h('div', 'screen', bar, ...notices, h('main', 'main', ...main), ...(bottom ? [bottom] : []));
}

// 起動時の点灯（design-spec-v2 6章）: アプリ起動後の最初のキャラ選択の描画で1回だけ、点灯タイル（記録あり）の先頭6件の英字を60msずつずらして点ける
let bootPlayed = false;
const BOOT_MAX = 6;
// 360px幅の1列（英字の幅92px）で20pxだと収まらない名前（実測。KIMBERLY 93.5px。tests/e2e.mjs が360・390・430幅で収まりを確認する）
const LONG_EN = new Set(['kimberly']);

function homeScreen() {
  const counts = new Map();
  for (const c of data.combos) counts.set(c.characterId, (counts.get(c.characterId) ?? 0) + 1);
  const grid = at(h('nav', 'grid'), { 'aria-label': 'キャラクター' });
  let booted = 0;
  for (const c of CHARACTERS) {
    const n = counts.get(c.id);
    const cell = at(h('a', `cell${n ? ' lit' : ''}${LONG_EN.has(c.id) ? ' long' : ''}`,
      at(h('span', 'cell-en', c.en), { 'aria-hidden': 'true' }), h('span', 'cell-name', c.name), ...(n ? [h('span', 'cell-n', `${n}件`)] : [])),
    { href: `#/c/${c.id}`, 'aria-label': n ? `${c.name} ${n}件` : c.name });
    if (n && !bootPlayed && booted < BOOT_MAX) {
      cell.classList.add('boot');
      cell.style.setProperty('--d', `${booted++ * 60}ms`);
    }
    grid.append(cell);
  }
  bootPlayed = true;
  const recent = settings.recentCharacters;
  const bottom = h('footer', 'bottombar recent', ...(recent.length
    ? [at(h('div', 'recent-list', ...recent.map((id) => at(h('a', 'rc', at(h('span', 'rc-en', charEn(id)), { 'aria-hidden': 'true' })), { href: `#/c/${id}`, 'aria-label': charName(id) }))), { role: 'group', 'aria-label': '最近使ったキャラクター' })]
    : [h('p', 'hint', 'キャラクターを選ぶと記録を始められます')]));
  return shell({ title: 'SF6戦略メモ', right: [at(h('a', 'btn top-action', '設定'), { href: '#/settings' })], notices: [...banners(), ...remindBar()], main: [grid], bottom });
}

function recordRow(c) {
  const meta = [POS[c.position], c.tags.join(' '), `全${c.tokens.filter((t) => t.type !== 'note').length}手`].filter(Boolean).join('・');
  return at(h('a', 'item',
    ...(c.title ? [h('div', 'item-title', c.title)] : []),
    h('div', 'preview', renderRow(c.tokens, { size: 'S', notation: settings.notation, strengthLabels: settings.strengthLabels })),
    h('div', 'item-meta', h('span', 'meta-t', meta), ...(c.damage === undefined ? [] : [h('span', 'dmg', 'ダメージ ', h('b', '', fmtDamage.format(c.damage)))]))), { href: `#/c/${c.characterId}/r/${c.id}` });
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
  return shell({ title: [at(h('span', 'wm', charEn(cid)), { 'aria-hidden': 'true' }), h('span', 'kn', name)], back: { label: 'キャラクター選択に戻る', to: '#/' }, notices: banners(), main, bottom });
}

// ===== SECTION: 凡例 =====
// 形 → 意味 → 書き出し時の表記（requirements 3.3・3.5・3.6）。形は実際のチップの描画（renderRow・dirNodes）をそのまま使う。
// システム技・注記の正式名称は、パッドのaria-labelと凡例で共有する。略称はtokenLabelと同じ。
const SYS_FULL = { CDR: 'キャンセルドライブラッシュ', RAW_DR: 'パリィドライブラッシュ', DI: 'ドライブインパクト', PARRY: 'ドライブパリィ', REVERSAL: 'ドライブリバーサル' };
const NOTE_FULL = { CH: 'カウンターヒット', PC: 'パニッシュカウンター' };
const nm = (stance, str, key, dir) => ({ type: 'normal', stance, ...(dir && { dir }), key, str });
const MOTION_MEANING = { 22: '下下（下を2回）', 63214: '通称なし（右・右下・下・左下・左）', '[4]6': '溜め横（左を溜めて右）', '[2]8': '溜め縦（下を溜めて上）' };

function legendTable() {
  const shape = (tokens, o = {}) => renderRow(tokens, { size: 'S', notation: settings.notation, strengthLabels: settings.strengthLabels, ...o });
  const motion = (m) => h('div', 'row S', ...dirNodes(m, settings.notation));
  const diagram = () => h('div', 'diag', ...[7, 8, 9, 4, 5, 6, 1, 2, 3].map((d) => h('div', 'diag-c', arrow(String(d)), h('span', 'diag-n', String(d)))));
  const conn = () => h('div', 'row S', icon('i-conn', 'conn'));
  // システム技・SAは枠の形と発光が見分けの手がかりなので、実際のL寸法で出す（ODはL寸法だと幅が足りず折り返すためS）
  const L = { size: 'L' };
  const SYS_LOOK = { CDR: '緑の枠と»', RAW_DR: '緑の枠と»', DI: '角を切った銀の板', PARRY: '紺の二重枠', REVERSAL: '紺の二重枠' };
  const sys = (id) => [shape([{ type: 'system', id }], L), `${SYS_FULL[id]}（${tokenLabel({ type: 'system', id })}）。${SYS_LOOK[id]}`, tokenLabel({ type: 'system', id })];
  const groups = [
    ['ボタン', [
      [shape([nm('stand', 'L', 'P')]), '水色の円＝弱。円の中の文字がP（パンチ）かK（キック）', '弱P'],
      [shape([nm('stand', 'M', 'K')]), '薄い黄の円＝中', '中K'],
      [shape([nm('stand', 'H', 'P')]), '薄い赤の円＝強', '強P'],
      [shape([nm('stand', 'H', 'K')], { strengthLabels: true }), '設定で円の隅に弱・中・強の小さな文字を出せる（既定はオフ）', '強K'],
    ]],
    ['姿勢', [
      [shape([nm('stand', 'M', 'P')]), '何も付かない＝立ち', '立ち中P'],
      [shape([nm('crouch', 'M', 'K')]), '円の前の下向き矢印＝しゃがみ', '屈中K'],
      [shape([nm('jump', 'M', 'K')]), '円の前のJ＝ジャンプ', 'ジャンプ中K'],
    ]],
    ['方向', [
      [shape([nm('stand', 'H', 'P', 4)]), '方向入れの通常技。円の前の矢印が入れる方向', '引き強P'],
      [diagram(), '8方向とニュートラル（N）。数字はテンキーの位置', '1〜9（5はニュートラル）'],
    ]],
    ['モーションのプリセットと通称', PRESETS.map((m) => [motion(m), MOTION_MEANING[m] ?? MOTION_NAMES[m], m])],
    ['OD', [[shape([{ type: 'special', motion: '236', key: 'P', str: 'OD' }]), 'OD必殺技。橙の「OD」の文字と、橙の●2つ（重ねて表示）', 'OD236P']]],
    ['システム技・SA', [
      ...['CDR', 'RAW_DR', 'DI', 'PARRY', 'REVERSAL'].map(sys),
      [h('div', 'leg-sa', ...[1, 2, 3].map((level) => shape([{ type: 'sa', level }], L))), 'スーパーアーツ1〜3。白い枠', 'SA1〜SA3'],
    ]],
    ['注記（直後の技に付く）', ['CH', 'PC'].map((id) => [shape([{ type: 'note', id }]), `${NOTE_FULL[id]}。斜めの小さな板`, id])],
    ['つなぎ', [[conn(), '技と技のつなぎ。自動で入る', '▶']]],
  ];
  const table = h('table', 'leg', h('thead', '', h('tr', '', h('th', '', '形'), h('th', '', '意味'), h('th', '', '書き出し時の表記'))));
  for (const [name, rows] of groups) {
    table.append(h('tbody', '', h('tr', '', at(h('th', 'leg-g', name), { colspan: '3' })),
      ...rows.map(([a, b, c]) => h('tr', '', h('td', 'leg-shape', a), h('td', '', b), h('td', 'leg-out', c)))));
  }
  return table;
}

function openLegend(opener) {
  const sh = openSheet(opener);
  sh.box.classList.add('tall');
  sh.show('凡例', at(h('div', 'sheet-body', legendTable()), { tabindex: '0' })); // 長い表なのでキーボードでもスクロールできるようにする
}

// ===== SECTION: 詳細画面 =====
// 閲覧専用（input・textarea・contenteditable を置かない）。チップのタップは「意味」の表示だけ。
const motionNote = (motion) => h('div', 'pop-note', ...dirNodes(motion, 'arrow'), ' ＝ ', motion, ...(MOTION_NAMES[motion] ? [`（${MOTION_NAMES[motion]}）`] : []));

function detailScreen({ cid, rid }) {
  const c = data.combos.find((x) => x.id === rid);
  const sec = data.sections.find((s) => s.id === c.sectionId);
  const { notation, strengthLabels } = settings;
  const onChip = (index, token, chip) => {
    const sh = openSheet(chip, { pop: true });
    sh.pop(h('div', 'pop-body', token.type === 'special' ? motionNote(token.motion) : h('div', 'pop-note', tokenLabel(token, notation))));
  };
  const legendBtn = btn('top-action', '凡例', () => openLegend(legendBtn), { 'data-fk': 'legend', 'aria-haspopup': 'dialog' });
  const other = btn('', 'その他…', () => {
    const sh = openSheet(other);
    sh.show('その他', h('div', 'sheet-body flush', menuItem('削除', () => sh.close(() => removeCombo(c)))));
  }, { 'data-fk': 'other', 'aria-haspopup': 'dialog' });
  const main = h('div', 'detail',
    h('p', 'd-meta', [sec.name, POS[c.position], c.tags.join(' ')].filter(Boolean).join('・')),
    ...(c.title ? [h('h2', 'd-title', c.title)] : []),
    ...(c.damage === undefined ? [] : [h('p', 'd-stat', h('span', 'd-stat-l', 'ダメージ'), h('b', 'd-stat-n', fmtDamage.format(c.damage)))]),
    h('div', 'd-cmd', renderRow(c.tokens, { size: 'L', notation, strengthLabels, onChip })),
    ...(c.memo ? [h('section', 'd-memo', h('h2', 'd-memo-h', 'メモ'), h('p', '', c.memo))] : []));
  const bottom = h('footer', 'bottombar', other, btn('', '複製', () => duplicate(c)), at(h('a', 'btn primary', '編集'), { href: `#/c/${cid}/r/${rid}/edit` }));
  return shell({ title: `${charName(cid)}/${sec.name}`, back: { label: `${charName(cid)}の一覧に戻る`, to: `#/c/${cid}` }, right: [legendBtn], notices: banners(), main: [main], bottom });
}

// 削除: 一覧へ移り、取り消しトーストを出す。取り消しは直前の状態（prev）をそのまま書き戻す。
function removeCombo(c) {
  const prev = data;
  if (!commit({ sections: data.sections, combos: data.combos.filter((x) => x.id !== c.id) })) { render({ keepScroll: true }); return; }
  showToast(`『${c.title || '無題'}』を削除しました`, { label: '元に戻す', onAction: () => { commit(prev); render({ keepScroll: true }); } });
  const to = `#/c/${c.characterId}`;
  if (navN > 0 && prevHash === to) history.back(); // 一覧から来たなら履歴を戻す。それ以外は詳細の履歴を一覧に置き換える
  else { history.replaceState({ n: navN }, '', to); navigate(); }
}

function duplicate(c) {
  const copy = duplicateCombo(c, now());
  if (!commit({ sections: data.sections, combos: [...data.combos, copy] })) { render({ keepScroll: true }); return; }
  location.hash = `#/c/${c.characterId}/r/${copy.id}`;
  showToast('複製しました', { ms: 2500 });
}

// ===== SECTION: 編集画面 =====
// 編集中の状態 ed は画面の再描画（他タブの変更の反映など）をまたいで保つ。ルートが変わると navigate() が捨てる。
let ed = null;
const hhmm = (t) => `${pad2(new Date(t).getHours())}:${pad2(new Date(t).getMinutes())}`;

// 下書き（D-003）: sf6memo.drafts = { "edit:<記録id>" | "new:<セクションid>": { sectionId, title, position, tokens, memo, tags, savedAt } }。
// 読むときは sanitizeDraft を通す。キーに接頭辞を付けるのは、記録idが "__proto__" でも衝突させないため。
function readDrafts() {
  try {
    const o = JSON.parse(localStorage.getItem(KEYS.drafts) ?? '{}');
    return o !== null && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
function writeDraft() {
  const all = readDrafts();
  all[ed.draftKey] = { sectionId: ed.sectionId, title: ed.title, position: ed.position, tokens: ed.pad.tokens, memo: ed.memo, tags: ed.tags, damage: ed.damage, savedAt: now() }; // damage が undefined なら JSON でキーごと消える
  return write(KEYS.drafts, JSON.stringify(all));
}
function removeDraft(key) {
  const all = readDrafts();
  delete all[key];
  write(KEYS.drafts, JSON.stringify(all));
}

function initEdit({ cid, rid, sid }, secs) {
  const base = rid ? data.combos.find((c) => c.id === rid) : null;
  const fresh = base
    ? { sectionId: base.sectionId, title: base.title, position: base.position, tokens: structuredClone(base.tokens), memo: base.memo, tags: [...base.tags], ...(base.damage !== undefined && { damage: base.damage }) }
    : { sectionId: secs.some((s) => s.id === sid) ? sid : secs[0].id, title: '', position: 'any', tokens: [], memo: '', tags: [] };
  const draftKey = base ? `edit:${rid}` : `new:${fresh.sectionId}`;
  const all = readDrafts();
  const draft = Object.hasOwn(all, draftKey) ? sanitizeDraft(all[draftKey]) : null;
  const { tokens, ...f } = draft ? { ...fresh, damage: undefined, ...draft, sectionId: secs.some((s) => s.id === draft.sectionId) ? draft.sectionId : fresh.sectionId } : fresh;
  saveError = null;
  return { cid, rid, draftKey, ...f, pad: initialPadState(tokens), padHidden: false, draftLoaded: !!draft, dirty: !!draft, saved: false, draftFailed: false };
}

const PAD_DIRS = [7, 8, 9, 4, 5, 6, 1, 2, 3];
const PAD_DIR_NAMES = { 1: '左下', 2: '下', 3: '右下', 4: '左', 5: 'ニュートラル', 6: '右', 7: '左上', 8: '上', 9: '右上' };
const padKey = (cls, label, onClick, ...kids) => {
  const b = at(h('button', `key ${cls}`.trim(), ...kids), { type: 'button', 'aria-label': label });
  b.addEventListener('click', onClick);
  return b;
};

// パッド（design-spec 4章）。キーは action を act に渡すだけ。入力の規則は core.js の applyPadInput にある。
// sync(pending) で姿勢とプリセットの選択表示を更新する。
function buildPad(act, recents, notation, strengthLabels, onDone) {
  const stanceKeys = [];
  const presetKeys = [];
  const recent = recents.length
    ? at(h('div', 'recent-keys', ...recents.map((t) => padKey('', `${tokenLabel(t, notation)}を追加`, () => act({ type: 'recent', token: t }),
      renderRow([t], { size: 'S', notation, strengthLabels })))), { role: 'group', 'aria-label': '直近の技' })
    : h('div', 'recent-empty', '入力した技がここに並びます');
  const presetRow = (list) => h('div', 'preset-grid', ...list.map((v) => {
    const k = padKey('', `${MOTION_NAMES[v] ?? ''} ${v}`.trim(), () => act({ type: 'preset', value: v }), h('span', 'pk-arrows', ...dirNodes(v, notation)), h('span', 'pk-name', MOTION_NAMES[v] ?? ''));
    presetKeys.push([v, k]);
    return k;
  }));
  const sysKey = (label, aria, action, band) => padKey(band ? `band band-${band}` : '', aria, () => act(action), label); // band: 下端の帯の色（種別。注記には付けない）
  const system = at(h('div', 'sys-keys',
    ...['CDR', 'RAW_DR', 'DI'].map((id) => sysKey(tokenLabel({ type: 'system', id }), SYS_FULL[id], { type: 'system', id }, SYS_KIND[id])),
    ...[1, 2, 3].map((level) => sysKey(`SA${level}`, `スーパーアーツ${level}`, { type: 'sa', level }, 'sa')),
    ...['PARRY', 'REVERSAL'].map((id) => sysKey(tokenLabel({ type: 'system', id }), SYS_FULL[id], { type: 'system', id }, SYS_KIND[id])),
    ...['CH', 'PC'].map((id) => sysKey(id, NOTE_FULL[id], { type: 'note', id }))), { role: 'group', 'aria-label': 'システム技' });
  const dirs = h('div', 'dirs', ...PAD_DIRS.map((d) => padKey('dkey', PAD_DIR_NAMES[d], () => act({ type: 'dir', value: d }), arrow(String(d)))));
  const stance = at(h('div', 'stance', ...[['stand', '立ち', '立ち'], ['crouch', 'しゃがみ', arrow('2')], ['jump', 'ジャンプ', 'J']].map(([v, label, face]) => {
    const k = at(padKey('', label, () => act({ type: 'stance', value: v }), face), { role: 'radio' });
    stanceKeys.push([v, k]);
    return k;
  })), { role: 'radiogroup', 'aria-label': '姿勢' });
  const undo = padKey('', '直前の入力を取り消す', () => act({ type: 'undo' }), svgIcon('i-back'), h('span', 'undo-t', '消す'));
  const buttons = ['P', 'K'].flatMap((k) => [
    ...['L', 'M', 'H'].map((s) => padKey('bkey', `${STR_TEXT[s]}${k}`, () => act({ type: 'button', key: k, str: s }), dot(k, STR_CLASS[s], s))),
    padKey('okey', `OD ${k}`, () => act({ type: 'button', key: k, str: 'OD' }), el('span', 'ltr od', 'OD'), h('span', 'dots', dot(k, 'od'), dot(k, 'od'))),
  ]);
  const done = at(padKey('done', 'パッドを閉じて項目の入力へ', onDone, svgIcon('i-chev', 90), h('span', 'done-t', '完了')), { 'aria-controls': 'pad' });
  const pad = at(h('section', `pad${strengthLabels ? ' str-labels' : ''}`, h('div', 'r1', recent, done), presetRow(PRESETS.slice(0, 4)), presetRow(PRESETS.slice(4)), system,
    h('div', 'lower', dirs, h('div', 'btns', stance, undo, ...buttons))), { 'aria-label': '入力パッド', id: 'pad', tabindex: '-1' });
  const sync = ({ stance: st, dirs: ds }) => {
    // ↓を押したあとモーションを選ぶと、確定する技に↓は入らない。姿勢の選択も立ちに戻して見た目と一致させる。
    const shown = st === 'crouch' && ds.join('').length >= 2 ? 'stand' : st;
    for (const [v, k] of stanceKeys) k.setAttribute('aria-checked', String(v === shown));
    for (const [v, k] of presetKeys) k.setAttribute('aria-pressed', String(ds.length === 1 && ds[0] === v));
  };
  return { pad, sync };
}

// ペンディング（仮チップ）: 不透明度60%の記号＋塗りのない円。確定する技に合わせて、↓は単独のときだけ見せる。
function pendingNode({ stance, dirs }, notation) {
  const motion = dirs.join('');
  const shown = stance === 'crouch' && motion.length < 2 && motion !== '2' ? `2${motion}` : motion;
  if (!shown && stance === 'stand') return null;
  const sym = h('span', 'pend-sym', ...(stance === 'jump' ? [el('span', 'ltr', 'J')] : []), ...(shown ? dirNodes(shown, notation) : []));
  return at(h('span', 'grp pending', sym, el('span', 'ghost')), { 'aria-hidden': 'true' });
}

// 挿入カーソルを、index がカーソル以降の最初のチップの前（技のグループの先頭なら、グループの前）に置く。なければ末尾。
function placeAt(row, cursor, nodes) {
  const target = [...row.querySelectorAll('[data-i]')].find((e) => Number(e.dataset.i) >= cursor);
  if (!target) { row.append(...nodes); return; }
  (target.parentElement.firstElementChild === target ? target.parentElement : target).before(...nodes);
}

function editScreen(route) {
  const { cid, rid } = route;
  const secs = sectionsOf(data, cid);
  if (!ed) ed = initEdit(route, secs);
  if (!secs.some((s) => s.id === ed.sectionId)) ed.sectionId = secs[0].id;
  const { notation, strengthLabels } = settings;

  const errSlot = h('div', 'err-slot');
  const timeEl = h('p', 'draft-time');
  const cmd = at(h('div', 'cmd'), { role: 'group', 'aria-label': 'コマンド列' });
  const updateNotices = () => errSlot.replaceChildren(...banners());
  const showTime = () => { timeEl.textContent = ed.savedAt ? `下書き保存済み ${hhmm(ed.savedAt)}` : ''; };

  // 変更のたびに下書きへ書く。失敗は保存失敗と同じ表示（design-spec 6.6）で、次に成功したら消す。
  const touch = () => {
    ed.dirty = true;
    const was = !!saveError;
    const err = writeDraft();
    if (err) { saveError = err; ed.draftFailed = true; }
    else {
      ed.savedAt = now();
      if (ed.draftFailed) { saveError = null; ed.draftFailed = false; }
    }
    showTime();
    if (!!saveError !== was) updateNotices();
  };

  // ---- コマンド列 ----
  const updateRow = () => {
    const { tokens, cursor, pending } = ed.pad;
    const row = renderRow(tokens, { size: 'L', notation, strengthLabels, onChip: openChipMenu });
    const pend = pendingNode(pending, notation);
    placeAt(row, cursor, [...(pend ? [pend] : []), at(el('span', 'cursor'), { 'aria-hidden': 'true' })]);
    if (!tokens.length && !pend) row.append(el('span', 'cmd-hint', '下のパッドで技を入力'));
    if (cursor < tokens.length) row.append(btn('to-end', '末尾へ', () => act({ type: 'cursor', index: tokens.length })));
    cmd.replaceChildren(row);
  };

  // パッドとチップ操作の入口。成功したら true。トーストの取り消し対象は直前の1操作だけにする。
  const act = (action) => {
    const prev = ed.pad;
    const next = applyPadInput(prev, action);
    if (next.tokens.length > LIMITS.tokens) {
      showToast(`1つの記録に入れられるのは${LIMITS.tokens}手までです`, { ms: 3000 });
      return false;
    }
    dismissToast();
    ed.pad = next;
    if (next.notice) showToast(next.notice, { ms: 3000 });
    updateRow();
    sync(next.pending);
    if (next.tokens !== prev.tokens) {
      if (next.tokens.length > prev.tokens.length) announce(`追加: ${tokenLabel(next.tokens[next.cursor - 1], notation)}`);
      touch();
    }
    return true;
  };

  // ---- チップのポップオーバー ----
  function openChipMenu(index, token, chip) {
    const sh = openSheet(chip, { pop: true });
    const body = h('div', 'pop-body');
    if (token.type === 'special') body.append(motionNote(token.motion));
    const choices = strengthChoices(token);
    if (choices.length) {
      const cur = token.type === 'sa' ? token.level : token.str;
      body.append(at(h('div', 'pop-row', ...choices.map((v) => {
        const label = token.type === 'sa' ? `SA${v}` : v === 'OD' ? 'OD' : STR_TEXT[v];
        const kids = token.type === 'sa' ? [label] : v === 'OD' ? [el('span', 'ltr od', 'OD')] : [label, dot(token.key, STR_CLASS[v])];
        return at(btn('opt', kids, () => sh.close(() => act({ type: 'strength', index, value: v }))), { 'aria-pressed': String(v === cur), 'aria-label': label });
      })), { role: 'group', 'aria-label': '強度' }));
    }
    let from = index; // 直前の注記（CH・PC）は技に付くので、その前に挿入する
    if (token.type !== 'note') while (from > 0 && ed.pad.tokens[from - 1].type === 'note') from--;
    body.append(h('div', 'pop-row',
      btn('opt', 'この前に挿入', () => sh.close(() => act({ type: 'cursor', index: from }))),
      btn('opt', '削除', () => sh.close(() => {
        const before = ed.pad;
        if (!act({ type: 'remove', index })) return;
        showToast(`「${tokenLabel(token, notation)}」を削除しました`, { label: '元に戻す', onAction: () => { ed.pad = before; updateRow(); sync(before.pending); touch(); } });
      }))));
    sh.pop(body);
  }

  // ---- 入力欄 ----
  const input = (id, label, value, attrs, onInput, tag = 'input') => {
    const e = at(h(tag, 'field'), { id, ...attrs });
    e.value = value;
    e.addEventListener('input', () => onInput(e.value));
    return h('div', 'fld', at(h('label', 'field-label', label), { for: id }), e);
  };
  const secSel = at(h('select', 'field'), { id: 'f-sec' });
  for (const s of secs) secSel.append(Object.assign(h('option', '', s.name), { value: s.id }));
  secSel.value = ed.sectionId;
  secSel.addEventListener('change', () => { ed.sectionId = secSel.value; touch(); });
  const posSet = h('fieldset', 'seg', h('legend', 'field-label', '位置'), ...Object.entries(POS).map(([v, t]) => {
    const r = at(h('input'), { type: 'radio', name: 'pos', value: v });
    r.checked = ed.position === v;
    r.addEventListener('change', () => { ed.position = v; touch(); });
    return h('label', 'seg-item', r, h('span', '', t));
  }));

  const tagList = h('div', 'tag-list');
  const suggest = h('div', 'suggest');
  const tagInput = at(h('input', 'field'), { type: 'text', id: 'f-tag', maxlength: String(LIMITS.tag), autocomplete: 'off', enterkeyhint: 'done', placeholder: 'タグを入力' });
  const candidates = tagCandidates(data.combos, cid);
  const renderTags = () => {
    tagList.replaceChildren(...ed.tags.map((t) => btn('pill', [t, svgIcon('i-plus', 45)], () => { ed.tags = ed.tags.filter((x) => x !== t); touch(); renderTags(); }, { 'aria-label': `タグ「${t}」を外す` })));
    const q = tagInput.value.trim();
    suggest.replaceChildren(...candidates.filter((t) => !ed.tags.includes(t) && t.includes(q)).slice(0, 6).map((t) => btn('pill', t, () => addTag(t), { 'aria-label': `タグ「${t}」を追加` })));
  };
  const addTag = (raw) => {
    const t = raw.trim();
    if (t && !ed.tags.includes(t) && ed.tags.length < LIMITS.tags) { ed.tags.push(t); touch(); }
    tagInput.value = '';
    renderTags();
  };
  tagInput.addEventListener('input', renderTags);
  tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTag(tagInput.value); } });
  const tagFld = h('div', 'fld', at(h('label', 'field-label', 'タグ'), { for: 'f-tag' }), tagList,
    h('div', 'tag-add', tagInput, btn('', '追加', () => addTag(tagInput.value), { 'aria-label': 'タグを追加' })), suggest);

  // ダメージ（design-spec-v2 5.4）: type=number は指数・小数のキーが出るので使わず、入力のたびに全角数字を半角にして数字以外を除き5桁に切る。先頭の0はフォーカスが外れたときに除く
  const dmgIn = at(h('input', 'field'), { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '5', enterkeyhint: 'done', autocomplete: 'off', id: 'f-dmg', 'aria-describedby': 'f-dmg-hint' });
  dmgIn.value = ed.damage ?? '';
  dmgIn.addEventListener('input', () => {
    dmgIn.value = dmgIn.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '').slice(0, 5);
    ed.damage = dmgIn.value === '' ? undefined : Number(dmgIn.value);
    touch();
  });
  dmgIn.addEventListener('blur', () => { dmgIn.value = dmgIn.value.replace(/^0+(?=\d)/, ''); });
  const dmgFld = h('div', 'fld', at(h('label', 'field-label', 'ダメージ（任意）'), { for: 'f-dmg' }), h('div', 'dmg-row', dmgIn, at(h('span', 'dmg-hint', '0〜99999'), { id: 'f-dmg-hint' })));

  const fields = h('div', 'fields',
    h('div', 'fld', at(h('label', 'field-label', 'セクション'), { for: 'f-sec' }), secSel),
    input('f-title', 'タイトル（任意）', ed.title, { type: 'text', maxlength: String(LIMITS.title), autocomplete: 'off', enterkeyhint: 'done' }, (v) => { ed.title = v; touch(); }),
    posSet, dmgFld, tagFld,
    input('f-memo', 'メモ', ed.memo, { maxlength: String(LIMITS.memo), rows: '4' }, (v) => { ed.memo = v; touch(); }, 'textarea'));

  // ---- パッド ----
  const { pad: padEl, sync } = buildPad(act, recentTokens(data.combos, cid), notation, strengthLabels, () => { setPad(true); secSel.focus(); }); // ［完了］: ペンディングは保持。保存はしない
  // パッドが隠れている間だけ、同じ位置に格納バー（副ボタン1つ）を出す。浮動ボタンは使わない
  const dock = h('footer', 'bottombar pad-dock', btn('', [svgIcon('i-chev', 270), '技を入力'], () => { setPad(false); padEl.focus(); }, { 'aria-controls': 'pad', 'aria-expanded': 'false' }));
  const setPad = (hidden) => { padEl.hidden = hidden; dock.hidden = !hidden; ed.padHidden = hidden; };
  setPad(ed.padHidden);
  cmd.addEventListener('click', () => setPad(false)); // コマンド列の領域をタップしたらパッドを戻す
  fields.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.target.matches('#f-title, #f-dmg')) e.target.blur(); }); // キーボードを閉じる。パッドは隠れたまま
  fields.addEventListener('focusin', (e) => { if (e.target.matches('input[type=text], textarea')) setPad(true); }); // ソフトキーボードの場所を空ける

  // ---- 保存 ----
  const save = () => {
    if (tagInput.value.trim()) addTag(tagInput.value); // 入力途中のタグも取り込む
    const t = now();
    const base = rid ? data.combos.find((c) => c.id === rid) : null;
    const edited = { sectionId: ed.sectionId, title: ed.title.trim(), position: ed.position, tokens: structuredClone(ed.pad.tokens), memo: ed.memo, tags: [...ed.tags], ...(ed.damage !== undefined && { damage: ed.damage }) };
    const combo = base
      ? { ...base, ...edited, updatedAt: t }
      : { id: newId(), characterId: cid, controlType: 'classic', ...edited, favorite: false, createdAt: t, updatedAt: t };
    if (edited.damage === undefined) delete combo.damage; // 空は未入力（キーを持たせない）。元の値を {...base} から引き継がない
    const combos = base ? data.combos.map((c) => (c.id === base.id ? combo : c)) : [...data.combos, combo];
    const prev = data;
    if (!commit({ sections: data.sections, combos })) {
      if (data.combos === combos) data = prev; // 書き込みだけ失敗したときは、保存されていない記録を他の画面に出さない（入力は ed と下書きに残る）
      updateNotices(); // 画面は移らず、入力内容はそのまま
      return;
    }
    ed.saved = true;
    removeDraft(ed.draftKey);
    history.replaceState({ n: navN }, '', `#/c/${cid}/r/${combo.id}`); // location.replace と同じ置き換え（深さの記録を保つため直接行う）
    navigate();
    showToast('保存しました', { ms: 2500 });
  };

  const legendBtn = btn('top-action', '凡例', () => openLegend(legendBtn), { 'data-fk': 'legend', 'aria-haspopup': 'dialog' });
  const discard = () => { removeDraft(ed.draftKey); ed = null; render(); };
  const notice = ed.draftLoaded
    ? [at(h('div', 'notice', h('span', '', '前回の下書きを開きました'), btn('', rid ? '破棄して保存済みに戻す' : '破棄して新規', discard)), { role: 'status' })]
    : [];
  const screen = shell({
    title: rid ? '記録の編集' : '記録の新規作成',
    back: rid ? { label: '詳細に戻る', to: `#/c/${cid}/r/${rid}` } : { label: `${charName(cid)}の一覧に戻る`, to: `#/c/${cid}` },
    right: [legendBtn, btn('primary top-action', '保存', save)],
    notices: [errSlot], main: [...notice, timeEl, cmd, fields], bottom: padEl,
  });
  screen.classList.add('edit');
  screen.append(dock);
  renderTags();
  updateRow();
  sync(ed.pad.pending);
  showTime();
  updateNotices();
  return screen;
}

// ===== SECTION: 設定とデータ =====
// 書き出し・取り込み（D-006）と表示設定。書き出しの案内（remindBar）もここに置く。
const APP_VERSION = 'v0.1.0';
const IMPORT_MAX = 5 * 1024 * 1024; // 書き出しJSONは2MB想定（D-003）。それを大きく超えるファイルは別のファイルとみなして断る
const isNative = () => !!window.Capacitor?.isNativePlatform?.(); // APK内（apk/README.md）

// 端末に保存する。保存したら true、共有シートを閉じただけ（Share canceled）なら false。失敗は例外を投げる。
async function saveFile(text, name) {
  if (isNative()) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    try {
      await Share.share({ title: name, files: [uri], dialogTitle: '書き出し' });
    } catch (e) {
      if (/cancel/i.test(e?.message)) return false;
      throw e;
    }
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = at(h('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// 全データの書き出し。書き出したら lastExportAt を更新して true。キャンセルは更新せず false（保存先に渡っていないため）。
async function exportData() {
  if (!await saveFile(JSON.stringify(exportDoc(data), null, 2), exportFilename(now()))) return false;
  settings.lastExportAt = now();
  saveSettings();
  showToast('書き出しました', { ms: 2500 });
  return true;
}

// キャラ選択画面の案内（design-spec 6.1）。上部バーの下、surface 地、主ボタンにしない。
function remindBar() {
  if (loadError || !shouldRemindExport(settings, data, now())) return [];
  const last = settings.lastExportAt;
  const go = btn('', '書き出す', async () => {
    go.disabled = true;
    try {
      if (await exportData()) render({ keepScroll: true, focus: [] });
    } catch (e) {
      showToast(`書き出せませんでした（${e?.message || '原因不明のエラー'}）`);
    }
    go.disabled = false;
  });
  const later = btn('', 'あとで', () => {
    settings.remindSnoozeUntil = snoozeUntil(now());
    saveSettings();
    render({ keepScroll: true, focus: [] });
  });
  return [h('div', 'notice remind',
    h('span', 'remind-t', last === null ? 'まだ一度も書き出していません' : `最後の書き出しから${daysSince(last, now())}日たちました`),
    h('div', 'remind-btns', go, later))];
}

// 取り込みの確認シート。m は mergeImport の成功結果。loadError のときは保存データがないものとして置き換える。
function confirmImport(opener, m) {
  const replace = !!loadError;
  const sh = openSheet(opener);
  sh.closeLabel = 'やめる';
  const note = (t) => h('p', 'note', t);
  sh.show('取り込みの確認', h('div', 'sheet-body',
    h('p', 'imp-count', `追加 ${m.added}件 ／ 更新 ${m.updated}件 ／ 変更なし ${m.unchanged}件`),
    note('同じ記録は更新日時が新しい方を残します'),
    ...(replace ? [note('現在の保存データは読み込めないため、取り込んだ内容で置き換えます')]
      : m.added + m.updated === 0 ? [note('追加・更新はありません。取り込んでもデータは変わりません')] : [])),
  btn('primary', '取り込む', () => sh.close(() => applyImport(m))));
}

function applyImport(m) {
  const lost = loadError;
  const prev = data;
  if (!lost && m.added + m.updated === 0) { showToast('取り込みました（追加0・更新0）'); return; } // 書き込まない（変更日時を動かさない）
  loadError = null; // commit は読み取り専用では書かない
  if (!commit(m.doc)) {
    if (!saveError?.conflict) { loadError = lost; data = prev; } // 他タブの変更の読み直し（conflict）は loadData が決めた状態を使う
    render({ keepScroll: true, focus: ['import'] });
    return;
  }
  showToast(`取り込みました（追加${m.added}・更新${m.updated}）`);
  render({ keepScroll: true, focus: ['import'] });
}

// 取り込むファイルを読み、検証とマージまで終える。不正なら理由を message に持つ例外を投げる（データは変えない）。
async function readImport(file) {
  if (file.size > IMPORT_MAX) throw new Error(`ファイルが大きすぎます（${IMPORT_MAX / 1048576}MBまで）`);
  const text = await file.text().catch(() => { throw new Error('ファイルを読めませんでした'); });
  const parsed = parseDocText(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  const m = mergeImport(loadError ? { sections: [], combos: [] } : data, parsed.doc);
  if (!m.ok) throw new Error(m.reason);
  return m;
}

const SAMPLE_NOTATION = [{ type: 'normal', stance: 'stand', dir: 4, key: 'P', str: 'H' }, { type: 'special', motion: '236', key: 'P', str: 'H' }, { type: 'special', motion: '623', key: 'K', str: 'OD' }];
const SAMPLE_STRENGTH = [{ type: 'normal', stance: 'stand', key: 'P', str: 'L' }, { type: 'normal', stance: 'stand', key: 'K', str: 'M' }, { type: 'normal', stance: 'stand', key: 'P', str: 'H' }];

// 2択のラジオ（編集画面の位置と同じ .seg）。選ぶと即時に保存して描画し直す
function choice(legend, name, current, options, sample, onPick) {
  const set = h('fieldset', 'seg', h('legend', 'field-label', legend), ...options.map(([v, text]) => {
    const r = at(h('input'), { type: 'radio', name, 'data-fk': `${name}:${v}` });
    r.checked = current === v;
    r.addEventListener('change', () => onPick(v));
    return h('label', 'seg-item', r, h('span', '', text));
  }));
  return h('div', 'fld', set, h('div', 'set-sample', sample));
}

const setHead = (no, name) => h('h2', 'set-head', at(h('span', 'sec-no', no), { 'aria-hidden': 'true' }), h('span', 'sec-name', name));

function settingsScreen() {
  const errSlot = h('div', 'set-err');
  const fail = (title, body) => errSlot.replaceChildren(errorBox(title, body));
  const last = settings.lastExportAt;

  const exportBtn = btn('primary', 'JSONを書き出す', async () => {
    errSlot.replaceChildren();
    exportBtn.disabled = true;
    try {
      if (await exportData()) render({ keepScroll: true, focus: ['export'] });
    } catch (e) {
      fail('書き出せませんでした', e?.message || '原因不明のエラー');
    }
    exportBtn.disabled = false;
  }, { 'data-fk': 'export' });

  // 読み込みエラーで読み取り専用のときの救済: 検証に通らない保存データを、中身を変えずに控えとして書き出す
  const rawBtn = btn('primary', '保存データをそのまま書き出す', async () => {
    errSlot.replaceChildren();
    try {
      const raw = localStorage.getItem(KEYS.data);
      if (raw === null) throw new Error('保存データが見つかりません');
      if (await saveFile(raw, exportFilename(now(), '-raw'))) showToast('保存データをそのまま書き出しました', { ms: 2500 });
    } catch (e) {
      fail('書き出せませんでした', e?.message || '原因不明のエラー');
    }
  }, { 'data-fk': 'export-raw' });

  const fileIn = at(h('input'), { type: 'file', accept: 'application/json,.json', hidden: '', tabindex: '-1', 'aria-hidden': 'true' });
  const importBtn = btn('', 'JSONを取り込む', () => fileIn.click(), { 'data-fk': 'import' });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    if (!file) return;
    errSlot.replaceChildren();
    importBtn.disabled = true;
    importBtn.textContent = '読み込み中…';
    let m = null;
    try {
      m = await readImport(file);
    } catch (e) {
      fail('取り込めませんでした（データは変更していません）', e.message);
    }
    fileIn.value = '';
    importBtn.disabled = false;
    importBtn.textContent = 'JSONを取り込む';
    if (m) confirmImport(importBtn, m);
  });

  const pick = (key, name) => (v) => { settings[key] = v; saveSettings(); render({ keepScroll: true, focus: [`${name}:${v}`] }); };
  const days = last === null ? 0 : daysSince(last, now());
  const legendBtn = btn('', '凡例を見る', () => openLegend(legendBtn), { 'data-fk': 'legend', 'aria-haspopup': 'dialog' });
  const view = { size: 'L', notation: settings.notation, strengthLabels: settings.strengthLabels };

  return shell({
    title: '設定', back: { label: 'キャラクター選択に戻る', to: '#/' }, notices: banners(),
    main: [
      setHead('01', 'データ'),
      h('div', 'set-body',
        h('p', 'set-last', h('span', 'set-k', '最後の書き出し'), h('span', 'set-v', last === null ? 'まだ書き出していません' : `${dateText(last)}（${days === 0 ? '今日' : `${days}日前`}）`)),
        ...(loadError ? [h('p', 'note', '保存データを読み込めないため、通常の書き出しは止めています。取り込む前に、いまの保存データをそのまま書き出して控えを取れます。')] : []),
        h('div', 'set-btns', loadError ? rawBtn : exportBtn, importBtn, fileIn),
        errSlot),
      setHead('02', '表示'),
      h('div', 'set-body',
        choice('方向の表記', 'notation', settings.notation, [['arrow', '矢印'], ['numpad', '数字']], renderRow(SAMPLE_NOTATION, view), pick('notation', 'notation')),
        choice('ボタンの補助文字', 'strength', settings.strengthLabels, [[false, 'オフ'], [true, 'オン']], renderRow(SAMPLE_STRENGTH, view), pick('strengthLabels', 'strength')),
        h('div', 'set-btns', legendBtn)),
      h('div', 'set-foot',
        h('p', 'set-unofficial', '非公式アプリです。Capcomとは関係ありません。'),
        h('p', '', `バージョン ${APP_VERSION}`),
        h('p', 'set-font', '英字書体: Tilt Neon（SIL Open Font License 1.1）')), // OFL 1.1 の求める表示（design-spec-v2 2.4）
    ],
  });
}

const SCREENS = {
  home: homeScreen,
  list: listScreen,
  detail: detailScreen,
  edit: editScreen,
  new: editScreen,
  settings: settingsScreen,
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
let prevHash = null; // 直前に表示した画面のhash（削除のあと履歴を戻してよいかの判定に使う）
let navN = 0; // 履歴内のこのアプリの深さ。0なら戻る先がないので親画面へ置き換える
const scrollPos = new Map();

function goBack(to) {
  if (navN > 0) history.back();
  else { history.replaceState({ n: 0 }, '', to); navigate(); }
}

// 存在しない記録・セクションのないキャラの新規作成は、安全な画面（一覧）へ落とす
function redirectFor(route) {
  if (route.rid && !data.combos.some((c) => c.id === route.rid && c.characterId === route.cid)) return `#/c/${route.cid}`;
  if (route.name === 'new' && !sectionsOf(data, route.cid).length) return `#/c/${route.cid}`;
  return null;
}

function render({ keepScroll = false, focus, dir = null } = {}) {
  const route = currentRoute;
  const to = redirectFor(route);
  if (to) {
    history.replaceState({ n: navN }, '', to);
    navigate();
    return;
  }
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
  if (currentRoute?.name === 'edit' || currentRoute?.name === 'new') { // 編集画面を離れる。保存せずに離れたら下書きが残る
    if (ed?.dirty && !ed.saved) showToast('下書きを残しました', { ms: 3000 });
    saveError = null;
  }
  ed = null;
  const dir = currentRoute ? (DEPTH[route.name] >= DEPTH[currentRoute.name] ? 'fwd' : 'back') : null;
  currentRoute = route;
  prevHash = currentHash;
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
