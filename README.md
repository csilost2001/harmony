# Harnize Harmony

業務アプリ向け WYSIWYG 設計ツール。画面・テーブル・処理フローを JSON 成果物として設計し、AI コーディングエージェントと連携して業務アプリの実装まで往復できる。

- **frontend/** — React + Vite + GrapesJS + ReactFlow による設計 UI
- **backend/** — MCP server + WebSocket bridge + ファイル永続化 (port 5179)
- **`/generate-code` skill** — 設計成果物から Spring Boot / NestJS / Next.js / Thymeleaf 系の業務アプリコードを生成

---

## Quick Start (Dev Containers)

本プロジェクトの**推奨開発環境**は Dev Containers です。`.devcontainer/devcontainer.json` はリポジトリに含まれており (git tracked)、`git clone` した時点で自動的に手元に届きます。

### 前提条件

- Windows 11 + WSL2 (Ubuntu 推奨)
- Docker Desktop (Settings → Resources → WSL Integration → Ubuntu ON)
- VS Code + Dev Containers 拡張 (`ms-vscode-remote.remote-containers`)

### セットアップ手順

```bash
# WSL2 シェルで
cd ~/projects
git clone git@github.com:csilost2001/harmony.git
cd harmony

# VS Code 起動 (Remote-WSL で開く)
code .
```

VS Code 起動後:

1. 右下のポップアップで **「Reopen in Container」** をクリック (見逃したら `Ctrl+Shift+P` → `Dev Containers: Reopen in Container`)
2. 初回は image pull + features install + `postCreateCommand` で **5〜10 分**
3. 完了したら container 内ターミナルで:
   ```bash
   cd backend && npm run dev    # タブ 1
   cd frontend && npm run dev   # タブ 2
   ```
4. Windows ブラウザで `http://localhost:5173` を開く (ポート自動 forward)

### 初回起動時に作られるもの (利用者の事前準備は不要)

Reopen in Container すると以下が WSL2 host 側に自動作成されます (Docker bind mount が自動 mkdir):

```
~/.agent-containers/harmony/
├── .claude/    ← Claude Code: sessions / settings / memory / .credentials.json
├── .codex/    ← Codex CLI: auth.json / config.toml / sessions
└── .harmony/  ← Harmony 本体: recent-workspaces.json
```

これらは bind mount で container と双方向同期され、**rebuild しても消えません**。

### 初回 1 回だけ必要な手作業

```bash
# container 内ターミナルで
claude /login    # Claude Code OAuth (ブラウザ完遂)
codex login      # Codex CLI OAuth
```

`refreshToken` で 60〜90 日は自動更新されるため、日々の rebuild で再認証は不要です。

詳細・トラブルシューティングは [`docs/setup/dev-containers.md`](docs/setup/dev-containers.md) を参照してください。

### Dev Containers を使わない場合

WSL2 native セットアップも引き続きサポート対象です: [`docs/setup/wsl2-native.md`](docs/setup/wsl2-native.md)

将来的に `docker compose up` だけで Harmony を起動できる image 配布構想は [`docs/setup/distribution-roadmap.md`](docs/setup/distribution-roadmap.md) (現状未実装、#1055 L2/L3 で着手予定)。

---

## 利用者別ガイド

本プロジェクトには性質の異なる 3 種類の利用者がいます。**(1) と (2) は本リポジトリで開発環境を構築**します。**(3) は別レイヤー**で、本リポジトリの開発環境は不要です。

### (1) Harmony 本体開発者 (本リポジトリの contributor)

Harmony 自体のコードを改造する開発者。

- 上の Quick Start でセットアップ
- AI コーディングエージェント向けプロジェクトガイダンス: [`AGENTS.md`](./AGENTS.md)
- Claude Code 固有の補足: [`CLAUDE.md`](./CLAUDE.md)
- 仕様書: [`docs/spec/`](docs/spec/)

### (2) Harmony 利用者 (業務アプリ設計者)

Harmony を起動して GUI と `/generate-code` で業務アプリを設計・生成する人。

- 上の Quick Start でセットアップ (現状は (1) と同じ経路)
- 業務設計者向けワークフロー: [`docs/user-guide/`](docs/user-guide/)
- 業界別サンプルプロジェクト: [`examples/`](examples/)
- 将来的に Docker image 配布が整備されれば `docker compose up` だけで起動可能になる予定 ([`docs/setup/distribution-roadmap.md`](docs/setup/distribution-roadmap.md))

### (3) 業務アプリのエンドユーザ

(2) が `/generate-code` で生成した Spring Boot / NestJS / Next.js / Thymeleaf アプリを使うエンドユーザ。**本リポジトリも Harmony も不要**です。

生成された業務アプリは独立した Docker / Dev Container 構成を持ち (`/generate-code` skill template から出力)、Harmony とは切り離して動作します。エンドユーザ向けの起動手順は**生成アプリ側の `README.md`** を参照してください。

---

## 主要ディレクトリ

| パス | 内容 |
|---|---|
| `frontend/` | React + Vite + GrapesJS による設計 UI |
| `backend/` | MCP server + WebSocket bridge (port 5179) |
| `schemas/` | JSON Schema 一次成果物 (process-flow / extensions / conventions 等) |
| `examples/<project-id>/` | 業界別サンプル (retail / english-learning 等) |
| `workspaces/<ws-id>/` | ユーザー作業領域 (gitignored) |
| `docs/spec/` | 仕様書 |
| `docs/setup/` | 環境構築ガイド |
| `data/extensions/` | デザイナー本体組み込み拡張定義 |
| `.devcontainer/` | Dev Containers 設定 (git tracked) |
| `.claude/skills/` | Claude Code カスタムスキル (`/issues`, `/generate-code` 等) |

---

## ライセンスと貢献

ライセンスは別途リポジトリオーナーに確認してください。

PR 作成時の規約は [`AGENTS.md`](./AGENTS.md) の「PR 作成・レビューの規約」節を参照。
