# strategy-memo

ストリートファイター6向けの戦略メモアプリ。コンボルートとセットプレイを、タップパッドで簡単に入力し、見やすく整理する。データは端末内に保存する（サーバー・アカウントなし）。

仕様と実装手順は [docs/requirements.md](docs/requirements.md) を参照。開発は AGENTS.md の開発フローに従う。

非公式のファンメイドアプリであり、Capcomとは無関係である。

## 構成

- AGENTS.md
  - 開発方針・設計原則・ワークフロー（全AIエージェント共通、最優先で読む）

- REVIEW.md
  - レビュー方針（敵対的検証 / Adversarial Review）。reviewer Agentが従う

- CLAUDE.md
  - Claude Code固有の設定・運用ルール（AGENTS.mdをimportする）

- .claude/agents
  - planner / designer / researcher / developer / reviewer

- .claude/skills/design-principles
  - UI/UXデザインの品質判断基準（designer/developer/reviewerが使用）

- .claude/settings.json
  - SessionStart / PreCompact / PostToolUse / SubagentStop / SessionEnd Hook（セッション継続性・ドキュメント品質の補助）、subagentStatusLine（サブエージェント進捗の可視化）、enabledPlugins（Frontend Designをproject scopeで有効化）。詳細はdocs/agents.md・docs/design-workflow.md

- .claude/bootstrap.sh
  - Optional Dependency（Capability Layer）の導入状況を案内のみで表示する検出スクリプト。インストールは行わない

- .claude/commands/init-project.md
  - `/init-project`コマンド。新規プロジェクトでの初期化手順（本READMEの該当節）を実行する

- docs
  - tasks.md: タスクと状態管理
  - progress.md: 作業履歴
  - decisions.md: 設計判断の記録
  - agents.md: Agent構成・モデル構成・Hook/Status Line構成の詳細
  - agent-reach.md: [Agent-Reach](https://github.com/Panniantong/Agent-Reach) 対応（Optional Dependency、検出・フォールバック方針）
  - code-review-graph.md: [Code Review Graph](https://github.com/tirth8205/code-review-graph) 対応（Optional Dependency、影響範囲解析）
  - context7.md: [Context7](https://github.com/upstash/context7) 対応（Optional Dependency、ライブラリドキュメント確認）
  - capability-layer.md: 外部ツール検出の共通規約（Capability Layer）
  - research-workflow.md: 外部調査ワークフロー
  - design-workflow.md: デザインワークフロー（Designer/Claude Design/Frontend Designプラグインの連携）
  - status-line.md: サブエージェント進捗の可視化（Status Line）の仕様

## 開発フロー

User → Manager → Planner → Developer → Reviewer → Manager → Complete
（外部調査が必要な場合のみResearcherが、UI/UX実装を伴う場合のみDesignerが加わる）

詳細は AGENTS.md・REVIEW.md・docs/agents.md・docs/design-workflow.md を参照。
