# 作業履歴

作業内容、実施結果、次回開始位置を記録する。新しいエントリは先頭に追加する（新しい順）。

## 記録フォーマット

```
## YYYY-MM-DD タスクID/概要

### 実施内容
- 何を行ったか

### 結果
- 動作確認結果、テスト結果など

### 次回開始位置
- 次に着手すべき場所（ファイル/関数/タスクID）
```

---

## 2026-10-15 T-016（続き）: APKのアイコンとバー色をv2に更新

### 実施内容
- apk/ の地色を `#0E0F11` に更新し（capacitor.config.json、styles.xml、ic_launcher_background.xml）、アダプティブアイコンの前景（VectorDrawable。矢印と●、にじみなし）と旧端末用の各密度PNG（`app/icon-512.png` の縮小）をネオン版に差し替えた。apk/README.md の「暫定」注記を現行の構成の説明に置き換えた。

### 結果
- `cd apk && npm ci && npx cap sync android && cd android && ./gradlew assembleDebug` が成功し、`aapt` でアダプティブアイコンのリソース、背景 `#ff0e0f11`、スプラッシュ背景を確認した。デバッグAPK（約4.2MB、デバッグ署名）をユーザーに送付した。アイコンの見た目はSVGでの代用確認（安全円に収まる）。
- 未確認: 実機・エミュレータでのランチャー表示とAndroid 12以降のスプラッシュ。Android 13以降の単色アイコン（monochrome）は未対応。

### 次回開始位置
- T-014（実機での受け入れ）。敵対的レビュー（T-015）はユーザー指示待ち。

---

## 2026-10-15 T-013: PWAと配信

### 実施内容
- `app/manifest.webmanifest`、`app/sw.js`（App Shellのプリキャッシュ、cache-first、`skipWaiting` なし）、ネオン版アイコン（`app/icon.svg`、`icon-192.png`、`icon-512.png`。maskable対応）、`.github/workflows/pages.yml`（`app/` をGitHub Pagesに配信。公式アクションをコミットSHAで固定）を追加した。SWは `https:` または `localhost` で、Capacitorのネイティブ環境以外のときだけ登録する。
- index.htmlに `<link rel="manifest">` と `<link rel="icon">` を追加した（manifestのlinkがないとChromeがmanifestを読まないため、指示より増やした）。
- アイコンの書き出し手順: `app/icon.svg` を作り、Playwrightのchromiumで `deviceScaleFactor: size/512` として描画して192と512のPNGを撮る（スクリプトは scratchpad/export-icons.mjs。リポジトリには入れていない）。

### 結果
- `npm test` は58テスト pass、fail 0、終了コード0（Managerが再実行）。e2e（`FAST=1`）は570件すべて合格（19章がPWAの42件）。受け入れ基準7.3-5（オフライン起動）を、ルート配信とサブパス `/strategy-memo/` 配信の両方で、接続を切った状態の再読み込み・記録の作成・保存・閲覧まで確認した。CDPの `Page.getAppManifest` はエラー・警告なし、`Page.getInstallabilityErrors` は空。actionlint は `pages.yml` と `apk.yml` で終了コード0。変異テスト6種が失敗側に動いた。
- ブラウザでの注意: `context.setOffline(true)` はService Worker自身のfetchを止めないため、機内モードの検証は、テスト用サーバーの接続切断と併用している。
- 手動の版数管理（`ponytail:` コメント済み）: `app/` を変えてデプロイするたびに `sw.js` の `CACHE` の版数を上げ、`app/` にファイルを足したら `FILES` にも足す（足し忘れはe2e 19bが検出）。新版は全タブを閉じた次回起動で切り替わる。
- 未確認: Pages本番のデプロイ、実機（Android Chrome）でのインストールとオフライン起動、アイコンの実機での見え方。ホーム画面のアプリとChromeのタブで保存データが別領域になるかどうかは実機で確認する。

### 次回開始位置
- T-014（実機での受け入れ。ユーザーが行う: リポジトリを公開、Settings→Pagesの SourceをGitHub Actionsにする、`pages` ワークフローの実行、`https://nagamaki0311.github.io/strategy-memo/` をAndroid Chromeで開いて確認）。APKのアイコンとバー色の更新（apk/）、敵対的レビュー（T-015。ユーザーが後追いで指示）。

---

## 2026-10-15 T-012: 設定とデータ（書き出し・取り込み・表示設定・書き出しの案内）

### 実施内容
- 設定画面を実装した。最後の書き出し日、JSONの書き出し（Webは Blob + `<a download>`、APK内は Filesystem + Share）、取り込み（5MB上限、`parseDocText` → `mergeImport` → 確認シート「追加N・更新M・変更なしK」→ `commit`）、方向の表記（矢印・数字）と補助文字の切り替え（実チップでの例示）、凡例、非公式表記・バージョン・書体の表記。破壊的な操作は置いていない。
- 保存データが読み込みエラー（読み取り専用）のときの救済として、［保存データをそのまま書き出す］と、取り込みによる置き換え（成功すると読み取り専用を解除）を実装した。
- キャラ選択に書き出しの案内の帯を実装した（最終書き出しから14日以上かつその後に変更あり、［あとで］で7日間非表示）。settings に `firstChangeAt` と `remindSnoozeUntil` を追加した。D-006の「toast」を「帯」に直した。
- core.jsに `exportFilename`、`dateText`、`daysSince`、`snoozeUntil`、`shouldRemindExport` を追加した。

### 結果
- `npm test` は58テスト pass、fail 0、終了コード0（Managerが再実行）。e2e（`FAST=1`）は360幅・430幅で528件すべて合格。受け入れ基準7.3-3（書き出し→全削除→取り込みで復元）と7.3-4（不正JSON5種でデータ不変、理由を表示）を含む。check.html は360・390・430でCHECK-PASS。
- 判断: APK内の共有シートを閉じた（`Share canceled`）ときは、失敗にせず `lastExportAt` も更新しない（書き出し先にファイルが渡っていないため）。0件の取り込みは確認シートを出して書き込まない。
- 並列でe2eを5本走らせたとき「17b ［完了］キー」が1回だけ落ちたが、単独実行では合格した（CPU競合とみている）。
- 実機のAPK（Capacitor）での書き出しとファイル選択の取り込みは未確認（e2eは `window.Capacitor` のスタブで検証）。

### 次回開始位置
- T-013（PWAと配信: manifest.webmanifest、sw.js、アイコン（design-spec-v2 7章）、オフライン起動）。

---

## 2026-10-15 T-016・T-017: APK配布の準備、デザイン刷新v2、合計ダメージ、入力完了キー

### 実施内容
- T-016: Capacitor（Android）で `app/` を包むビルド構成（`apk/`）と、タグ `v*` のpushと手動実行で起動するGitHub Actions（`.github/workflows/apk.yml`）を作った（D-011）。ローカルでデバッグAPK（約4.1MB）と使い捨て鍵のリリースAPKをビルドし、`aapt` で package・label・sdkVersion、`assets/public` が `app/` と一致することを確認した。ワークフローは actionlint と shellcheck を通過した。
- T-017: ユーザー指示（SF6公式コマンドリストを参考にしたブラッシュアップ、ネオン街モチーフ、システム技の色分け、キャラ選択の表記の作り変え、合計ダメージ欄、入力完了の導線）に基づき、docs/design-spec-v2.md（D-012）を実装した。v2トークン、Tilt Neonのサブセット（woff2 6KB、data URI）、システム技のチップ（DR＝緑の枠と»、DI＝銀の板、DP・Dリバ＝紺の二重枠、SA＝白い枠、OD＝橙、CH・PC＝斜めの板）、キャラ選択の斜めのタイルと点灯、一覧と詳細のダメージ表示、編集画面のダメージ入力欄、パッドの［完了］キーと格納バー、Enterでblurを実装した。コンボの任意の `damage` を追加した（schemaVersionは据え置き）。
- フォントの生成コマンド: `fonttools varLib.instancer 'TiltNeon[XROT,YROT].ttf' XROT=0 YROT=0 -o tn-static.ttf` → `pyftsubset tn-static.ttf --unicodes='U+0020,U+002D,U+002E,U+0030-0039,U+0041-005A' --flavor=woff2 --layout-features=kern --output-file=tn-sub.woff2` → `base64 -w0`。入手元は raw.githubusercontent.com/google/fonts/main/ofl/tiltneon/（ディレクトリURLは404、ファイル名指定で取得できる）。

### 結果
- `npm test` は53テスト pass、fail 0、終了コード0（Managerが再実行）。e2e（`FAST=1`）は360幅・430幅で432件すべて合格。check.html は360・390・430でCHECK-PASS。
- コントラスト比39ペアを再計算し、すべて基準以上（文字4.5:1、図形3:1）。グレースケール・Protanopia・Deuteranopiaのスクリーンショットで、DR・DI・DP・SA・OD・CH/PCを形で区別できることを目視した。
- CPU 4倍スロットルのスクロールで約57〜60fps（ヘッドレス、ソフトウェア描画。実機の低〜中スペックAndroidでの確認は未実施）。
- 敵対的レビューはユーザー指示により完成後に後追いで実行する（未実施）。実機でのAPKの起動、GitHub Actionsの初回実行、機内モードでの英字表示は未確認。
- 注意: ダメージ欄の `maxlength="5"` は整形より先に効くため、「3,2400」のように区切りを含めて貼ると先頭5文字（3,240）に切られる。問題が出たら maxlength を外して整形側だけで5桁に切る。apk/ 配下に旧地色 `#16140F` が残っている（アイコンの差し替え時に更新する）。

### 次回開始位置
- T-012（設定とデータ: 書き出し・取り込み・設定。APK内の書き出しは apk/README.md のネイティブAPIを使う）とT-013（PWAと配信: manifest・sw・アイコン）。設定画面にバージョン行を作り、その下に書体の表記（プレースホルダー内の1行を移す）を置く。

---

## 2026-10-15 T-010・T-011: 編集画面（タップパッド）・詳細画面

### 実施内容
- 編集画面（コマンド列、セクション・タイトル・位置・タグ・メモ、挿入カーソル、仮チップ、チップのポップオーバー（強度変更・前に挿入・削除）、下書き、保存失敗の表示）、パッド（直近8件、プリセット8個、システム行、方向3×3、姿勢、ボタン、OD-P/OD-K、消す）、詳細画面（閲覧専用、複製、削除と取り消し、モーションの対応表示）、凡例のシートを実装した。
- core.jsに `strengthChoices`、`changeStrength`、`recentTokens`、`tagCandidates`、`duplicateCombo`、`sanitizeDraft` ほかの純粋関数を追加した。
- ユーザー確認: ODキーの●2つの重なりは現状のままでよい。

### 結果
- `npm test` は49テスト pass、fail 0、終了コード0（Managerが再実行）。
- `tests/e2e.mjs`（`FAST=1`）は360幅・430幅で350件すべて合格（Managerが再実行）。検算用の9タップのクリック、保存→再読み込みでのDOM一致（受け入れ基準7.3-1・7.3-2）、パッド上端 y=372・全キー44px以上、チップ追加の遅延3〜14ms（headlessの目安）を含む。
- Reviewerのレビューはユーザーの指示（コストが大きいため完成後に後追いで実行指示する）により未実施。Developerの変異テストは通っている。

### 次回開始位置
- ユーザー指示のデザイン刷新（ネオン街モチーフ、システム技の色分け、合計ダメージ欄、入力完了ボタン）、T-012（設定とデータ）、T-013（PWAと配信）、APK配布の準備。敵対的レビューは完成後にユーザーが指示する。

---

## 2026-10-15 T-008・T-009: 画面・保存・セクション管理

### 実施内容
- app/app.jsに、hashルーティング、保存層（localStorage 3キー、読み込み時の検証、保存失敗の表示）、共通部品（上部バー・下部バー・トースト・ボトムシート・エラー表示）、キャラクター選択画面、記録の一覧（セクション見出し、Sプレビュー、折りたたみ、並べ替え、削除と取り消し）を実装した。詳細・編集・設定の各画面はプレースホルダーで、T-010・T-011・T-012で置き換える。
- app/core.jsにセクション操作（`addSection`、`renameSection`、`moveSection`、`deleteSection`、`newId` ほか）を追加した。
- 方向5（ニュートラル）の矢印表記を、ユーザーの指示で「N」の文字に変更した（aria-labelは「ニュートラル」、数字表記は「5」）。design-spec 3章に反映した。
- Reviewerのレビュー（Critical/Highなし、Medium2件、Low7件）を受けて修正した。他タブの変更の検知と、書き込み前の最新確認（M1）。保存失敗のエラー帯を上部バーの下に固定（M2）。シートの履歴の残りの除去（L1）。`newId` を `crypto.getRandomValues` ベースにした（L2。httpの実機でも動く）。保存前に`validateDoc`を通す（L4）。フォーカスの戻し先とTab閉じ込め（L5）ほか。

### 結果
- `npm test` は41テスト pass、fail 0、終了コード0（Managerが再実行）。
- `tests/e2e.mjs` は360幅・430幅で172件すべて合格（Managerが再実行）。変異テスト18種がすべて検出された。
- e2eの実行手順（`npm test` には含まれない）: リポジトリルートで `python3 -m http.server 8000` を起動し、`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers SHOTS=<保存先ディレクトリ> node tests/e2e.mjs`。グローバルのPlaywright（/opt/node-tools/node_modules/playwright）に依存する。終了後にサーバーを止める。
- 修正後の再レビューは行っていない。

### 次回開始位置
- T-010（編集画面・タップパッド）とT-011（詳細画面・複製・削除と取り消し）。docs/design-spec.mdの4章・6.3・6.4、D-005、core.jsの `applyPadInput`・`describeRow` を先に読む。申し送り: 保存失敗のエラー表示を編集画面にも付ける。下書き（`sf6memo.drafts`、キー定数は定義済み）を実装する。↓キーの選択表示はモーション選択後も残る（確定するトークンには入らない）。他タブのstorageイベントでは設定（最近使ったキャラ・折りたたみ）を読み直していない。トーストのキーボードフォーカス中の一時停止は `:focus-visible` のときだけ。

---

## 2026-10-15 T-007: デザイントークンの記録とコマンド列の描画

### 実施内容
- CLAUDE.mdに「デザイントークン」の節（値のみ、正本はdocs/design-spec.md 2章）を追加した。
- app/styles.cssに全トークンとチップのスタイル（L・S、折り返し、補助文字、数字表記、reduced-motion）、app/index.htmlにSVGスプライト、app/app.jsに `renderRow(tokens, {size, notation, strengthLabels})` を実装した。tests/check.htmlは全種類のチップを並べる検証用ハーネスで、`?gray=1` でグレースケールになる。
- 未認識トークンの描画は未実装（core.jsが未知のtypeでthrowするため。CSSと静的サンプルのみ）。待ち・移動チップはPhase 2。

### 結果
- `npm test` は31テスト pass、fail 0、終了コード0。
- ヘッドレスで幅360・390・430（高さ740）の `CHECK-PASS`（横スクロールなし、scrollWidthは各幅-15で、縦スクロールバー分）。幅120では `CHECK-FAIL` になり、判定が失敗側にも動くことを確認した。
- Managerがスクリーンショット（`?gray=1` を含む）を目視した。グレースケールでも●（塗りのある円）、矢印（軸のある線）、▶（軸のない小さな三角）、システム技（実線枠）、注記タグ（枠なしの灰色）、360（塗りのない円弧）を形で区別できる。
- ブラウザでの確認手順の訂正: フル版chromeは `--window-size` が500未満にならないため、幅の確認には `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`（同じオプション）を使う。T-003の記載も訂正した。
- 実機（Android Chrome）でのフォント・アウトラインの描画は未確認（T-014）。
- Reviewerのレビュー（Critical/Highなし、Medium2件、Low6件）を受けて修正した。方向5（ニュートラル）には小さな中点を描く（M1。design-spec 3章に5の描画規則がなかったため、Managerが決めた）。tests/check.htmlの判定を強化し（`clientWidth`との比較、`<use>`の参照解決、矢印の回転、role・aria-labelの検証）、変異テスト（350px要素の追加、symbol idの破壊、回転の書き換え、aria-labelの除去）で失敗側に動くことを確認した（M2）。溜め括弧の線幅（S）、▶の左右対称、未使用の`.unk`の削除、トークンの使用も修正した。修正後の再レビューは行っていない。

### 次回開始位置
- T-008（キャラ選択・ルーティング・保存）。docs/design-spec.mdの6.1・6.6、D-003・D-006、core.jsの `validateDoc`・`exportDoc` を先に読む。申し送り: `renderRow` は不正なトークンで行全体が落ちるため、保存データの読み込み境界で `validateDoc`（内部で各トークンを検証）を必ず通す。未認識トークンの描画はPhase 2のトークン拡張時に足す。一覧のSプレビュー（`height:28px; overflow:hidden`）とLのタップ領域44pxはT-009・T-010で実装する。

---

## 2026-10-15 T-005・T-006: コアロジック（パッド入力・表示・検証・マージ）

### 実施内容
- app/core.jsに、パッド入力の状態遷移（`applyPadInput`）、トークン表示（`tokenLabel`、`describeRow`、`motionToArrows`）、文書の検証（`validateDoc`、`parseDocText`）、書き出しと取り込み（`exportDoc`、`mergeImport`）を実装した。区画ごとに `// ===== SECTION: 名称 =====` を置いた。
- Reviewerの敵対的レビュー（Critical/Highなし、Medium5件、Low6件）を受けて修正した。取り消しが1つ前の状態へ戻る（M1）、マージ結果の検証（M3）、未知キーの拒否（M4）、idの文字種制限と理由への入力値埋め込み禁止（M5）、motion長・cursor・actionの検証（L1・L2・L4）。注記の向きは「直後」に統一した（M2、D-005）。

### 結果
- `npm test` は31テスト pass、fail 0、終了コード0（Managerが再実行）。検算用の9タップが「屈中K▶236強P▶CDR▶屈中K▶236強P」になることをテストで固定した（受け入れ基準7.3-1のロジック層）。
- Managerが修正を再現スクリプトで確認した（M1の取り消し、M4の未知キー拒否、M5のid不正とreasonへの非埋め込み）。修正後の再レビューは行っていない。
- 残る注意: ↓キーの選択表示はモーション選択後も残る（確定するトークンには入らない）。D-005の「↓の後にモーションを押すと↓は破棄」の見た目はT-010で決める。mergeImportは `{ok, doc, added, updated, unchanged}` または `{ok:false, reason}` を返す。T-012は結果の `ok` を確認する。画面にreasonを表示するときは `textContent` を使う。

### 次回開始位置
- T-007（デザイントークンの記録とコマンド列の描画。docs/design-spec.mdの2〜3章、CLAUDE.mdへのトークン節）。

---

## 2026-10-15 T-003: 環境確認と土台

### 実施内容
- node v22.22.0、python3 3.13.16、ヘッドレスChromium（`/opt/pw-browsers/chromium`、v1194）の起動を確認した。
- package.json（依存なし、`node --test`）、app/（index.html、app.js、core.js、styles.css）、tests/core.test.jsを作成した。core.jsにはD-010のキャラクターマスタ32件、styles.cssにはdocs/design-spec.md 2章の色トークンのみを置いた。

### 結果
- `npm test` は4テスト pass、fail 0、終了コード0（Managerが再実行して確認）。
- `python3 -m http.server 8000` を起動して `curl -sf http://localhost:8000/app/` が200。ヘッドレスChromiumで `<span id="count">32</span>` の描画と、360×740のスクリーンショットでの表示を確認した。
- ブラウザでの確認手順（`app/` を配信中に実行。stderrのdbus・socketエラーは無害なので `2>/dev/null` で除外する）:
  - DOM取得: `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell --no-sandbox --disable-gpu --virtual-time-budget=3000 --dump-dom http://localhost:8000/app/`
  - スクリーンショット: 上記に `--window-size=360,740 --screenshot=<path>` を付ける。
- 別途Reviewerは通していない（マスタとスケルトンのみ。Managerがマスタの内容をD-010と照合）。

### 次回開始位置
- T-005（文書の検証と取り込みのマージ、app/core.js）とT-006（パッド入力の状態遷移とトークン表示、app/core.js）。D-004・D-005・D-006を先に読む。

---

## 2026-10-15 Phase 0（T-001〜T-004）: 要件の洗い出し・調査・デザイン仕様

### 実施内容
- テンプレートを初期化し、指示書をdocs/requirements.mdとして保存した（PR #1）。
- Plannerが要件の矛盾・不足を洗い出し、タスクをT-001〜T-015に分解した。決定をD-001〜D-009に記録した。
- 公式コマンドリスト32ページを集計し、プリセット8個とキャラクターマスタ32件を確定した（D-010）。最初のResearcherは公式ページが403で取得できず、別のAgentがブラウザ相当のUser-Agent付きcurlで取得した。
- Designerのデザイン仕様をdocs/design-spec.mdに保存した。調査前に作られたため、プリセット（9個→8個）とパリィの略称（DP）、位置フィールドの表示名をManagerが修正した。
- ユーザー回答: 配信は完成までGitHub Pages（公開リポジトリ）、画面端の一本化、DPの略称維持、ダーク固定、システム行は横スクロール1段、保存ボタンは上部バー右。

### 結果
- `grep -c "^## D-0" docs/decisions.md` で10件を確認した。ヘッドレスChromiumの有無などの環境確認はT-003で行う。
- モデルとeffortはテンプレートの既定のまま。`CLAUDE_CODE_SUBAGENT_MODEL`は未設定を確認した。Researcherの再調査には全ツールを使えるgeneral-purpose Agentを使った（1回限りの切り替え）。

### 次回開始位置
- T-003（環境確認と土台）。docs/design-spec.mdとD-002・D-004・D-010を読んでから着手する。

---
