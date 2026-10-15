# デザイン仕様 v2.1（追補）

docs/design-spec-v2.md に追加する章。ユーザーの使用感確認後の要望（フリガナ削除、記録数に応じたネオンの段階、前ステ・バクステ、強度指定なしのP・K、凡例のヘルプマーク化、ブランドロゴ）への対応。Designer作成（2026-10-15）にManagerが確定事項を反映した。コントラスト比とLab値は手計算なので、実装時にcheck.htmlの自動計算で再確認する。ユーザー不在のため、未決事項は既定案で確定した（D-013）。1章（ネオンの段階）と、それに連なる件数・レベルメーター・影の上限は、T-021（D-016）で「蛍光パネル（蛍光グリーン）」に置き換えた（初版の琥珀の軸・件数・メーターは廃止）。

## 0. 決定事項

| 項目 | 決定 |
| --- | --- |
| カナ | キャラ選択のタイルと一覧の上部バーから、見えるカナを外す。読み上げ名（`aria-label`、h1のsr-only）はカナ・日本語名のまま。件数は見せない（D-016）が、読み上げ名には残す（「リュウ 3件」） |
| ネオンの段階 | 0件の消灯と点灯10段階。閾値は `[1,2,3,5,8,12,18,28,45,70]`。色はドライブゲージの蛍光グリーンの軸を1本だけ進む（灰がかった緑 → 明るい蛍光グリーン）。キャラ選択のタイルは、板の縁から内側へ緑の光が滲み（inset）、段階が上がるほど光が板の中心へ届く「蛍光パネル」（D-016）。件数の文字とレベルメーターは出さない。英字は段階1以上で `--lit`（#EAFFF0）。文字と板の実画素の比は全段階で4.5:1以上 |
| 発光の規則 | 文字の影のぼかし・不透明度・層数の上限は変えない。「同時に見える発光要素12個まで」を「静的な発光テキスト35個まで」に改める。影のぼかしは8px以下のままだが、キャラ選択タイルの板の内側への滲み（inset、`.cell::before`）に限り、ぼかし12px・広がり6px・不透明度0.7以下まで認める（D-016）。滲みは静的な塗りで、発光テキストの数に入れない |
| ワードマーク | 一覧の上部バーの英字と「最近使ったキャラ」の英字も、同じ緑の軸にする（段階の `--tc` の色と弱い影。0件なら消灯） |
| 前ステ・バクステ | `{type:'move', id:'FWD_STEP'/'BACK_STEP'}`。チップは2pxの破線枠・塗りなし・文字だけ。パッドでは方向パッドの真下に［バクステ｜前ステ］を置く |
| 強度なしのP・K | `str:'N'`。●は無彩色の `--str-n: #858585`。中の文字との比は5.20:1。パッドの右ブロックに4段目を足し、［●P 強度なし｜●K 強度なし］を置く |
| パッドの高さ | 368pxのままでは不可能（横8列×44px＝352px＞内幅348px）。414pxにする（上限420以内）。360×740で上端は y=326 |
| ヘルプ | 「〇に？」の線画アイコン（見た目22px、線1.5px、`--fg-muted`）、タップ領域44×44、`aria-label="凡例を開く"`。詳細・編集の上部バーの［凡例］を置き換える |
| レベルメーター | 廃止（D-016）。D-015で足した下端の10目盛りは、タイル全体の蛍光の強さに置き換えた |
| ロゴ | 「看板と●●」: -12°に傾けた1本のネオン管の枠（左下に電極の切れ目）の中に、重なる2つの●（●P＝中の黄、●K＝弱の水色）を置く。枠の色は赤橙 `#FF5A2E`（T-021でネオン段階の色が緑になったため、段階とは無関係の固定色）。初版の「枠＋●P」は駐車場の標識に見えるとの指摘（T-015 B-Med4）で改めた（D-015） |
| データの版 | 新しいトークン（move）と値（str N）を足すため、`schemaVersion` を2に上げる。版1のデータは変換なしでそのまま有効（読み込みと取り込みは1と2を受け付け、書き出しは2）。版3以上は拒否（D-013） |

## 1. 記録数に応じたネオンの段階（蛍光パネル・蛍光グリーン。T-021、D-016）

### 1.1 段階の求め方（core.jsの純関数）

```js
export const NEON_STEPS = [1, 2, 3, 5, 8, 12, 18, 28, 45, 70];
export const neonLevel = (n) => NEON_STEPS.filter((t) => n >= t).length;
```

境界のテスト: 0→0、1→1、2→2、4→3、5→4、7→4、11→5、12→6、44→8、45→9、69→9、70→10、5000→10。

### 1.2 各段階の値（正本）

色の軸は、ドライブゲージ（DR）を参考にした蛍光グリーン。低い段階は灰がかった緑、高い段階ほど彩度と明るさが上がる。`l` は段階（0〜10）、`rgb` は発光色。

| 段階 | 記録数 | rgb（発光色） | 板の地（`.cell::before`） | 板の滲み（inset。ぼかし／広がり／不透明度） | 文字の影（ぼかし／不透明度） | 文字色（`.cell-en`） | `--tc`（`.wm`・`.rc-en`） | 文字/板（実画素の最小） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | なし | `--surface` #17191C | なし | なし | `--fg-muted` #AAA69D | `--fg-muted` | 7.26 |
| 1 | 1 | 150 196 164 | #1A1C1F | 4.8px／0.6px／.176 | 0.6px／.05 | `--lit` #EAFFF0 | #C9DDCF | 15.4 |
| 2 | 2 | 120 204 148 | #1B2021 | 5.6／1.2／.23 | 1.2／.10 | 同上 | #BDE6C9 | 13.7 |
| 3 | 3–4 | 98 216 138 | #1B2423 | 6.4／1.8／.286 | 1.8／.15 | 同上 | #AEEFC2 | 12.1 |
| 4 | 5–7 | 84 228 130 | #1C2924 | 7.2／2.4／.34 | 2.4／.20 | 同上 | #A0F5B8 | 12.4 |
| 5 | 8–11 | 77 242 124 | #1C2F26 | 8.0／3.0／.396 | 3.0／.25 | 同上 | #96F7B0 | 8.5 |
| 6 | 12–17 | 77 242 124 | #1D3328 | 8.8／3.6／.45 | 3.6／.30 | 同上 | #A8F9BE | 8.1 |
| 7 | 18–27 | 82 246 128 | #1F382A | 9.6／4.2／.506 | 4.2／.35 | 同上 | #BAFBCB | 8.0 |
| 8 | 28–44 | 90 250 134 | #223D2D | 10.4／4.8／.56 | 4.8／.40 | 同上 | #CBFCD8 | 6.95 |
| 9 | 45–69 | 102 252 142 | #254231 | 11.2／5.4／.616 | 5.4／.45 | 同上 | #DAFDE3 | 6.27 |
| 10 | 70以上 | 118 255 154 | #2A4735 | 12.0／6.0／.67 | 6.0／.50 | 同上 | #E8FFEE | 5.57 |

式: 板の地 = `--surface` に発光色を `l×2%` だけ混ぜた色（sRGB。値はCSSに直接書く）。板の滲み = `inset 0 0 calc(4px + l×0.8px) calc(l×0.6px) rgb(rgb / (0.12 + l×0.055))`（段階0は光なし）。文字の影 = `0 0 calc(l×0.6px) rgb(rgb / (l×0.05))` の1層（段階0はなし）。ブラウザのcomputed styleは不透明度を8bitに丸める（.175→.176）。「文字/板」は、英字を透明にして影と滲みだけを描き、字の範囲で最も明るい画素との比を実測した値（e2e 21b。360・430幅で最大0.15の差。最小は段階10の5.57）。

押下中は板だけが `--line` に変わる（即時）。英字の色と滲みは変えない（初版にあった段階0〜2の押下時の点灯色は廃止。押下中の英字と `--line` の比は、段階0で5.3、1以上で12以上）。

隣り合う段階の見分け（スクリーンショットの目視と、板の平均色のΔE76）: 0→1は2.1（英字がmutedから点灯色に変わるので、実際は一目で分かる）、1→2は3.3、以降は3.7〜6.6。レベルメーターを廃止したので、隣の段階は板の緑の濃さと、滲みが中心へ届く幅で見分ける。

### 1.3 実装（CSSの骨子。styles.cssの `/* ネオンの段階 */` 節に1か所だけ置く）

```css
[data-lv] { --l: 0; --tc: var(--fg-muted); --nc: var(--fg-muted); --ns: none; --nb: var(--surface); --np: none; }
[data-lv="1"] { --l: 1; --rgb: 150 196 164; --nb: #1A1C1F; --tc: #C9DDCF; }   /* 2〜10は1.2の表のとおり */
[data-lv]:not([data-lv="0"]) {
  --nc: var(--lit);
  --ns: 0 0 calc(var(--l) * .6px) rgb(var(--rgb) / calc(var(--l) * .05));
  --np: inset 0 0 calc(4px + var(--l) * .8px) calc(var(--l) * .6px) rgb(var(--rgb) / calc(.12 + var(--l) * .055));
}
.cell-en { color: var(--nc); }
.wm, .rc-en { color: var(--tc); }
.cell-en, .wm, .rc-en { text-shadow: var(--ns); }
.cell::before { background: var(--nb); box-shadow: var(--np); }
.cell:active::before { background: var(--line); }
```

`--lit` は #EAFFF0（点灯した名前の文字色）に改め、`--tx-lit` は廃止した。`.lit` クラスは、記録が1件以上あることの印（起動時の点灯の対象）として残す。`.rc::before` は `--key` のままで、最近使ったキャラでは英字だけ段階に合わせる。起動時の点灯（480ms）は変えない。

### 1.4 DOM

- homeScreen: キャラごとの件数のMap（既存の `counts`）から `data-lv=neonLevel(n)` を `.cell` に付ける。`.cell` の中身は `.cell-en`（英字、`aria-hidden`）だけ。件数の文字（`.cell-n`）とメーター（`.cell-lv`）は出さない。件数は読み上げ名だけが伝える: `aria-label` は「リュウ 3件」（0件は「リュウ」）。
- 最近使ったキャラ: `.rc` にも同じ `counts` から `data-lv` を付ける。
- listScreen: h1を `<span class="wm" data-lv=… aria-hidden="true">RYU</span><span class="sr-only">リュウ</span>` にする。
- タイルの寸法: `.cell { grid-template-rows: 20px; align-content: center; height: 54px; padding: 0 12px 0 14px; }`。英字はタイルの縦の中央に置く（全タイルで位置がそろう）。360×740で11段×54＋隙間＝630は変わらない。

### 1.5 発光の規則の改訂と性能の保証

v2.0の2.6を次のとおり改める。付けてよい場所に「ネオン段階のタイル（板の滲みと英字）・ワードマーク・最近使ったキャラの英字」を加える。「1画面に見えている発光要素は12個まで」を「静的な発光テキストは35個まで（キャラ選択の32＋最近使ったキャラの3）」に改める。文字の影の上限（ぼかし8px以下、不透明度0.5以下、芯は0.8以下、1要素2層まで）と `filter` 不使用は変えない。

緩める1点（D-016）: キャラ選択タイルの板の内側への滲み（`.cell::before` の `inset` の `box-shadow`）に限り、ぼかし12px・広がり6px・不透明度0.7以下まで。外側の影は不可、1層まで。理由は、案Cが「光が板の中心へ届く」ことで段階を表すため、8pxでは段階10でも中心まで届かず段階の差が出ないこと。最大でも板の内側に収まる静的な塗りで、板の外へは出ない。

32キャラ全員が段階10でも60fpsを保つ設計: (1) 文字の影は最大35個×1層。板の滲みは静的な inset 32個（動かさない）。(2) 影の値は一切アニメーションさせない。動くのは起動時の6個のopacityだけ（合成レイヤーで処理され、再ラスタは起きない）。(3) 実測（CPU 4倍・360×600・全員70件・スクロール往復）は60fps（p95 16.8ms）。55fpsを下回る場合の後退策: 段階ごとの滲みのぼかしを8px以下に戻す。

### 1.6 check.htmlのプレビュー

app.jsの `export function charTile(c, n)`（homeScreenと同じタイルを返す）を、homeScreenとcheck.htmlの両方から使う。check.htmlに「ネオンの段階」の節があり、`.grid` を2つ並べる。(a) 全段階の下限: RYUで 0、1、2、3、5、8、12、18、28、45、70件。(b) 代表値: 0、1、3、6、10、20、40、80件。KIMBERLYの80件も入れて幅を確認する。各段階の `.wm` を `--bg` の上に1行ずつ置く。自動判定: `data-lv` が期待値と一致する、タイルの見える文字が英字だけで `.cell-n`・`.cell-lv` がない、`aria-label` の件数が合う、`.cell-en` のtext-shadowが2層以下で各層のぼかしが8px以下かつアルファが0.8以下（0件は影なし）、`.cell::before` のbox-shadowが insetの1層以下でぼかし12px以下・広がり6px以下・アルファ0.7以下（0件は光なし）、`.cell-en` の色と `::before` の背景の比が4.5以上、押下中（板が `--line`）の比が4.5以上、隣り合う段階で板・滲み・文字のいずれかが異なる、板の明るさが段階で単調に増える、`filter` がnone。滲みの下の実画素の比は e2e 21b が測る。

### 1.7 レベルメーター（廃止。T-021、D-016）

T-015（D-015）で足した下端のレベルメーター（`.cell-lv`、10目盛り）と件数の文字（`.cell-n`）は、タイル全体の蛍光の強さに置き換えて削除した。件数が分かる手段は読み上げ名（`aria-label`）だけで、見た目は段階の濃さで読む。

## 2. 前ステ・バクステ

- データ（core.js）: `MOVE_IDS = ['FWD_STEP','BACK_STEP']`、`MOVE_NAMES = { FWD_STEP:'前ステ', BACK_STEP:'バクステ' }`。`isValidToken` に `case 'move': onlyKeys(t,['type','id']) && MOVE_IDS.includes(t.id)` を足す。`tokenLabel` は `MOVE_NAMES[token.id]`（矢印表記でも数字表記でも同じ）。`applyPadInput` に `case 'move'` を足す（idを検証して `insertAt`。ペンディングは破棄。システム技と同じ扱い）。`describeRow` は変更不要（行動トークンなので▶でつながり、CH・PCが付く）。直近8件にも自動で入る。
- チップ: 破線の枠の文字チップ。記号なし。2px dashed `--fg-muted`、`--r-chip`（L・S共通）、塗りなし、文字は `--fg`・700・L15px／S12px、発光なし。高さ `--chip-h`（L34／S24）、左右padding `--chip-px`（L10／S7）。renderRowのクラスは `chip sys sys-mv`。`aria-label` は「前ステ」「バクステ」。CSS: `.sys-mv { border-style: dashed; border-color: var(--fg-muted); }`。枠とbgの比は7.90、文字とbgの比は16.57。色を除いた区別: 破線の枠で塗りなし＝待ち・移動。実線の枠＋塗り（SA）、実線の枠＋»（DR）、二重の枠（DP）、角を切った板（DI）、斜めの小さな板（CH・PC）と、線種・塗り・記号で分かれる。
- パッドのキー: 方向パッドの真下の段に［バクステ｜前ステ］を置く（左右の向きを←→と揃える）。各68×46（360px）。文字14px／700。下端の帯は破線: `.band-mv::before { height:0; background:none; border-top:2px dashed var(--fg-muted); border-radius:0; }`。`aria-label` は「バックステップ」「前ステップ」。
- 書き出しの表記は「前ステ」「バクステ」。

## 3. 強度指定なしのP・K

- データ: `str` に `'N'` を足す。normalは `['L','M','H','N']`、specialは `['L','M','H','N','OD']`。`confirmButton` の許可リストにもNを足す。`STR_NAMES.N = ''`。tokenLabelは「立ちP」「屈K」「ジャンプP」「波動 ↓↘→ P」になる。`strengthChoices` はnormalが `['L','M','H','N']`、specialが `['L','M','H','N','OD']`。
- 表示: `--str-n: #858585`（無彩色、L*55.5）。`STR_CLASS.N = 'str-n'`、`.str-n { color: var(--str-n) }`。●の形と寸法は強度●と同じ。補助文字のバッジは付けない（`dot(key, cls, str === 'N' ? null : str)`）。

| 比較 | 値 |
| --- | --- |
| 中の文字（ink）／●の比 | 5.20（4.5以上） |
| ●とbg・surface・keyの比 | 5.20／4.76／4.17（3以上） |
| L*（グレースケールでの差） | 強度なし55.5、強72.2、弱81.1、中86.4、DI69.0（形は角を切った板）、OD64.8（形は●2つと「OD」） |

- パッド配置（高さ414px。360×740で上端 y=326）: 下段ブロックを4段にする（段の高さ46、間隔6）。

```
左140（方向）           右（4列）
[↖][↑][↗]             [立ち][↓][J][消す]
[←][N][→]             [●P弱][●P中][●P強][OD-P]
[↙][↓][↘]             [●K弱][●K中][●K強][OD-K]
[バクステ][前ステ]      [●P 強度なし][●K 強度なし]   ← 追加の段（右は各2列分の幅）
```

```css
.lower { height: 202px; }
.dirs  { grid-template-rows: repeat(4, 46px); gap: 6px 4px; }
.steps { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.btns  { grid-template-rows: repeat(4, 46px); gap: 6px 4px; }
.nkey  { grid-column: span 2; flex-direction: row; gap: 6px; }
.nkey .dot { --dot: 30px; }
.nkey-t { font: 400 12px/1.2 var(--font); color: var(--fg-muted); }
:root { --pad-h: 414px; }
```

合計の高さは 1＋5＋44＋4＋46＋4＋46＋4＋44＋4＋4＋202＋6 ＝ 414px。キーはすべて44×44以上（360pxで、強度なしのキーは96×46、バクステ・前ステは68×46）。強度なしのキーの中身は灰色の●30pxと「強度なし」。`aria-label` は「P 強度なし」「K 強度なし」。押したら `act({type:'button', key, str:'N'})`。トーストの位置の `calc(368px…)` を `var(--pad-h)` に置き換える。`@media (max-height:640px)`（初版は560px。高さ640px級の端末でも、パッドの上に入力欄が残らないようにするため T-015 で引き上げた）で、パッドをコマンド列の下の通常の流れに置く。トーストをパッドの上に出す処理は `min-height:641px`。
- 368pxに収まらない理由: 方向パッド3列＋強度なしを足すとボタンが5列になり、360pxでの内幅348pxに8列×44px＝352pxが入らない。縦も、直近8件と［完了］の段、プリセット2段、システム行はどれも外せない。
- チップのポップオーバー: 強度の行は［弱●］［中●］［強●］［●（灰）］（必殺技は続けて［OD］）。灰色の選択肢は●だけで `aria-label="強度なし"`。5択のときは `.opt` のpaddingを左右4pxにする。

## 4. ヘルプマーク

スプライトに追加する記号:

```html
<symbol id="i-help" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M9.25 9.5A2.75 2.75 0 1 1 13.15 12C12.4 12.35 12 12.95 12 13.75V14.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="12" cy="17.6" r="1.15" fill="currentColor"/>
</symbol>
```

- 通常: `iconBtn('i-help','凡例を開く', …, {'data-fk':'legend','aria-haspopup':'dialog'})` にクラス `help` を足す。44×44、記号24px、色 `--fg-muted`（bgとの比7.90）。押下は `.icon-btn:active` の地 `--line-strong` に加え、`.help:active { color: var(--fg) }`（即時）。フォーカスは全体の2pxのリング。
- 置き場所: 詳細は［‹］［タイトル］［?］。編集は［‹］［タイトル］［?］［保存］。どちらも［凡例］の文字ボタン（`top-action`）を置き換える。
- 設定画面の［凡例を見る］: 副ボタンのまま、先頭に `i-help`（20px）を付ける。凡例シートの見出しは「凡例」のまま。
- 凡例の表に足す行: 「ボタン」群に灰色の●P（灰色の円＝強度の指定なし、書き出し「P」）。新しい「移動」群に、前ステ（前ステップ。破線の枠）と、バクステ（バックステップ。破線の枠）。

## 5. ブランドロゴとアプリアイコン

採用案は「看板と●●」。-12°に傾けた1本の管で看板の枠を描き、左下に電極の切れ目を残し、中にアプリ固有の重なる2つの●（●Pと●K）を置く。意味は、看板（記録の量で点灯する名前）とボタン（コマンドの記法）というアプリの2つの柱。枠の色はネオン段階の最上段のにじみと縁の色 `#FF5A2E` で、「記録をためた看板が点ききった姿」を表す。●の形・色・重なり方は、アプリの中のボタンと同じ（ODの●2つの重なりと同系。重なりは直径の約24%）。SF6のロゴ、「6」、Capcomの書体は使わない。VectorDrawableへ変換しやすいよう、パス（管・P・K）と円（●の本体・縁取り）だけで描き、管の芯を内側の細い線で描く（にじみに頼らない）。不採用: 一筆の入力（改行キーに見える問題を繰り返す）、つなぎ（●▶が再生アイコンに見える）。初版の「枠＋●P」は、青い角丸の枠に白いPで「駐車場」の標識に見えるとの指摘（T-015のB-Med4）があり、●を2つの強度色にして改めた。

- 枠: 外側の寸法を横長にして（中心線の高さ180、上辺の長さ292）、中の●を大きく取る。4隅の中心線は (91,346)、(129,166)、(421,166)、(383,346)、傾きは約11.9°（-12°とみなす）。管の太さ28。外接矩形の中心は (256,256)。最も遠い角 (421,166) は中心から188.1で、線の半分14を足して202.1 < 205（maskableの安全円内）。切れ目は下辺の x=147〜225。
- ●: 直径120（半径60）。左の●P＝`--str-m` #F0D870、中心 (210,256)。右の●K＝`--str-l` #8FD3F0、中心 (302,256)。重なりは28。●Kを手前に置き、周りを地の色の半径63の円で縁取って（3px）●Pと分ける。P・Kの線は `--ink` #0E0F11、太さ13、線端は四角、角は尖らせる。形は `#i-dot-p` `#i-dot-k` を3.33倍にしたもの。
- 色の比（手計算を自動計算で再確認済み）: 管とbg = 6.17、●P（黄）とbg = 13.48、●K（水色）とbg = 11.64、文字（ink）と●P = 13.48、文字と●K = 11.64。
- 出力は `icon.svg`、`icon-192.png`、`icon-512.png`。APKの旧端末用 mipmap は、`icon.svg` を各密度（48・72・96・144・192）で直接書き出し、`_round` は円形に切る。

`app/icon.svg`（512×512。filterはPNG書き出し用の例外）:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <filter id="halo" filterUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><feGaussianBlur stdDeviation="12"/></filter>
    <path id="tube" d="M147 346H91L129 166H421L383 346H225" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </defs>
  <rect width="512" height="512" fill="#0E0F11"/>
  <use href="#tube" stroke="#FF5A2E" stroke-width="28" opacity=".6" filter="url(#halo)"/>
  <use href="#tube" stroke="#FF5A2E" stroke-width="28"/>
  <use href="#tube" stroke="#FFC4A0" stroke-width="9"/>
  <circle cx="210" cy="256" r="60" fill="#F0D870"/>
  <path d="M193.33 286V226h20a16.67 16.67 0 0 1 0 33.33h-20" fill="none" stroke="#0E0F11" stroke-width="13" stroke-linecap="square" stroke-linejoin="miter"/>
  <circle cx="302" cy="256" r="63" fill="#0E0F11"/>
  <circle cx="302" cy="256" r="60" fill="#8FD3F0"/>
  <path d="M282 226v60M322 226L285.33 259.33M297 249.33L323.67 286" fill="none" stroke="#0E0F11" stroke-width="13" stroke-linecap="square" stroke-linejoin="miter"/>
</svg>
```

Androidのアダプティブアイコンの前景（`apk/.../drawable-v24/ic_launcher_foreground.xml`）は、今と同じ配置（`translateX/Y=12.8`、`scale=0.161`）で中身を次のパスに置き換える（にじみは省く）。

```xml
<path android:pathData="M147,346H91L129,166H421L383,346H225" android:strokeColor="#FF5A2E" android:strokeWidth="28" android:strokeLineCap="round" android:strokeLineJoin="round"/>
<path android:pathData="M147,346H91L129,166H421L383,346H225" android:strokeColor="#FFC4A0" android:strokeWidth="9" android:strokeLineCap="round" android:strokeLineJoin="round"/>
<path android:fillColor="#F0D870" android:pathData="M210,256m-60,0a60,60 0,1 1,120 0a60,60 0,1 1,-120 0"/>
<path android:pathData="M193.33,286V226h20a16.67,16.67 0,0 1,0 33.33h-20" android:strokeColor="#0E0F11" android:strokeWidth="13" android:strokeLineCap="square" android:strokeLineJoin="miter"/>
<path android:fillColor="#0E0F11" android:pathData="M302,256m-63,0a63,63 0,1 1,126 0a63,63 0,1 1,-126 0"/>
<path android:fillColor="#8FD3F0" android:pathData="M302,256m-60,0a60,60 0,1 1,120 0a60,60 0,1 1,-120 0"/>
<path android:pathData="M282,226v60M322,226L285.33,259.33M297,249.33L323.67,286" android:strokeColor="#0E0F11" android:strokeWidth="13" android:strokeLineCap="square" android:strokeLineJoin="miter"/>
```

アプリ内の使い方: スプライトに `<symbol id="i-logo" viewBox="77 152 358 208">`（上の管2本、●2つと縁取り、P・K。P・Kと縁取りは `var(--ink)`。CSSではにじみを付けない）を置く。キャラ選択の上部バーに `<h1 class="solo"><svg class="logo" aria-hidden="true"><use href="#i-logo"/></svg>SF6戦略メモ</h1>`、`.logo { width:34px; height:20px; vertical-align:-3px; margin-right:var(--s2); }`。名前の文字はシステムフォントの17px／700のまま（Tilt Neonのサブセットにかなと漢字がなく、名前が2つの書体に割れるため併記しない）。ロゴは動かさない。48pxに縮めても、傾いた枠と、黄と水色の重なる●の2つが判別できる（目視確認済み）。`sw.js` の `CACHE` はデプロイ時に置き換わる（D-014）。

## 6. 影響の整理

| 対象 | 変更 |
| --- | --- |
| core.js | `NEON_STEPS`、`neonLevel`、`MOVE_IDS`、`MOVE_NAMES`、isValidToken（move、N）、confirmButton（N）、applyPadInput（`move`）、strengthChoices（N）、`STR_NAMES.N`、tokenLabel（move）、`SCHEMA_VERSION=2`（版1も受け付ける） |
| app.js | renderRow（`canTap`）・chipNodes（`STR_CLASS.N`、`sys-mv`、Nはバッジなし）、buildPad（`.steps`、`.nkey`×2）、openChipMenu（N）、homeScreenと`charTile`（カナ・件数を外す、`data-lv`）、最近使ったキャラ（`data-lv`）、listScreenのh1、詳細・編集のhelpボタン、設定の［凡例を見る］、legendTableの行、ロゴ |
| index.html | `i-help`、`i-logo` |
| styles.css | `--str-n`、`--pad-h`、`--line-field`（入力欄・選択肢の枠 #6B727C。地との比3.95・surfaceとの比3.63・keyとの比3.16で、すべて3:1以上。T-015 B-Low5）、ネオン段階の節（T-021で蛍光グリーンに。`--lit` を #EAFFF0 に、`--tx-lit` を廃止）、`.sys-mv`、`.band-mv`、`.cell`の2行のグリッド、`.lower`／`.dirs`／`.btns`の4段、`.steps`、`.nkey`、`.help`、`.logo`。`.kn` と `.cell-name` は削除。トーストの位置を `var(--pad-h)` に |
| CLAUDE.mdのトークン節 | `--str-n` #858585、`--pad-h` 414px、ネオン段階の1行（閾値、正本はdesign-spec-v2.1の1章）、発光の行に「静的な発光テキストは35個まで」。T-021: 蛍光グリーンの軸、滲みのぼかし12px（キャラ選択タイルのinsetだけ）の例外 |
| e2e | パッドの高さ414・上端 y≥326（今は368・372）。`.cell` を `hasText:'リュウ'` で当てている箇所は `.cell[aria-label^="リュウ"]` に変える。点灯タイルの期待値（段階に応じた板・文字の色）を更新（T-021: 蛍光グリーンの表と、実画素の文字/板の比の実測に差し替え。メーターの検査（23b）は削除）。凡例ボタンは `[aria-label="凡例を開く"]` で当てる |
| check.html | ALLとSYSMIXに、move（2種）、`str:'N'` の通常技と必殺技を足す。構造の判定（`.sys-mv` のborderTopStyleがdashed、`.dot.str-n` の色が rgb(133,133,133)、L寸法の `.sys-mv` と `.str-n` に発光がない）。1.6の段階の節 |
| アイコン | icon.svgとPNG 2つ、ic_launcher_foreground.xmlとmipmap（`sw.js` のCACHEはデプロイ時に置換。D-014） |

## 7. 受け入れの観点

1. 幅360・390・430で、キャラ選択、一覧、詳細、編集、凡例、check.htmlに横スクロールがない。`.cell-en` のscrollWidthがclientWidth以下。
2. キャラ選択と一覧の上部バーに、見えるカナがない。キャラ選択のタイルに件数の文字・メーターがなく、`.cell` の `aria-label` が「リュウ 3件」形式（0件は名前だけ）で、一覧のh1の読み上げ名が「リュウ」。
3. ネオン段階: neonLevelの境界が1.1のとおり。タイルの英字（段階10でも）と、滲みを含む板の実画素の比が4.5以上（e2e 21bの実測）。文字の影は2層以下でぼかし8px以下・アルファ0.8以下。板の滲みはinsetの1層で、ぼかし12px以下・広がり6px以下・アルファ0.7以下。`filter` はnone。隣り合う段階で板か文字が異なり、板の明るさが段階で単調に増える。0件の板は `--surface` で光なし。0件の `.wm` と `.rc-en` はmutedで影なし。
4. 前ステ・バクステ: パッドから1タップで入る。▶で前後とつながり、CHを付けられる。チップは2pxの破線で塗りがない。グレースケール（`?gray=1`）でもSA・DR・DP・DI・CH・PCと区別できる。保存→再読み込み、書き出し→取り込みで値が一致する。
5. 強度なし: ↓→●P（強度なし）で `{normal, crouch, P, N}`、236→●K（強度なし）で `{special, 236, K, N}` が入る。`aria-label` は「屈P」「波動 ↓↘→ K」。中の文字と●の比が4.5以上。補助文字オンでもバッジが出ない。ポップオーバーの5択が各44px以上。
6. パッド: 360×740で高さ414、上端 y≥326、全キーが44×44以上、横スクロールなし、システム行ののぞきは今のまま。パッドを開いたとき `.cmd` の下端と `#f-sec` の上端がパッドの上端より上にある。トーストがパッドの上に出る。
7. ヘルプ: 詳細と編集の上部バーに［凡例］の文字がなく、44×44の `button[aria-label="凡例を開く"]` がある。押すと凡例が開き、閉じるとフォーカスがこのボタンに戻る。
8. 性能: 32キャラ×70件（全員が段階10）で、CPUを4倍に落とし、360×600でキャラ選択をスクロールしたとき55fps以上。満たさなければ1.5の後退策をとる。
9. アイコン: 48dpに縮小して、傾いた枠と、重なる2つの●（黄と水色）が判別できる。本体がmaskableの安全円（半径205）に収まる。公式ロゴを連想させない。VectorDrawableにfilterがない。
10. データ: 版1のデータ（move・Nを含まない）がそのまま読み込めて保存できる。版3以上は拒否。moveとNを含む文書の書き出し→取り込みの往復が一致する。
11. デザイン品質: 紫・青紫・グラデーション・すりガラス・明滅のループがない。発光は、記録の量・DR・ODのどれかの意味を持つ場所にだけある。

## 8. 未決事項の既定案（ユーザー不在のため確定済み）

| 論点 | 既定案 |
| --- | --- |
| パッドの高さ | 414px。368pxを守る後退案（前ステ・バクステをシステム行へ、強度なしはポップオーバーで後から変更）は採らない |
| 段階の色の軸 | 蛍光グリーン（灰がかった緑 → 明るい緑）。初版は暖白→電球色→琥珀→赤橙だったが、T-021（D-016）で置き換えた |
| 閾値 | 1/2/3/5/8/12/18/28/45/70 |
| 0件のキャラの一覧の上部バーの英字 | 消灯（muted）にする（今は常に点灯なので振る舞いが変わる） |
| ロゴの中の文字 | 初版はPを残す案。T-015で、●P・●Kの重なりに変更（D-015） |
| ワードマーク | ロゴマーク＋和文「SF6戦略メモ」。Tilt Neonの併記はしない |
| Android 13のテーマアイコン（monochrome） | 今回は足さない |
| 前ステ・バクステのテキスト取り込みの別名（66・44など） | 書き出しと同じ語だけを受け付ける（テキスト取り込みはPhase 2） |
