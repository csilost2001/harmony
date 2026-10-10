# CLAUDE.md

Claude Code 向けの補足。プロジェクト共通のルールは [AGENTS.md](./AGENTS.md) にある (Codex CLI 等も同じファイルを読む)。

@AGENTS.md

---

## Claude Code 固有の事項

### MCP 接続

- `.mcp.json` の URL エントリで backend (`http://localhost:5179/mcp`) に接続する。backend が `npm run backend` で起動済みであることが前提 (自動起動しない)
- Dev Containers 内でも同じ URL で接続できる (`localhost` = container 自身)
- ブラウザ確認用 MCP (Playwright / chrome-devtools) は既定で headless を使う。利用者が「画面を見たい」と言った時だけ `*-headed` を使う。詳細: [docs/conventions/docs-site-and-browser-smoke.md](docs/conventions/docs-site-and-browser-smoke.md)
- MCP 用ブラウザが未インストールで使えない場合は、`npm run ui:shots` / `npm run ui:audit` (frontend の Playwright を直接使う) で代替できる

### 開発環境

推奨は Dev Containers (`.devcontainer/`)、WSL2 native も可。手順: [README.md](README.md) / [docs/setup/dev-containers.md](docs/setup/dev-containers.md) / [docs/setup/wsl2-native.md](docs/setup/wsl2-native.md)

### Skills (`ai-skills/<name>/SKILL.md` が正本、`.claude/skills/` は symlink)

| コマンド | 用途 |
|---|---|
| `/issues <N>` | ISSUE を実装から PR まで完遂 |
| `/review-pr <N>` / `/review-issue <N>` | PR の独立レビュー / ISSUE 単位の網羅性監査 |
| `/create-flow` / `/review-flow <flowId>` | 処理フロー JSON の作成 / 実行セマンティクスのレビュー |
| `/generate-code` / `/generate-tests` | 設計書からのコード生成 / テスト生成 |
| `/import-md <dir>` | Markdown 設計書を Harmony JSON に変換 |
| `/rename-screen-ids` | 画面項目 ID の再命名 |
| `/document-ui [<screen>]` | UI 操作リファレンスの自動生成 |
| `/test-strategy` | テスト実装時の方針 (自動起動) |
| `/release-review` | リリース前の自律レビュー |
| `/publish-dev-image <ver>` | Dev Container base image の公開 (maintainer 専用) |

### Memory

- 自動メモリは `~/.claude/projects/<encoded-path>/memory/` (マシン単位、git 管理外)。`MEMORY.md` が索引
- クラウド版 Claude Code ではセッションごとに消える。複数セッションで共有すべき知見は AGENTS.md / docs/ に commit する

### クラウド版 Claude Code の push 制限

クラウド版は git proxy が push 先ブランチを制限する。push できるのは自セッションの designated branch (`claude/<...>`) と `feat/test-push-*` だけ。他のブランチへの push は HTTP 403 になる。統合ブランチに積みたい場合は `git push origin <local>:feat/test-push-<issue>-<topic>` で staging し、後続セッションか利用者が本来のブランチへ反映する。ローカル CLI 版にこの制限は無い。

### Codex plugin

実装委譲は `Agent(subagent_type="codex:codex-rescue")`、レビューは `/codex:review` / `/codex:adversarial-review`。設定は `.codex/config.toml`。
