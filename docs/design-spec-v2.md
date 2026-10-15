# デザイン仕様 v2（ネオン街）

docs/design-spec.md（v1）の章を差し替える改訂。ここに書かない項目はv1のままとする。Designer作成（2026-10-15）にManagerが確定事項を反映した。コントラスト比とLab値は手計算なので、実装時にツールで再確認する。

## 0. 決定事項

| 項目 | 決定 |
| --- | --- |
| 世界観 | 「夜の路地の看板」。地は暗く、意味を持つものだけが光る。発光させるのは、DR緑とOD橙（ユーザー指定の蛍光色）、記録があるキャラの名前（点灯した看板）の2種類に限る |
| 地の色 | 暖かい黒（#16140F）から、わずかに寒色のほぼ黒（#0E0F11）へ変更。文字は暖白（#F2EEE6） |
| システム技 | 種別ごとに色と形を1つずつ変える。SA＝単線の枠、DR系＝枠と枠内の»、DP・Dリバ＝紺の二重枠、DI＝銀の板で四隅を45°に切る、OD＝橙の●2つの重なり、CH・PC＝斜めの小さな板 |
| 強度の● | 色も形も変えない。ODとの差はCIELABで ΔE76 が約53〜60 |
| 欧文の書体 | Tilt Neon（SIL OFL 1.1、Reserved Font Nameなし）。英大文字・数字・記号だけのサブセットを、styles.cssにdata URIで埋め込む。和文はシステムフォント |
| キャラ選択 | 斜めに切ったタイルの3列。英字の名前（看板）とカナ（小さな札）を併記。記録があるキャラだけ点灯 |
| 動き | 演出は、起動時の点灯（1回だけ）とタイル押下の即時点灯の2つを足す。パッドと編集中はv1のまま |
| ダメージ | 編集画面に数値の入力欄。一覧は行メタの右端、詳細はタイトルの下の1行に出す。未入力なら出さない |
| ［完了］ | パッドの直近8件の段（R1）の右端に固定（幅64×高さ44）。パッド合計368pxは変えない。閉じた後は、下部の「パッドの格納バー」かコマンド列のタップで開き直す |
| Dリバの色 | 指定がないため、DPと同じ紺の二重枠（防御系のドライブ）。別の指定があれば差し替える |
| 英字の表記 | 日本版に合わせてGOUKI、VEGA（カナの豪鬼・ベガと一致させるため） |

## 1. 方針

- 夜の路地では、点いている看板だけが情報になる。地・罫線・UIの枠は「消灯した金属」、コマンド列は「掲げられた看板」、発光は「その看板の中で意味を持つ管」とする。
- 発光の理由は2つに限る。(1) DR緑とOD橙は、ユーザーが蛍光と指定した色で、「ラッシュでつなぐ」「ODで強化する」という分岐点にあたる。DI（鈍い銀）とDP（紺）は光らない素材として描く。(2) 記録があるキャラの名前は、データの有無を表す。主ボタン、見出し、フォーカス、エラーは光らせない。
- 使わないもの: 紫・青紫・ピンクとシアンのグラデーション、背景の装飾（グリッド線、走査線、ノイズ、雨、レンガの質感）、明滅のループ、常時のちらつき、すりガラス。発光は静的に描き、動かさない。
- 幾何は3種類に揃える。管の太さは2px（S寸法は1〜2px）、斜めの角度は-12°の1種類、面取りは45°の1種類。
- 公式サイトから取る文法は、斜めに切ったタイルの3列グリッド、英字ワードマークの名前、技表の「矢印列＋ボタン」の横並び、セクションの帯。紫の地、写真、ロゴ、公式の書体、斜体で縦長のディスプレイ書体は使わない。
- 編集画面とパッドは操作性を維持し、トークンの色とネオンの質感の味付けにとどめる（ユーザー指示）。
- ダーク固定。`theme_color`、`background_color`、`<meta name="theme-color">` は `#0E0F11`。

### requirements 5章の「理由なく既定にしない要素」との関係

| 要素 | v2での扱い | 理由 |
| --- | --- | --- |
| グロー | DR・OD（L寸法のみ）と点灯した名前に限る | 発光の意味（上記）。S寸法・パッド・UIの枠には付けない |
| グラデーション・すりガラス | 使わない | なし |
| カード | 使わない。タイルはキャラ選択だけ | タイルは「看板の板」という意味を持つ部品。一覧の行はカードにしない |
| システムフォント | 和文は継続。欧文の看板文字だけTilt Neon | オフラインで使えること、和文の容量、可読性 |
| 装飾だけのアニメ | 起動時の点灯を1回だけ（480ms、入力を妨げない）。ループなし | 世界観を伝える役割に限り、明示的に採用する |

## 2. トークン

### 2.1 色（v1 2章の色を差し替え）

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--bg` | `#0E0F11` | 地 |
| `--surface` | `#17191C` | 下部バー、パッドの地、セクションの帯、シート、消灯したタイル |
| `--key` | `#22252A` | パッドのキー、SAチップの塗り、トースト、点灯したタイル |
| `--line` | `#2E3238` | 罫線（装飾）、押下中のタイル |
| `--line-strong` | `#4A5059` | キーの1pxの枠、CH・PCの板、押下中のキー |
| `--fg` | `#F2EEE6` | 本文、矢印、SAの枠、選択枠、フォーカスリング、主ボタンの塗り |
| `--fg-muted` | `#AAA69D` | 補助の文字、消灯した名前、カナ |
| `--conn` | `#8C8A85` | ▶ |
| `--ink` | `#0E0F11` | ●の中の文字、DIの文字、主ボタンの文字 |
| `--lit` | `#FFF4DE` | 点灯した看板の文字（英字の名前） |
| `--str-l` | `#8FD3F0` | 弱（変更なし） |
| `--str-m` | `#F0D870` | 中（変更なし） |
| `--str-h` | `#F29A8E` | 強（変更なし） |
| `--od` | `#FF7410` | OD（「OD」の文字と●2つ）。蛍光の橙 |
| `--dr` | `#4DF27C` | CDR・生ラッシュ（枠、»、文字）。蛍光の緑 |
| `--di` | `#A3A9B2` | DIの板。鈍い銀 |
| `--dp` | `#1B2A66` | DP・Dリバの塗り。紺 |
| `--dp-line` | `#7F98FF` | DP・Dリバの二重枠、パッドの帯の色 |
| `--scrim` | `rgba(0,0,0,.6)` | 変更なし |

### 2.2 コントラスト比（手計算）

文字（4.5:1以上）: fg／bg・surface・key = 16.57／15.22／13.28。fg／line-strong = 7.03。fg／DPの塗り = 11.56。muted／bg・surface・key・line = 7.90／7.26／6.33／5.31。lit／bg・surface・key・line = 17.58／16.14／14.09／11.81。ink／弱・中・強の● = 11.64／13.48／8.94。ink／ODの● = 7.08。ink／DIの板 = 8.10。ink／fg（主ボタン）= 16.57。DRの文字／bg・key = 13.06／10.47。ODの文字／bg・key = 7.08／5.68。

図形（3:1以上）: ▶／bg・surface = 5.56／5.11。矢印・カーソル・フォーカスリング（fg）／bg・surface = 16.57／15.22。DRの管／bg = 13.06。DPの線／bg・DPの塗り = 7.16／4.99。DIの板／bg = 8.10。●（弱・中・強）／bg = 11.64／13.48／8.94。●（OD）／bg = 7.08。パッドの帯（DR・DI・DP・SA）／key = 10.47／6.50／5.74／13.28。

キーの枠（line-strong）とsurfaceの比は2.17。v1と同じ扱いの装飾線で、キーはラベルで識別できる。

### 2.3 色の区別（強度●とOD・DR・DP）

| 色 | HEX | L* | C* | h（Lab） |
| --- | --- | --- | --- | --- |
| 弱 | #8FD3F0 | 81.1 | 25 | 236° |
| 中 | #F0D870 | 86.4 | 54 | 95° |
| 強 | #F29A8E | 72.2 | 37 | 33° |
| OD | #FF7410 | 64.8 | 85 | 55° |
| DR | #4DF27C | 85.3 | 80 | 146° |
| DPの線 | #7F98FF | 65.1 | 57 | 289° |
| DI | #A3A9B2 | 69.0 | 5 | 無彩 |

ΔE76: OD／強 = 53、OD／中 = 60、DR／弱 = 84、DR／中 = 63、DPの線／弱 = 49。ODと強は明度の差が小さく（ΔL* 7）、主な差は彩度（C* 85と37）なので、形を必ず併記する。ODは「OD」の文字、●2つの重なり、L寸法でのにじみを持ち、強度の●は1つでにじみがない。Chrome DevToolsの「Emulate vision deficiencies」でProtanopiaとDeuteranopiaを試し、形で区別できることを確認する。

### 2.4 文字

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--font` | v1と同じ | 和文とUI |
| `--font-sign` | `"Tilt Neon", system-ui, sans-serif` | 看板の英字、セクション番号 |
| `--t-xs`〜`--t-lg` | v1と同じ | なし |
| `--sign-l` | 20px/1 | タイルの英字の名前 |
| `--sign-m` | 18px/1 | 一覧の上部バーのワードマーク |
| `--sign-s` | 15px/1 | 最近使ったキャラ、セクション番号 |

看板の英字は太さ400のみ、`letter-spacing: .04em`。ダメージの数字はシステムフォントの700、`tabular-nums`。

書体の選択: Tilt Neonのサブセットをdata URIで埋め込む。サブセットはwoff2で8KB以下（base64後11KB以下、上限woff2 12KB）。ネオン管の文字を元にした単線・丸端の書体で題材と一致する。自作SVGパス案は字形と字間の品質リスクが大きく、CSSのtext-stroke案は管らしさが出ないため採らない。

作り方（1回だけ実行して成果物をコミットする。ビルド工程は増やさない）:

1. `fontTools.varLib.instancer` でXROT=0・YROT=0の静的な字形に固定する。
2. `pyftsubset` で `U+0020,U+002D,U+002E,U+0030-0039,U+0041-005A` に絞り、`--flavor=woff2 --layout-features=kern` を付ける。
3. 出力をbase64にし、styles.cssの先頭の `@font-face { font-family:"Tilt Neon"; src:url(data:font/woff2;base64,…) format("woff2"); font-display:swap; }` に入れる。

data URIにする理由は、Service Workerの配信リストが変わらない、オフラインで確実に読める、取得待ちによる文字の切り替わりが出ない、の3点。ライセンスの扱い: `app/OFL-TiltNeon.txt` に著作権表示（Copyright 2019 The Tilt Project Authors）とOFLの全文を置く。`@font-face` の直前に1行のコメントで出典を書く。設定画面のバージョン行の下に「英字書体: Tilt Neon（SIL Open Font License 1.1）」を12px・mutedで1行出す。フォントの入手元はgoogle/fontsのofl/tiltneon。

キャラ名の表記: 英字のワードマークを主にし、カナを従として必ず併記する。カナは読み上げ名を兼ねる。CHARACTERSマスタに `en` を足す。

| スラッグ | 英字 | スラッグ | 英字 | スラッグ | 英字 | スラッグ | 英字 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ryu | RYU | luke | LUKE | jamie | JAMIE | chunli | CHUN-LI |
| guile | GUILE | kimberly | KIMBERLY | juri | JURI | ken | KEN |
| blanka | BLANKA | dhalsim | DHALSIM | ehonda | E.HONDA | deejay | DEE JAY |
| manon | MANON | marisa | MARISA | jp | JP | zangief | ZANGIEF |
| lily | LILY | cammy | CAMMY | rashid | RASHID | aki | A.K.I. |
| ed | ED | gouki_akuma | GOUKI | vega_mbison | VEGA | terry | TERRY |
| mai | MAI | elena | ELENA | sagat | SAGAT | cviper | C.VIPER |
| alex | ALEX | ingrid | INGRID | yasmine | YASMINE | arjun | ARJUN |

### 2.5 余白・角丸・形

余白 `--s1`〜`--s6` と角丸はv1のまま。追加: `--skew: -12deg`（タイル、最近使ったキャラ、CH・PCで使う唯一の傾き。上辺が右に寄る「／」の向き）、`--chamfer-l: 6px`、`--chamfer-s: 4px`（DIの面取り）。

### 2.6 発光の規則

| トークン | 値 |
| --- | --- |
| `--glow-dr` | `0 0 6px rgb(77 242 124 / .45), inset 0 0 4px rgb(77 242 124 / .30)` |
| `--tx-dr` | `0 0 4px rgb(77 242 124 / .5)` |
| `--glow-od` | `0 0 6px rgb(255 116 16 / .5)` |
| `--tx-od` | `0 0 4px rgb(255 116 16 / .5)` |
| `--tx-lit` | `0 0 1px rgb(255 244 222 / .8), 0 0 8px rgb(255 196 120 / .35)` |

- 付けてよい場所: `.row:not(.S)` の中のDRチップとOD（L寸法の詳細・編集のコマンド列と凡例）、点灯したタイルの英字、押下中のタイル、最近使ったキャラの英字、一覧の上部バーのワードマーク。
- 付けない場所: S寸法（一覧のプレビュー、直近8件）、パッドのすべて、ポップオーバー、UIの枠、ボタン、フォーカス、エラー。
- 上限: ぼかしの半径は8px以下、不透明度は0.5以下（1pxの芯だけ0.8まで）、1要素あたりの影は2層まで、同時に動く発光は0。
- 実装: `box-shadow` と `text-shadow` だけを使う。`filter: drop-shadow`、`filter: blur`、`backdrop-filter` は使わない。影の値はアニメーションさせない。1画面に見えている発光要素は12個までを想定し、実測で60fpsを下回る場合は点灯タイルの第2層（8px）を外す。

## 3. チップの文法（v1 3章の改訂）

### 3.1 システム技とOD

| 種類 | 形（色を除いた手がかり） | 枠 | 塗り | 文字 | 発光（L寸法のみ） |
| --- | --- | --- | --- | --- | --- |
| SA1〜3 | 単線の角丸の枠 | 2px `--fg`、`--r-chip` | `--key` | `--fg`（700） | なし |
| CDR・生ラッシュ | 単線の角丸の枠＋枠内の左の開いた二重の山形（»） | 2px `--dr`、`--r-chip` | なし | `--dr`（700） | `--glow-dr`、文字に `--tx-dr` |
| DP・Dリバ | 二重の枠（外2px、紺の隙間2px、内1px） | `--dp-line` | `--dp` | `--fg`（700） | なし |
| DI | 枠のない明るい板。四隅を45°に切る。文字は暗い | なし | `--di`（上端に1pxのハイライト） | `--ink`（700） | なし |
| OD | 「OD」の文字＋●2つの重なり（v1と同じ寸法・重なり） | なし | ●は `--od` | 「OD」は `--od` | ●に `--glow-od`、文字に `--tx-od` |
| CH・PC | 枠のない小さな斜めの板（平行四辺形） | なし | `--line-strong`（`::before` を `skewX(var(--skew))`） | `--fg` 12px／700 | なし |
| 強度● | 1つの塗り円（v1のまま） | なし | 強度の色 | `--ink` | なし |

- 寸法: 高さ・文字の大きさはv1と同じ（L: 34px・15px、S: 24px・12px）。左右のpaddingはLでSA・DR・DIが10、DPが12。SはSA・DR・DIが7、DPが8。CH・PCは左右6。S寸法のDPは外1px・隙間1px・内1px。
- »の記号: Lは12×12、Sは9×9。スプライトに `i-rush`（`<symbol id="i-rush" viewBox="0 0 12 12"><path d="M1.5 2L5.5 6L1.5 10M6.5 2L10.5 6L6.5 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter"/></symbol>`）を追加する。開いた線画なので、塗りの▶とも軸のある矢印とも区別できる。aria-hiddenとし、読み上げ名はv1のまま（「CDR」「生ラッシュ」）。
- 色を除いたときの区別: 塗りのある円＝●、軸のある線＝矢印、塗りのない円弧＝360、軸のない小さな三角＝▶、単線の枠＝SA、単線の枠＋»＝DR系、二重の枠＝DP系、角を切った明るい板（暗い文字）＝DI、「OD」＋重なった2円＝OD、小さな斜めの板＝注記、破線の枠＝待ち・移動。同じ形を2つの意味に使わない。
- requirements 3.3の「システム技・SA＝角丸の文字チップ」は、「システム技・SA＝文字チップ。種別ごとに枠の形を変える（本書3.1）」に改める。

### 3.2 実装メモ（CSSの骨子）

```css
.sys { position: relative; isolation: isolate; border: 2px solid transparent; background: none; }
.sys-sa { border-color: var(--fg); background: var(--key); color: var(--fg); }
.sys-dr { border-color: var(--dr); color: var(--dr); }
.sys-dr .rush { width: 12px; height: 12px; }
.row.S .sys-dr .rush { width: 9px; height: 9px; }
.sys-dp { border-color: var(--dp-line); background: var(--dp); color: var(--fg); padding-inline: 12px;
  box-shadow: inset 0 0 0 2px var(--dp), inset 0 0 0 3px var(--dp-line); }
.row.S .sys-dp { border-width: 1px; padding-inline: 8px; box-shadow: inset 0 0 0 1px var(--dp), inset 0 0 0 2px var(--dp-line); }
.sys-di { border: 0; color: var(--ink); --c: var(--chamfer-l); }
.row.S .sys-di { --c: var(--chamfer-s); }
.sys-di::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--di);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .35);
  clip-path: polygon(var(--c) 0, calc(100% - var(--c)) 0, 100% var(--c), 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, var(--c) 100%, 0 calc(100% - var(--c)), 0 var(--c)); }
.tag { position: relative; isolation: isolate; background: none; padding: 0 6px; }
.tag::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--line-strong); border-radius: var(--r-tag); transform: skewX(var(--skew)); }
.row:not(.S) .sys-dr { box-shadow: var(--glow-dr); text-shadow: var(--tx-dr); }
.row:not(.S) .dot.od { box-shadow: var(--glow-od); }
.row:not(.S) .ltr.od { text-shadow: var(--tx-od); }
```

`clip-path` はDIの `::before` にだけ当てる（チップ本体に当てると選択枠とフォーカスリングが切れる）。`::after` はv1のタップ領域（44px）用なので使わない。

## 4. パッド

- 寸法はv1のまま（368px）。R1（直近8件）を `display:flex; gap:4px; height:44px` にする。左は `.recent-keys` か `.recent-empty`（`flex:1; min-width:0`、横スクロールはv1のまま）、右端に［完了］キーを固定する（`flex:none; width:64px; height:44px`）。直近の列の見える幅は、360pxで280px。
- ［完了］キー: 通常のキーと同じスタイル。16pxの▾（`i-chev` を90°回転）と「完了」（14px／700）。`aria-label="パッドを閉じて項目の入力へ"`、`aria-controls="pad"`。押すと、(1) ペンディングは破棄せず保持、(2) パッドを `hidden` にする（`ed.padHidden = true`）、(3) 格納バーを出す、(4) `#f-sec`（セレクト）にフォーカスを移す。保存はしない（下書きは自動で保存される）。
- パッドの格納バー: パッドが隠れている間だけ、パッドの位置に下部バー `footer.bottombar.pad-dock` を出す（高さ56＋`inset-bottom`）。中身は副ボタン［▴ 技を入力］を左寄せに1つ（`aria-controls="pad"`、`aria-expanded="false"`）。押すとパッドを戻し、`section.pad`（`tabindex="-1"`）にフォーカスを移す。コマンド列の領域のタップでも戻る（v1のまま）。テキスト欄へのフォーカスでパッドが隠れたときも同じバーを出す。浮動ボタンは採らない。
- Enter相当: タイトル欄とダメージ欄でEnter（`!e.isComposing`）を押したら `blur()` してキーボードを閉じる。
- システム行のキー: `::before` で、左右8・下4・高さ3・角丸1.5の帯を描く（キーの幅は変えないので、のぞき幅の確認はそのまま通る）。CDR・生ラッシュは `--dr`、DIは `--di`、DP・Dリバは `--dp-line`、SA1〜3は `--fg`。CH・PCには帯を付けない。キーの文字は `--fg` のまま。
- ODのキー: 文字と●を `--od`（橙）にする。発光はさせない。その他（塗り・枠・押下・選択枠・ペンディング・カーソル）はv1のまま（値だけv2のトークンになる）。

## 5. 画面

### 5.1 キャラクター選択 `#/`

- `.grid`: `grid-template-columns: repeat(3,1fr)`、`gap: 3px`、`padding: 3px 0`、`overflow-x: clip`（斜めの板が左右へはみ出すため必須）。
- `.cell`: 高さ54px、`position:relative; isolation:isolate; display:flex; flex-direction:column; justify-content:flex-end; padding: 6px 12px 6px 14px`。板は `::before`（`inset:0; z-index:-1; transform: skewX(var(--skew)); background: var(--surface)`）。隣の板との平行な3pxの隙間が「路地」に見える。360×740で11段が収まり（上部バー48＋グリッド630＋下部バー48＝726）、32件を一覧できる。
- 中身: 1行目 `.cell-en`（英字、`--sign-l`、`aria-hidden="true"`、`white-space:nowrap; overflow:hidden`）。2行目は横並びで、`.cell-name`（カナ、12px／400、muted）と `.cell-n`（「3件」、12px／700、右寄せ、`--lit`。0件なら出さない）。360pxで英字がはみ出す名前には `.long`（16px）を付ける（KIMBERLYが候補。実測で決める）。リンクの読み上げ名は「リュウ 3件」。
- 状態: 消灯（0件）は板 `--surface`、英字 `--fg-muted`。点灯（1件以上、`.lit`）は板 `--key`、英字 `--lit`＋`--tx-lit`。押下（`:active`）は板 `--line`、英字 `--lit`＋`--tx-lit`（即時、トランジションなし）。フォーカスはv1の2pxのリング（`outline-offset:-3px`）。
- 最近使ったキャラ（下部バー）: 3枠とも斜めの板（高さ44、`::before` は `--key`）で、英字は `--sign-s`、`--lit`＋`--tx-lit`。`aria-label` はカナ名。初回はv1と同じ文言。上部バーと書き出しの案内はv1のまま。

### 5.2 記録の一覧 `#/c/:id`

- 上部バーのh1: `<span class="wm" aria-hidden="true">RYU</span> リュウ`。ワードマークは `--sign-m`・`--lit`＋`--tx-lit`、カナは13px・muted。h1の読み上げ名は「リュウ」。
- セクションの帯: 番号「01」を `--sign-s`・mutedにする。その他はv1のまま。
- 記録の行: `.item-meta` を `display:flex; gap:8px` にし、左の `.meta-t`（v1の文字列、省略表示）と、右の `.dmg`（`flex:none`。「ダメージ」12px・mutedと、数字（`Intl.NumberFormat('ja-JP')`、13px／700、fg、tabular））に分ける。ダメージが未入力なら `.dmg` を出さない。押下は `--key`。プレビュー（S）には発光を付けない。空・並べ替え・削除はv1のまま。

### 5.3 詳細 `#/c/:id/r/:rid`

上から、メタ（13px・muted）、タイトル（17px／700）、`.d-stat`（余白8。「ダメージ」12px・mutedと、数字20px／700・fg・tabular。間隔6、ベースライン揃え。未入力なら行ごと出さない）、余白24、コマンド列（L。DRとODは発光）、余白24、メモ。ポップオーバーと下部バーはv1のまま。

### 5.4 編集 `#/c/:id/r/:rid/edit`、`#/c/:id/new`

- 入力欄の並び: セクション、タイトル、位置、ダメージ、タグ、メモ。
- ダメージ欄: ラベルは「ダメージ（任意）」。`<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" enterkeyhint="done" autocomplete="off" id="f-dmg">`、幅120px、右に「0〜99999」（12px・muted）。`type="number"` は使わない（指数表記や小数のキーが出るため）。入力のたびに、全角数字を半角に変え、数字以外を除き、先頭から5桁に切る。フォーカスが外れたら先頭の0を除く（「0050」は「50」）。空は未入力（キーを持たせない）。`type="text"` なのでv1のフォーカス処理でパッドが隠れ、格納バーが出る。
- ［完了］と格納バーは4章のとおり。
- 既知の不具合: タグの［追加］ボタンが360pxで「追／加」と縦に折れる。`.tag-add .btn { flex:none; white-space:nowrap; }` で直す。

### 5.5 設定・凡例・トースト・シート・エラー

- 設定とデータはv1 6.5のまま。バージョン行の下に書体の表記を1行足す（2.4）。
- 凡例シートのシステム技・SAのグループを、種別ごとの行に分ける。形の列は実際のrenderRowのL寸法を使う。CDR・生ラッシュ＝緑の枠と»、DI＝角を切った銀の板、DP・Dリバ＝紺の二重枠、SA1〜3＝白い枠。ODの意味に「橙の●2つ（重ねて表示）」、注記の意味に「斜めの小さな板」を明記する。
- トースト・ボトムシート・エラーはv1のまま（トークンだけv2）。シートには上端に1pxの `--line-strong` を足す。エラーに色相を使わない（赤は「強」の意味を持つため）。

## 6. 動き

| 対象 | 動き | 時間とイージング | 条件 |
| --- | --- | --- | --- |
| 起動時の点灯（追加） | 点灯タイルの `.cell-en` のopacityを 0→1(20%)→.3(30%)→1(45%)→.6(55%)→1(70〜100%) | 480ms、linear。DOM順に60msずつずらす | アプリ起動後の最初のキャラ選択の描画で1回だけ（モジュール変数で管理）。先頭6件まで動かし、7件目以降は即時に表示。タップを妨げない |
| タイルの押下（追加） | 板の色と英字の点灯を即時に切り替える | 0ms。離したときもトランジションなし | なし |
| 画面遷移・チップの追加・キー・シート・トースト | v1のまま | v1のまま | なし |
| パッドの開閉・格納バー | 動かさない（即時） | なし | なし |

性能の予算: アニメーションさせてよいのは `transform` と `opacity` だけ（例外はv1のキーのbackground 80ms）。同時に動くアニメーションは、起動時の点灯で6個まで、それ以外は2個まで。無限ループ、スクロールに連動する動き、JSのrAFによる演出は使わない。発光（影）は動かさない。`will-change` を常時付けない。`prefers-reduced-motion` はv1の全体ルールのまま（起動時の点灯は最終状態で表示される）。パッドと編集中に追加する演出はない。

## 7. アプリアイコン

「↓から右へ曲がる矢印が●に届く」図案を、ネオン管で描く。512の正方形を `#0E0F11` で全面塗りする。矢印は管として、stroke `#FFF4DE`、幅40、`linecap/linejoin: round`。軸は `M128 120V236Q128 300 192 300H276`、矢じり（開いた線）は `M232 256L276 300L232 344`。●は中心(356,300)・半径58・塗り `#F0D870`、中のPはv1のパスを `translate(298,242) scale(3.222)` で置き、`stroke:#0E0F11`、`stroke-width:4`（スケール前）。にじみは、PNGに1回書き出すだけなのでSVGのfilterを使ってよい例外とする。矢印の複製（stroke `#FFB870`、不透明度.55、`feGaussianBlur stdDeviation=10`）と、●の複製（r62、不透明度.45、stdDeviation=14）を下に敷く。全体を `translate(-5,27)` で中央に寄せ、maskableの安全円（半径205）に本体を収める。出力は `icon.svg`、`icon-192.png`、`icon-512.png`。48dpに縮小しても矢印と●が判別できることを確認する。

## 8. 実装メモ

- CSSの構成: `:root` のトークンを、地 → 文字 → 信号色（強度・システム）→ 発光 → 書体 → 余白・角丸・形 → 時間の順に並べる。時間のトークン `--dur-key: 80ms`、`--dur-chip: 120ms`、`--dur-screen: 160ms`、`--dur-sheet: 200ms`、`--ease-out: cubic-bezier(.2,.8,.2,1)` を追加する。`@font-face` はstyles.cssの先頭に置く。CLAUDE.mdの「デザイントークン」節をv2の値で更新する。
- renderRow: DOMの構造はそのまま使える。変更は2点。(1) system・saのチップのclassに種別を足す（`chip sys sys-dr|sys-di|sys-dp|sys-sa`。対応は `{CDR:'dr', RAW_DR:'dr', DI:'di', PARRY:'dp', REVERSAL:'dp'}`、SAは `'sa'`）。(2) DRのときだけ、先頭に `icon('i-rush','rush')` を入れる。aria-label、`data-i`、buttonとspanの分岐は変えない。
- その他のDOM: homeScreenの `.cell` は英字（aria-hidden）＋カナ（`.cell-name`）＋件数（`.cell-n`）にして `.lit` を付ける。recordRowの `.item-meta` は `.meta-t` と `.dmg` に分ける。detailScreenに `.d-stat` を追加する。buildPadのR1を包む要素と［完了］キーを追加する。editScreenにダメージ欄と格納バーを追加する。
- データ: コンボに任意の `damage`（0〜99999の整数）を足す。未入力のときはキーを持たせない（既存の書き出しと取り込みがそのまま有効）。`COMBO_KEYS`、`validateDoc`、`sanitizeDraft`、下書きの書き込み、`duplicateCombo`（値を複製する）に加える。`schemaVersion` は上げない（D-012）。
- e2eとcheck.html: 変更が要らないのは、パッドの高さ368・上端y≥372、キーが44以上、システム行ののぞき、`.item-meta` の既存の期待値、`.cell` の32件、`.d-cmd .row` のouterHTMLの再現、check.htmlのneutralOk。追加するのは、check.htmlへの「システム技とODと注記の比較（L・S）」の列（CDR、生ラッシュ、DI、DP、Dリバ、SA1、OD236P、CH＋技）と、構造の判定（`.sys-dr` に `.rush` がある、`.sys-di::before` のclip-pathがnoneでない、`.tag::before` のtransformがnoneでない、`.row.S` の中のcomputed `box-shadow` と `text-shadow` がnone）。キャラ選択の横スクロール確認を360・390・430pxで行う。

## 9. 受け入れの観点

1. 幅360・390・430pxの全画面で横スクロールがない。キャラ選択で、英字の名前がタイル内に収まる（`.cell-en` のscrollWidthがclientWidth以下）。
2. 360×740で、キャラ選択の32件が下部バーの上に収まる。
3. グレースケール（`?gray=1`、またはAchromatopsiaのエミュレーション）で、●、矢印、▶、SA、DR、DP、DI、OD、CH・PCを形で区別できる。Protanopia・Deuteranopiaでも、ODと強の●を区別できる（スクリーンショットを証拠に残す）。
4. 2.2のコントラスト比をツールで再計算し、文字は4.5以上、図形は3以上。
5. 発光が付くのは、L寸法のDR・OD、点灯した名前、ワードマークだけ。S寸法・パッド・UIには付いていない（computed styleで確認）。`filter` と `backdrop-filter` を使っていない。
6. パッドの高さは368のまま。［完了］が44×64以上で、押すとパッドが隠れて格納バーと `#f-sec` へのフォーカスが出る。格納バーとコマンド列のタップでパッドが戻る。Enterでblurする。
7. ダメージ: 「３,２４０」を入力すると3240として保存され、一覧に「ダメージ 3,240」、詳細に20pxで出る。空なら両方とも非表示。保存→再読み込み、書き出し→取り込みで値が一致する。
8. 起動時の点灯は1回だけで、画面に戻っても再生しない。reduced-motionでは動かない。アニメーション中もタイルをタップできる。
9. 性能: DevToolsでCPUを4倍に落とし、記録30件の一覧とキャラ選択をスクロールしたとき、おおむね55fps以上。チップ追加の遅延は100ms以内。
10. 書体: data URIのwoff2が12KB以下。`document.fonts.check('20px "Tilt Neon"')` がtrue。OFLの同梱ファイルと設定画面の表記がある。機内モードでも英字がTilt Neonで表示される。
11. デザイン品質: docs/design-workflow.mdの「Reviewerが確認するデザイン品質基準」を満たす。紫や青紫のグラデーション、常時の明滅、装飾だけの背景がない。

## 10. 確認していないこと

Tilt Neonの実際の字幅とサブセット後の容量（推定）、コントラスト比とLab値（手計算）、実機での発光の描画コスト、アイコン座標の見た目。ODと強の●は明度の差が小さく、色覚の型によっては形の手がかりに頼ることになる。
