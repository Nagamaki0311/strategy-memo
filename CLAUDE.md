@AGENTS.md

# Claude Code設定

このファイルはClaude Code固有の設定・運用ルールのみを扱う。開発方針・設計原則・ワークフローは AGENTS.md（上記import）、レビュー方針は REVIEW.md を参照する。すべてのAIエージェント共通のルールをCLAUDE.mdへ書き足さない。

## セッション運用

- セッション開始時: SessionStart Hookで docs/tasks.md・docs/progress.md の要約が自動表示される（環境によっては発火しない場合がある。詳細・確認方法はdocs/agents.md参照）。
- 長時間セッション: 同じタスクを続ける場合に限り `/compact <残したい観点>` の形で使い、PreCompact Hookの案内に従って圧縮前にdocsへ記録する。`/compact`自体が会話全体を読む大きなリクエストのため、継続性が不要なら`/clear`（コストなし）を選ぶ。
- タスク完了後: 次のタスクに移る前にコンテキストをリセットする（`/clear` 等）。
- 修正が2回失敗したら: コンテキストをリセットして状況を整理してから再着手する。

## トークン効率化

- 不要なAgentは起動しない。巨大ファイルは全文を読まず、検索（Grep/Glob）で対象を絞る。
- `.claude/settings.json`の`outputStyle: Concise`（2026年8月公式追加）により、Managerの応答は前置き・振り返りを省き結果から述べる。詳細説明の質は落とさない。
- 調査・実装・レビューは各Agentに委任し、メインセッションには要約のみ持ち込む。同じ情報を複数箇所に保存しない。
- CLAUDE.md/AGENTS.mdは`@AGENTS.md`importにより毎セッション読み込まれるため、各行を「消すとAIが判断を誤るか」で判定し、否なら削除する（この削除テストの対象はCLAUDE.md/AGENTS.mdのみで、オンデマンドロードのREVIEW.md/docs/は対象外）。特定タスクでのみ必要な知識はdocs/へ置き参照のみ残す。README.mdも簡潔に保つが、常時ロードされないため削除テストの対象外とする。

## Skills / Capability Layer

project001は、利用可能な外部ツールを自動検出し、あれば優先利用・なければ既存フローへフォールバックする共通規約（Capability Layer）を持つ。project001自体はいずれのツールにも依存しない（本リポジトリに依存の追記はしない）。

- 現在Tier1（Agentの振る舞いに統合済み）のCapabilityはない。[Agent-Reach](https://github.com/Panniantong/Agent-Reach)、Code Review Graph、[Context7](https://github.com/upstash/context7)、GitHub CLI `gh`の4つは動作未検証のままTier2（検出のみ）に格下げしている（D-021参照）
- 検出は`.claude/bootstrap.sh`（案内のみ、インストールは行わない）に集約し、SessionStart Hook経由でManagerへ結果を共有する
- 検出規約はdocs/capability-layer.mdに、ツール固有の詳細はdocs/agent-reach.md・docs/code-review-graph.md・docs/context7.mdにそれぞれ記載し、他へ複製しない
- Claude Codeプラグインはproject scopeで既定有効化しない。例外としてFrontend Design（`frontend-design@claude-plugins-official`）はD-025によりproject scopeで有効化済み（詳細はdocs/capability-layer.md・docs/design-workflow.md参照）

Skills（`.claude/skills/`配下のSKILL.md）は、再利用可能な具体的ワークフローが確認された時点で追加する。SKILL.md本文はSkillツール呼び出し時のみ読み込まれるが、1行説明は`.claude/skills/`配下の全Skillぶん毎セッション常時ロードされるため、確認を経ず追加したSkillは関連タスクでの起動実績（`/usage`のSkill・subagent・plugin・MCP別内訳で確認できる）を見て刈り込む。現在導入しているのは`design-principles`（UI/UXデザイン品質判断基準。designer/developer/reviewerが使用。D-025参照）の1件のみ。2026年公式監査でデザイン/UI系Skill13件を撤去した経緯があり（D-019）、それとは別に必要性を確認した上で今回追加した。

## 進捗の可視化

サブエージェント（Planner/Researcher/Developer/Reviewer）実行中のみ、`subagentStatusLine`（`.claude/settings.json`）により、専門用語を使わない日本語でエージェントパネルに進捗を表示する。通常のチャット中は表示されず、LLM呼び出しも行わない。詳細はdocs/status-line.mdを参照。

## 参照ドキュメント

- REVIEW.md: レビュー方針（敵対的検証）。reviewer Agentが従う
- docs/tasks.md: 現在のタスク、優先順位、状態管理（Managerが管理）
- docs/progress.md: 作業履歴、次回開始位置（Developerが記録）
- docs/decisions.md: 設計判断、採用理由、変更履歴
- docs/agents.md: Agent構成、モデル構成、オーケストレーションルール、Hook構成
- docs/status-line.md: サブエージェント進捗の可視化（Status Line）の仕様

## デザイントークン

正本は docs/design-spec.md 2章。ダーク固定。

- 色: `--bg` #16140F / `--surface` #22201A / `--key` #2E2B24 / `--line` #3A372F / `--line-strong` #57524A / `--fg` #EDE8DC / `--fg-muted` #A8A397 / `--conn` #8A867D / `--ink` #16140F / `--str-l` #8FD3F0 / `--str-m` #F0D870 / `--str-h` #F29A8E / `--od` #9ED8A0 / `--scrim` rgba(0,0,0,.6)
- 文字: system-ui, "Noto Sans CJK JP", "Noto Sans JP", sans-serif。太さ400と700のみ。`--t-xs` 12px/1.4、`--t-sm` 13px/1.4、`--t-md` 15px/1.5、`--t-lg` 17px/1.4
- 余白: `--s1`〜`--s6` = 4 / 8 / 12 / 16 / 24 / 32px
- 角丸: `--r-tag` 2px、`--r-chip` 6px、`--r-key` 8px、`--r-sheet` 12px（上2角のみ）、円は●だけ
- 影・グロー・グラデーション・すりガラスなし
