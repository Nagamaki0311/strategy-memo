import { describeRow, motionToArrows } from './core.js';

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
  if (dir === '5') { // ニュートラルは矢印ではなく中点（CSSで描く）
    const n = el('span', 'neutral');
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
