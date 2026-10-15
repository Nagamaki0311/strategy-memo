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

## 2026-10-15 T-003: 環境確認と土台

### 実施内容
- node v22.22.0、python3 3.13.16、ヘッドレスChromium（`/opt/pw-browsers/chromium`、v1194）の起動を確認した。
- package.json（依存なし、`node --test`）、app/（index.html、app.js、core.js、styles.css）、tests/core.test.jsを作成した。core.jsにはD-010のキャラクターマスタ32件、styles.cssにはdocs/design-spec.md 2章の色トークンのみを置いた。

### 結果
- `npm test` は4テスト pass、fail 0、終了コード0（Managerが再実行して確認）。
- `python3 -m http.server 8000` を起動して `curl -sf http://localhost:8000/app/` が200。ヘッドレスChromiumで `<span id="count">32</span>` の描画と、360×740のスクリーンショットでの表示を確認した。
- ブラウザでの確認手順（`app/` を配信中に実行。stderrのdbus・socketエラーは無害なので `2>/dev/null` で除外する）:
  - DOM取得: `/opt/pw-browsers/chromium/chrome-linux/chrome --headless --no-sandbox --disable-gpu --virtual-time-budget=3000 --dump-dom http://localhost:8000/app/`
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
