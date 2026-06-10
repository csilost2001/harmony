# Harnize Harmony

業務アプリ向け WYSIWYG 設計ツール。画面・テーブル・処理フローを JSON 成果物として設計し、AI コーディングエージェントと連携して業務アプリの実装まで往復できる。

- **frontend/** — React + Vite + GrapesJS + ReactFlow による設計 UI
- **backend/** — MCP server + WebSocket bridge + ファイル永続化 (port 5179)
- **`/generate-code` skill** — 設計成果物から Spring Boot / NestJS / Next.js / Thymeleaf 系の業務アプリコードを生成

---

## 使い分け

| 目的 | 推奨入口 | 起動コマンド |
|---|---|---|
| Harmony 本体を開発する | Dev Containers | `npm run backend` + `npm run frontend` |
| Harmony を起動して設計ツールとして使う | Compose | `docker compose up` |
| 配布 image を build / smoke する | host WSL2/Linux | `bash scripts/build-harmony-image.sh local` |
| Docker ではなく Podman を使う | Compose + Podman | `podman compose up` |

Dev Containers は **開発者向け**、Compose は **利用者向け**です。VS Code Dev Containers は内部で Docker を使いますが、開発者が `docker run` を直接打たない運用です。Compose は長い `docker run` の起動設定を `compose.yml` に固定し、利用者が短いコマンドで Harmony を起動するために使います。

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
2. 初回は image pull + `postCreateCommand` で **数分〜10 分** (Phase 5 #1120 以降は features install 廃止、cold start 短縮)
3. 完了したら container 内ターミナルで (どちらも root から実行可、#1400):
   ```bash
   npm run backend     # タブ 1 (常駐)
   npm run frontend    # タブ 2 (Ctrl+C で頻繁に再起動)
   ```
4. Windows ブラウザで `http://localhost:5173` を開く (ポート自動 forward)

### 開発サーバの操作 (#1400)

各サーバは別ターミナルで個別起動・管理する運用です (旧 `npm run dev` で frontend + backend を concurrently で束ねる方式は #1400 で撤去)。

| やりたいこと | コマンド |
|---|---|
| backend 起動 (常駐) | `npm run backend` |
| frontend 起動 | `npm run frontend` |
| backend 再起動 | `npm run restart:backend` |
| frontend 再起動 | `npm run restart:frontend` |
| port 5173 / 5179 を握るプロセスを強制 kill | `npm run kill` |

`Ctrl+C` で各サーバは 3 秒以内に graceful shutdown します (Codex 孫プロセスも確実に kill、port 即時解放)。詳細・トラブルシューティングは [`AGENTS.md`](AGENTS.md) §「開発サーバ」を参照。

### 初回起動時に作られるもの (利用者の事前準備は不要)

Reopen in Container すると以下が WSL2 host 側に自動作成されます (`initializeCommand` が container 起動前に mkdir、#1340):

```
~/.agent-containers/harmony/
├── .claude/    ← Claude Code: sessions / settings / memory / .credentials.json
├── .codex/    ← Codex CLI: auth.json / config.toml / sessions
├── .copilot/  ← Copilot CLI: session-state / command-history-state.json / memory
└── .harmony/  ← Harmony 本体: recent-workspaces.json
```

加えて、host の `~/.config/gh/` (= `gh` CLI auth) を container 内 `/home/node/.config/gh/` に bind mount します。Copilot CLI は `gh auth` を認証元として使うため必須、`gh` 単体使用にも有効です (host で `gh auth login` 済みならそのまま継承)。

これらは bind mount で container と双方向同期され、**rebuild しても消えません**。

### 初回 1 回だけ必要な手作業

```bash
# container 内ターミナルで、利用したい AI CLI だけ login (全部入れる必要なし)
claude /login    # Claude Pro/Max 利用時
codex login      # ChatGPT Plus 利用時
# Copilot CLI 利用時:
#   host で `gh auth login` 済みなら追加 login 不要
#   未済なら container 内で 1 度 `gh auth login` を実行
```

`refreshToken` で 60〜90 日は自動更新されるため、日々の rebuild で再認証は不要です。

詳細・トラブルシューティングは [`docs/setup/dev-containers.md`](docs/setup/dev-containers.md) を参照してください。

### Dev Containers を使わない場合

WSL2 native セットアップも引き続きサポート対象です: [`docs/setup/wsl2-native.md`](docs/setup/wsl2-native.md)

Docker / Podman Compose で Harmony を「使うだけ」の場合は [`docs/setup/compose-runtime.md`](docs/setup/compose-runtime.md) を参照してください。Docker image 配布方針と maintainer 向け build / smoke 手順は [`docs/setup/distribution-roadmap.md`](docs/setup/distribution-roadmap.md) を参照してください。通常の本体開発は引き続き Dev Containers が推奨です。

---

## 利用者別ガイド

本プロジェクトには性質の異なる 3 種類の利用者がいます。**(1) は本リポジトリで開発環境を構築**します。**(2) は Compose runtime で利用し、Harmony 本体を改造する場合だけ本リポジトリを checkout** します。**(3) は別レイヤー**で、本リポジトリの開発環境は不要です。

### (1) Harmony 本体開発者 (本リポジトリの contributor)

Harmony 自体のコードを改造する開発者。

- 上の Quick Start でセットアップ
- AI コーディングエージェント向けプロジェクトガイダンス: [`AGENTS.md`](./AGENTS.md)
- Claude Code 固有の補足: [`CLAUDE.md`](./CLAUDE.md)
- 仕様書: [`docs/spec/`](docs/spec/)

### (2) Harmony 利用者 (業務アプリ設計者)

Harmony を起動して GUI と `/generate-code` で業務アプリを設計・生成する人。

- Docker / Podman が使える環境では `compose.yml` で起動: [`docs/setup/compose-runtime.md`](docs/setup/compose-runtime.md)
- Harmony 本体 repo を編集する必要がある場合のみ上の Dev Containers Quick Start を使う
- 業務設計者向けワークフロー: [`docs/user-guide/`](docs/user-guide/)
- 業界別サンプルプロジェクト: [`examples/`](examples/)

### Compose で Harmony を起動する利用者向け手順

現時点の checked-in default は local preview 用の `ghcr.io/csilost2001/harmony:local` です。公開済み image tag を使う場合は `.env` の `HARMONY_IMAGE` を `ghcr.io/csilost2001/harmony:<version>` に変更してください。local default のまま使う場合は先に image を build します。

```bash
bash scripts/build-harmony-image.sh local
cp .env.example .env   # 必要な場合だけ編集
docker compose up
```

ブラウザで `http://127.0.0.1:5179/` を開きます。Podman 環境では `podman compose up` を使います。詳細は [`docs/setup/compose-runtime.md`](docs/setup/compose-runtime.md) を参照してください。

### Docker / Podman image をローカルで確認する maintainer 向け手順

Image build / smoke は Dev Container 内ではなく、Docker Desktop / Docker Engine / Podman に接続できる WSL2 host などで実行します。

```bash
cd ~/projects/harmony
bash scripts/build-harmony-image.sh local
HARMONY_IMAGE=ghcr.io/csilost2001/harmony:local bash scripts/smoke-harmony-image.sh local
bash scripts/smoke-harmony-compose.sh local
```

Podman の場合:

```bash
CONTAINER_ENGINE=podman bash scripts/build-harmony-image.sh local
CONTAINER_ENGINE=podman HARMONY_IMAGE=ghcr.io/csilost2001/harmony:local bash scripts/smoke-harmony-image.sh local
CONTAINER_ENGINE=podman bash scripts/smoke-harmony-compose.sh local
```

配布 image は container port 5179 で SPA / HTTP MCP / WebSocket をまとめて提供します。smoke script は `127.0.0.1:${HARMONY_SMOKE_PORT}:5179` で local-only publish し、`HARMONY_SMOKE_PORT=5180` のように host 側 port を変えると host port remap も smoke できます。

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
| `ai-skills/` | AI スキル (Claude Code / Codex / Copilot CLI 共通、Agent Skills 標準準拠、`/issues` / `/generate-code` 等) |

---

## ライセンスと貢献

ライセンスは別途リポジトリオーナーに確認してください。

PR 作成時の規約は [`AGENTS.md`](./AGENTS.md) の「PR 作成・レビューの規約」節を参照。
