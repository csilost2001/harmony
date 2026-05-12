# Dev Containers セットアップ + WSL2 native からの移行手順

VSCode Dev Containers 拡張で Harmony を開発する手順書。**WSL2 native (`docs/setup/wsl2-docker-migration.md` Phase 1) と並行運用可** で、移行は段階的に進められる。

## なぜ Dev Containers か

- **複数プロジェクト共存**: 1 つの WSL2 に Node / Java / Python が混在しても、プロジェクト間で完全 isolation
- **JDK / Node バージョンのプロジェクト別固定**: `devcontainer.json` の宣言で再現可
- **onboarding コスト**: 新規開発者 / 他チーム / OSS contributor は `git clone && Reopen in Container` だけで dev 環境完成
- **WSL2 distro を汚さない**: Node / npm / playwright browsers / 各種 CLI はすべて container 内、ホスト WSL2 は git + docker クライアントだけで足りる

WSL2 native が安定運用できているなら無理に移行する必要はない。**両モード併用** が当面の標準。

## 前提条件

- **Windows 11 + WSL2** (Ubuntu 推奨)
- **Docker Desktop** (Settings → Resources → WSL Integration → Ubuntu ON)
  - または WSL2 内 Docker Engine (Docker Desktop ライセンスを避けたい場合)
- **VSCode** + **Dev Containers 拡張** (`ms-vscode-remote.remote-containers`)

セットアップ手順は [`wsl2-docker-migration.md`](./wsl2-docker-migration.md) Step 1-0〜1-1 と共通。

## Quick Start (新規 / fresh clone)

```bash
# WSL2 シェルで
cd ~/projects
git clone git@github.com:<org>/harmony.git
cd harmony

# VSCode 起動 (Remote-WSL で開く)
code .
```

VSCode 起動後:

1. 右下 (or `Ctrl+Shift+P` → `Dev Containers: Reopen in Container`) のポップアップで **「Reopen in Container」** をクリック
2. 初回は image pull + features install + `postCreateCommand` 実行で **5〜10 分** かかる
3. 完了すると VSCode 内蔵ターミナルが container 内 bash で開く
4. ターミナルで以下を実行:

```bash
# backend を起動 (タブ 1)
cd backend
npm run dev

# frontend を起動 (タブ 2 — ターミナル分割 or 新規)
cd frontend
npm run dev
```

5. Windows ブラウザで `http://localhost:5173` を開く (ポート 5173 / 5179 は Dev Containers が自動 forward)

## WSL2 native ユーザー向け移行手順

すでに `docs/setup/wsl2-docker-migration.md` Phase 1 で WSL2 native 開発している場合の移行ステップ。

### Step M-1: 現状を保全 (退却ポイント)

移行が合わなければ即元に戻せるよう保全する。

```bash
cd ~/projects/harmony

# 作業中の変更を一旦 stash or commit
git status
git stash push -m "before-devcontainer-migration"   # 必要に応じて

# 念のため main を最新化
git fetch origin
git log --oneline origin/main..HEAD                  # 未 push commit を確認
```

WSL2 native の `node_modules` / `~/.npm` / `~/.nvm` は **そのまま残す**。移行後も WSL2 native で動かしたければ即戻れる。

### Step M-2: Docker Desktop の動作確認

```bash
docker version
docker run --rm hello-world
```

`hello-world` が出ない場合、Docker Desktop の Settings → Resources → WSL Integration で Ubuntu 統合を有効化。

### Step M-3: VSCode Dev Containers 拡張をインストール

VSCode で:

1. 拡張機能パネル (`Ctrl+Shift+X`)
2. `Dev Containers` で検索 → Microsoft 公式 (`ms-vscode-remote.remote-containers`) を install
3. すでに Remote-WSL 拡張を使っていれば、両方併用で問題なし

### Step M-4: Reopen in Container

1. VSCode で `~/projects/harmony` を開く (Remote-WSL 接続状態)
2. 右下に「Folder contains a Dev Container configuration file. Reopen folder to develop in a container.」のポップアップ
3. **「Reopen in Container」** をクリック
   - ポップアップを見逃したら `Ctrl+Shift+P` → `Dev Containers: Reopen in Container`
4. 初回は image pull (~1.5 GB) + features + npm install + playwright install で **5〜10 分**
5. 完了後、VSCode の左下が `Dev Container: Harmony Dev` 表示になる

### Step M-5: 動作確認

container 内ターミナルで:

```bash
# Node / npm / git / gh が container 内に存在することを確認
node --version    # v20.x.x
npm --version
gh --version

# 起動
cd backend && npm run dev    # タブ 1
cd frontend && npm run dev   # タブ 2
```

Windows ブラウザで `http://localhost:5173` がデザイナー UI を表示すれば OK。

### Step M-6: 既存 `node_modules` の扱い

- **基本: 残す**。WSL2 native へ戻る選択肢を保持
- container 内では `/workspaces/harmony/frontend/node_modules` (bind mount された WSL2 native のもの) を上書きしないよう、container 内で `npm install` 済 (postCreateCommand)
- 容量が気になるなら、安定運用 1 週間後に WSL2 native 側の `node_modules` を削除:

```bash
# 移行を確定する時のみ
cd ~/projects/harmony
rm -rf frontend/node_modules backend/node_modules
```

### Step M-7: WSL2 distro のクリーンアップ (任意 / 移行確定後)

完全に Dev Containers に切り替えるなら、WSL2 native の Node 関連を削除可能:

```bash
# 慎重に: 他の WSL2 プロジェクトで Node を使っているなら残す
rm -rf ~/.npm ~/.cache/playwright
# nvm / Node 本体は他プロジェクトで使うなら残す
```

これは**やらなくても良い**。複数プロジェクトを WSL2 native と DevContainer で使い分けるなら nvm + Node は残しておくのが普通。

### Step M-8: WSL2 native に戻りたい場合

```bash
# VSCode で
Ctrl+Shift+P → "Dev Containers: Reopen Folder Locally"
```

WSL2 native 開発に即戻る。`.devcontainer/` は repo に残っているが、Reopen in Container しない限り影響なし。

## 両モード併用 (現実的な運用)

`.devcontainer/` が repo にあっても、以下は変わらない:

- WSL2 native の `cd backend && npm run dev` は引き続き動く
- `~/.claude/`, `~/.gitconfig`, `~/.ssh/` は WSL2 native のものをそのまま使う (Remote-WSL モード時)
- VSCode で開く時に **WSL モードか Container モードを選択** できる

| モード | 起動方法 | source の場所 | tools の場所 |
|---|---|---|---|
| WSL2 native | `code .` → Remote-WSL | WSL2 ext4 | WSL2 distro 内 (nvm / Node) |
| Dev Container | `code .` → Reopen in Container | WSL2 ext4 (bind mount) | container 内 (image + features) |

`/workspaces/harmony` (container 内 path) と `~/projects/harmony` (WSL2 path) は **同じ実体** (bind mount) なので、片方で編集したファイルはもう片方からも見える。同時起動はポート競合するので避ける。

## AI CLI (Claude Code / Codex) の扱い

VSCode 拡張 (`anthropic.claude-code`) は `customizations.vscode.extensions` で自動 install されるが、**CLI 本体** (`claude` / `codex` コマンド) は別途必要。

### 自動インストール (postCreateCommand)

`postCreateCommand` で global npm install:

```
npm install -g @anthropic-ai/claude-code @openai/codex
```

container build 完了時点で `claude` / `codex` コマンドが使える状態になる。

### auth の永続化 (Named volume)

`~/.claude/` / `~/.codex/` を **Docker named volume** に保存する:

```jsonc
"mounts": [
  "source=harmony-claude,target=/home/node/.claude,type=volume",
  "source=harmony-codex,target=/home/node/.codex,type=volume"
]
```

これにより:

- **rebuild しても auth トークン / 設定 / memory が残る** (Docker が volume を別管理、container 破棄しても残存)
- **host の `~/.claude/` は参照しない** — host に CLI を install していない人 / 他のディレクトリレイアウトの人にも影響なし
- **他プロジェクトの container と完全 isolation** — `harmony-claude` / `harmony-codex` は Harmony 専用、他プロジェクト containers は別の volume 名で完全分離
- 各 volume は Docker が `/var/lib/docker/volumes/harmony-claude/_data/` のような専用領域に保存

### 初回 setup (rebuild 後 1 回だけ必要)

Named volume は初回 build 時は **空** なので、container 内で:

```bash
# Claude Code 認証
claude --help   # 初回は auth login への誘導が出る、指示に従う
# または明示的に:
# claude auth login

# Codex 認証
codex login
```

ブラウザが立ち上がって OAuth フロー (Anthropic / OpenAI のサブスクアカウントでログイン)。所要 2-3 分。

完了後、`harmony-claude` / `harmony-codex` volume にトークンが書き込まれ、**以降は rebuild しても再 auth 不要**。

### 初回 setup (任意): host の memory を container に取り込む

Named volume なので container 内の memory は host とは独立 (空からスタート)。host で本会話の文脈や過去 memory を蓄積している場合、初回のみ移植したい場合:

#### WSL2 host 側で 1 行

```bash
# host (WSL2) で実行、container が起動中であること
docker cp ~/.claude/projects/-home-${USER}-projects-harmony/memory \
  $(docker ps --filter "label=devcontainer.local_folder=$HOME/projects/harmony" --format '{{.ID}}'):/home/node/.claude/projects/-workspaces-harmony/
```

実行後、container 内で:

```bash
ls ~/.claude/projects/-workspaces-harmony/memory/   # host の memory ファイル群が見える
```

これで host で蓄積した本会話 / 過去 memory が container 内 Claude Code でも recall される状態になる。

**注意**: 以降は host と container で memory が**別々に育つ** (volume も path encoding も別)。両方で同じ memory を保ちたいなら、定期的に同期する手間が要る。普段は片方 (container 内) だけで動かすのが楽。

### バージョン更新

container 内の CLI を最新化したい時:

```bash
# container 内ターミナルで
npm install -g @anthropic-ai/claude-code @openai/codex
```

host 側の `claude` / `codex` とは独立して更新可能。

## 仕組み解説: devcontainer.json の三層構造

| 要素 | 役割 | Harmony での設定 |
|---|---|---|
| `image` | 土台 (base image) | `mcr.microsoft.com/devcontainers/typescript-node:20` (Node 20 + git + curl + non-root user) |
| `features` | ツール後付け (宣言的) | `github-cli` |
| `postCreateCommand` | プロジェクト固有 setup | `npm install` (frontend + backend) + `playwright install chromium` |

「重い + 共通」→ image / 「軽い + バージョン違い」→ features / 「このプロジェクト固有」→ postCreateCommand、という指針。

専用 image を pre-build して GHCR に push する案 (#847 で言及した「モデル 3」) は **当面採用しない**。Phase 1 は features + postCreateCommand で十分。features の install 時間が苦痛になってから image 化検討。

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| `Reopen in Container` ポップアップが出ない | `.devcontainer/devcontainer.json` がリポジトリ root にあるか確認。`Ctrl+Shift+P` → `Dev Containers: Reopen in Container` を手動実行 |
| 初回 build が完了しない / network エラー | Docker Desktop が起動しているか / インターネット接続 / 社内 proxy 設定。`docker pull mcr.microsoft.com/devcontainers/typescript-node:20` を WSL2 シェルで先に試す |
| `postCreateCommand` で `npm install` が失敗 | bind mount された `node_modules` (WSL2 native で install したもの) が container と互換性なく失敗するケースあり。一度 WSL2 側で `rm -rf frontend/node_modules backend/node_modules` してから rebuild container |
| Playwright browsers の install が遅い / 失敗 | postCreateCommand の `playwright install --with-deps chromium` で 3-5 分。完全 offline 環境では失敗。スキップしたい時は `.devcontainer/devcontainer.json` の postCreateCommand から該当行を削除 |
| Vite HMR がブラウザに反映されない | bind mount + inotify の問題。`frontend/vite.config.ts` の watch options に `{ usePolling: true, interval: 100 }` を追加。または container 内で `export CHOKIDAR_USEPOLLING=1` |
| port 5173 / 5179 が forward されない | VSCode 下部の `PORTS` パネルで forward 状態を確認。`portsAttributes` で auto-forward 設定済 |
| `~/.gitconfig` / `~/.ssh/` が container 内で使えない | Dev Containers は通常ホストの `~/.gitconfig` / `~/.ssh/` を mount するが、必要なら `mounts` 設定追加。`gh auth login` を container 内で再実行する手もあり |
| `codex login` / `claude` 起動で `Permission denied (os error 13)` | Named volume mount target (`/home/node/.claude` / `.codex`) の所有権が root になっている。`devcontainer.json` の `onCreateCommand` で `sudo chown -R node:node` を実行する仕組みあり (container 新規作成時 1 回だけ走る)。手動で直す場合: `sudo chown -R node:node ~/.claude ~/.codex` |
| backend 起動時に `port 5179 already in use` | WSL2 native 側で backend が動いている。`pkill -f tsx` で WSL2 native プロセスを停止してから container 内で起動 |
| Claude Code が container 内で MCP に繋がらない | `.mcp.json` の `http://localhost:5179/mcp` は container 内では localhost = container 自身。backend が container 内で `npm run dev` 起動中であることを確認 |
| container が起動するが永続化が消える | bind mount が正しく動いていない。VSCode `Dev Containers: Show Container Log` で mount エラーを確認 |
| Docker Desktop ライセンスを使いたくない | rootless Docker (`apt install docker.io` を WSL2 内) でも動作。ただし Windows ホストからの port forward に追加設定要 |

## CI 連携 (将来)

Dev Containers の image を CI でも使うと、ローカル / CI 完全一致が達成できる。本リポジトリは現状 CI 未導入だが、将来的に検討する場合は [`@devcontainers/cli`](https://github.com/devcontainers/cli) を CI で使い、image build + 内部コマンド実行をスクリプト化できる。

## 関連ドキュメント

- [`AGENTS.md`](../../AGENTS.md) — プロジェクト全般のガイダンス
- [`CLAUDE.md`](../../CLAUDE.md) — Claude Code 固有
- [`wsl2-docker-migration.md`](./wsl2-docker-migration.md) — WSL2 native 移行手順 (Phase 1) + 配布用 Dockerfile (Phase 2)
- ISSUE [#847](https://github.com/csilost2001/harmony/issues/847) — Dev Containers 移行 roadmap

## 改訂履歴

| 日付 | 改訂内容 |
|---|---|
| 2026-05-12 | 初版 (#847 A セクション着手) |
