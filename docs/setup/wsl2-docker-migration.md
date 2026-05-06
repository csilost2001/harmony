# WSL2 + Docker 開発環境移行手順 (Phase 1 + 2)

本リポジトリ (harmony) の開発環境を、Windows native から WSL2 + Docker ベースへ段階的に移行する手順書。

## 移行の目的

- **Phase 1 (必須)**: ソースを WSL2 native に移し、I/O / file watcher / AI エージェントを native 速度で動かす。
- **Phase 2 (推奨)**: 配布形態として Dockerfile + compose を追加 (利用者向け、メンテナ自身の dev は引き続き WSL2 native)。

dev 自体を Docker に入れない方針: `npm run dev` の hot reload とデバッガが速いため、メンテナの開発サイクルでは Docker 化は不要。Docker は **配布物** として価値が高い。

---

## AI エージェント (Claude Code 等) への指示

このドキュメントを参照して step-by-step で実行する場合、必ず以下を守ること。

1. **1 ステップずつ実行**。複数 Step を一括実行しない。
2. 各 Step の **「成功確認」** セクションを満たしてから次へ進む。満たさない場合はユーザーに報告して指示を仰ぐ。
3. 失敗・想定外の出力があれば**ユーザーに報告して指示を仰ぐ** (自己判断で進めない、特に削除系)。
4. 既存の Windows 側 `C:\projects\html-designer\` は **絶対に削除しない**。Phase 1 完了後の保険として保持する。
5. WSL2 シェル内のコマンド実行を前提とする。`Bash` ツール使用時は WSL2 内で動作するか確認すること。
6. ユーザー名 / org 名等のプレースホルダ (`<user>` / `<org>` / `<username>`) は実値に置換が必要。不明ならユーザーに確認する。
7. 各 Step の所要目安: 5〜15 分。長くかかる場合は途中報告。

---

## 移行前後の構成

### 現状 (Windows native)

```
Windows
├── C:\projects\html-designer\        ← 現在の作業ディレクトリ
├── C:\Users\csilo\.claude\           ← Claude Code 設定 / memory
└── Node.js (Windows native install)
```

### Phase 1 完了時

```
WSL2 (Ubuntu)
├── /home/<user>/projects/harmony/   ← 新しい作業ディレクトリ
├── /home/<user>/.claude/                  ← Claude Code 設定 (新規 or 移行)
└── nvm + Node.js 20

Windows
├── C:\projects\html-designer\        ← 退役 (削除しない、参照専用)
├── VSCode (UI のみ、Remote-WSL で接続)
└── Docker Desktop (WSL2 backend)
```

### Phase 2 完了時

```
リポジトリに以下が追加される
├── frontend/Dockerfile
├── backend/Dockerfile
├── docker-compose.yml          (配布用)
└── docker-compose.dev.yml      (任意、Docker dev 用)

ghcr.io (or 別レジストリ) に image が公開される
└── ghcr.io/<org>/harmony:<version>
└── ghcr.io/<org>/harmony-backend:<version>
```

---

## Phase 1: WSL2 native 移行 (必須)

### Step 1-0: 前提条件チェック

WSL2 + Docker Desktop が基本セットアップ済みかチェックする。

**Windows PowerShell で実行**:

```powershell
wsl --status
wsl -l -v
```

**期待される出力**:
- `WSL のバージョン: 2`
- `Ubuntu` のディストリビューションが `STATE: Running` または `Stopped` として LIST にある

未セットアップの場合:
- WSL2: `wsl --install -d Ubuntu` (管理者 PowerShell)
- Docker Desktop: 公式サイトからインストールし、Settings → Resources → WSL Integration → Ubuntu を ON

#### 成功確認
- [ ] `wsl --status` が `WSL のバージョン: 2` を含む
- [ ] `wsl -l -v` の出力に `Ubuntu` が含まれる
- [ ] WSL2 シェルが起動できる (PowerShell で `wsl` 実行で bash プロンプト)

---

### Step 1-1: WSL2 内基本ツール確認・インストール

WSL2 (Ubuntu) シェルで実行。

**チェック**:

```bash
echo "=== WSL2 Tools Check ==="
echo "Node:    $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "npm:     $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "git:     $(git --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "gh:      $(gh --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
echo "Docker:  $(docker --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Compose: $(docker compose version 2>/dev/null || echo 'NOT INSTALLED')"
```

**未インストール対応**:

```bash
# nvm + Node 20
if ! command -v nvm >/dev/null 2>&1; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  source ~/.bashrc
fi
nvm install 20
nvm alias default 20

# git / gh
sudo apt update
sudo apt install -y git gh
```

Docker は **Windows 側 Docker Desktop の WSL2 統合** 経由で使う。WSL2 内に直接 docker をインストールしないこと。

**git 初期設定**:

```bash
git config --global user.name "Hidekatsu Matsukida"
git config --global user.email "csilost2001@gmail.com"
git config --global core.autocrlf input
git config --global init.defaultBranch main
```

**SSH 鍵 + GitHub 登録**:

```bash
# 既存鍵チェック
ls ~/.ssh/id_ed25519 2>/dev/null && echo "既存鍵あり" || ssh-keygen -t ed25519 -C "csilost2001@gmail.com"

# 公開鍵を表示 (GitHub に登録する用)
cat ~/.ssh/id_ed25519.pub
```

表示された公開鍵を **GitHub Settings → SSH and GPG keys → New SSH key** に貼り付け。

**接続確認**:

```bash
ssh -T git@github.com   # "Hi <username>!" が出れば OK
gh auth login           # CLI 経由でも認証
```

#### 成功確認
- [ ] `node --version` が `v20.x.x` を返す
- [ ] `git --version`, `gh --version`, `docker --version` が全て表示される
- [ ] `ssh -T git@github.com` で `Hi <username>!` が表示される
- [ ] `gh auth status` で `Logged in to github.com` 表示

---

### Step 1-2: harmony を WSL2 に clone

```bash
mkdir -p ~/projects
cd ~/projects

# 既存の Windows 側 (C:\projects\html-designer) はそのまま残す
git clone git@github.com:<org>/harmony.git
cd harmony

# 状態確認
git status
git log --oneline -5
git branch -a | head -20
```

**重要**:
- `C:\projects\html-designer\` は触らない (削除も移動も rename もしない)
- 動作確認が完了するまで Windows 側を保険として保持

#### 成功確認
- [ ] `~/projects/harmony/` が存在し、`.git/` ディレクトリがある
- [ ] `git status` でクリーンな状態か作業中の変更が見える
- [ ] `C:\projects\html-designer\` がそのまま残っている (`ls /mnt/c/projects/html-designer/` で確認)

---

### Step 1-3: 依存パッケージインストール

```bash
cd ~/projects/harmony

# .nvmrc があれば使用
[ -f .nvmrc ] && nvm use

# frontend
cd frontend
npm install
cd ..

# backend
cd backend
npm install
cd ..
```

**所要時間**: 各 1〜3 分 (WSL2 native なので速い)。Windows 側で同操作した時より大幅に速いはず。

#### 成功確認
- [ ] `frontend/node_modules/` が存在
- [ ] `backend/node_modules/` が存在
- [ ] `npm install` が exit code 0 で終了 (deprecation 警告は許容)

---

### Step 1-4: backend 起動確認

WSL2 シェル (ターミナル 1) で:

```bash
cd ~/projects/harmony/backend
npm run dev
```

**期待される出力例**:
- `MCP server` のような起動メッセージ
- ポート `5179` の listen 開始
- WebSocket bridge 起動メッセージ

このターミナルは閉じずに残す (常駐させる)。

別の WSL2 タブで疎通確認:

```bash
curl -s http://localhost:5179/mcp -o /dev/null -w "%{http_code}\n"
# 200 / 401 / 405 等のレスポンスコードが返れば listen 成立
```

#### 成功確認
- [ ] backend プロセスが起動継続中 (Ctrl+C しない)
- [ ] curl で何らかのレスポンスコードが返る (具体的な値は問わず、connection refused でないこと)
- [ ] 別タブから `lsof -iTCP:5179` で listening 確認できる (任意)

---

### Step 1-5: designer フロント起動確認

別の WSL2 タブ (ターミナル 2) で。Step 1-4 のターミナルは残したまま。

```bash
cd ~/projects/harmony/designer
npm run dev
```

**期待される出力**:
```
VITE vX.X.X  ready in XXX ms
➜  Local:   http://localhost:5173/
```

**動作確認**:
- Windows 側のブラウザ (Chrome / Edge) で `http://localhost:5173` を開く
- デザイナー画面が表示される
- 右下 / 左下のステータス表示で MCP 接続状態が OK 系
- DevTools (F12) Console に critical なエラーがない

#### 成功確認
- [ ] ブラウザで `http://localhost:5173` がデザイナー UI を表示
- [ ] MCP 接続 OK の表示 (詳細はプロジェクトの UI 仕様による)
- [ ] テスト的に画面を作成・保存 → `~/projects/harmony/workspaces/<id>/` 等にファイルが書き込まれる

---

### Step 1-6: VSCode を Remote-WSL に切替

1. Windows の VSCode を起動
2. 拡張機能 `Remote - WSL` (Microsoft 公式) をインストール (未導入なら)
3. 左下の青い `><` アイコン → `Connect to WSL`
4. `File → Open Folder` → `/home/<user>/projects/harmony`
5. ステータスバー左下が `WSL: Ubuntu` と表示される

**WSL2 側に拡張機能を導入**:
- `ESLint`, `Prettier` 等の言語系
- `GitHub Copilot` (拡張機能パネルで「Install in WSL: Ubuntu」ボタン)
- `Docker` (任意)

VSCode 内蔵ターミナルが bash で開くようになる。`npm run dev` も VSCode 内ターミナルで起動可能。

#### 成功確認
- [ ] ステータスバー左下が `WSL: Ubuntu` 表示
- [ ] VSCode 内蔵ターミナル (Ctrl+`) が bash プロンプトで開く
- [ ] `Ctrl+Shift+P` → `Remote-WSL: Show Log` でエラーがない
- [ ] 主要拡張 (Copilot 等) が WSL: Ubuntu 側にインストール済みになっている

---

### Step 1-7: Claude Code を WSL2 側にインストール

```bash
# WSL2 シェルで
npm install -g @anthropic-ai/claude-code

# 動作確認
claude --version

# プロジェクトディレクトリで起動
cd ~/projects/harmony
claude
```

`.mcp.json` (リポジトリ内) は `http://localhost:5179/mcp` を指す URL エントリなので、backend が WSL2 内で動いていれば自動で接続される (Step 1-4 が起動継続中であること)。

#### 成功確認
- [ ] `claude --version` が表示される
- [ ] `~/projects/harmony` で `claude` が起動する
- [ ] Claude Code から MCP の tool 一覧が見える / 呼び出せる
- [ ] Windows 側で動いていた Claude Code (PowerShell から起動するもの) は使わなくなる

---

### Step 1-8: Claude Code memory / 設定の引き継ぎ (任意)

Windows 側 (`C:\Users\csilo\.claude\`) の memory を WSL2 側に持ち込む場合のみ実施。新規セッションから始める場合はスキップ可。

```bash
# Windows 側の memory ディレクトリを確認
ls /mnt/c/Users/csilo/.claude/projects/

# 該当プロジェクトディレクトリ名を確認
# 元 (Windows): C--projects-html-designer
# 新 (WSL2):    -home-<user>-projects-harmony (パスから自動生成される)

mkdir -p ~/.claude/projects
cp -r /mnt/c/Users/csilo/.claude/projects/C--projects-html-designer \
      ~/.claude/projects/-home-csilo-projects-harmony

ls ~/.claude/projects/-home-csilo-projects-harmony/memory/
```

**注意**: コピー後にディレクトリ名がプロジェクトパスと対応していないと Claude Code が memory を読み込めない。実際のディレクトリ名規則は Claude Code のバージョンに依存するので、初回起動後に `~/.claude/projects/` 配下に何ができるか確認してから合わせる方が確実。

#### 成功確認
- [ ] (任意) `~/.claude/projects/` 配下に該当ディレクトリがある
- [ ] (任意) `MEMORY.md` の内容が WSL2 セッションで recall される

---

### Step 1-9: Phase 1 完了総合テスト

以下が全て動作することを確認:

- [ ] WSL2 シェルで `cd ~/projects/harmony` できる
- [ ] `cd backend && npm run dev` が起動継続
- [ ] `cd frontend && npm run dev` が起動継続 (別タブ)
- [ ] Windows ブラウザで `http://localhost:5173` でデザイナー操作可
- [ ] backend 経由で `workspaces/` に JSON ファイルが書き込まれる
- [ ] WSL2 内の Claude Code が起動して MCP tool を呼べる
- [ ] VSCode (Remote-WSL) でソース編集 → save → Vite HMR がブラウザに反映される
- [ ] `git status`, `git commit`, `git push` が WSL2 から成功する
- [ ] Windows 側 `C:\projects\html-designer\` がまだ残っている (削除していない)

#### Phase 1 完了

ここまで全て OK なら Phase 1 完了。

**運用安定化期間**: 1〜2 週間ほど WSL2 環境で運用し、問題が出ないことを確認する。問題が出たら一時的に Windows 側 (`C:\projects\html-designer\`) に戻れる状態を維持。

**退役判断**: 1〜2 週間運用して安定したら、Windows 側を archive 化または削除。
- archive 化: `Move-Item C:\projects\harmony C:\projects\_archived\harmony-windows-2026-XX-XX`
- 完全削除: 慎重に。git push 漏れがないことを WSL2 側と diff チェックしてから

---

## Phase 2: Docker compose 配布形態を追加 (推奨)

メンテナ自身の dev は引き続き WSL2 native のまま。**配布物として Dockerfile + compose を追加**して、利用者が `docker compose up` だけで動かせるようにする。

**実施タイミング**:
- Phase 1 完了後、運用が 2 週間以上安定してから
- 社内他メンバーへのツール配布が必要になった時
- 客先 demo 用途が出てきた時
- OSS 公開を検討する時

### Step 2-1: frontend/Dockerfile 作成

`frontend/Dockerfile` を新規作成。multi-stage ビルドで配布用 image をスリムに:

```dockerfile
# Stage 1: ビルド
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: 配布
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
```

**注意**: `frontend` の Vite ビルドが SPA 静的成果物を出す前提。ルーティング・環境変数まわりは要確認 (実コード参照)。

#### 成功確認
- [ ] `docker build -t harmony:local ./frontend` が成功
- [ ] `docker run --rm -p 5173:5173 harmony:local` で起動
- [ ] ブラウザで `http://localhost:5173` でデザイナー UI 表示

---

### Step 2-2: backend/Dockerfile 作成

`backend/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 5179
CMD ["node", "dist/index.js"]
```

**注意**:
- ビルドコマンド (`npm run build`) と起動エントリ (`dist/index.js`) は実 package.json に合わせる
- WebSocket と HTTP MCP が同 port 5179 に同居している前提

#### 成功確認
- [ ] `docker build -t harmony-backend:local ./backend` が成功
- [ ] image サイズが妥当 (~200-400MB)

---

### Step 2-3: docker-compose.yml (配布用)

リポジトリルートに `docker-compose.yml`:

```yaml
services:
  frontend:
    image: ghcr.io/<org>/harmony:latest
    ports:
      - "5173:5173"
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    image: ghcr.io/<org>/harmony-backend:latest
    ports:
      - "5179:5179"
    volumes:
      - ./workspaces:/app/workspaces
      - ./data:/app/data
      - ./examples:/app/examples:ro
    environment:
      NODE_ENV: production
    restart: unless-stopped
```

`<org>` は実際の GitHub org 名に置換する。

#### 成功確認
- [ ] `docker compose config` で構文エラーなし
- [ ] `docker compose up` で両サービス起動 (image を local に書き換えて事前テスト)
- [ ] ブラウザでデザイナー動作 OK
- [ ] `./workspaces/` にホスト側ファイルが書き込まれる

---

### Step 2-4: docker-compose.dev.yml (任意、メンテナ Docker dev 用)

通常メンテナは WSL2 native で開発するが、Docker でも開発できる状態を用意したい場合のみ:

```yaml
services:
  frontend:
    image: node:20-alpine
    working_dir: /app
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
    ports: ["5173:5173"]
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      VITE_HOST: 0.0.0.0

  backend:
    image: node:20-alpine
    working_dir: /app
    command: sh -c "npm install && npm run dev"
    ports: ["5179:5179"]
    volumes:
      - ./backend:/app
      - /app/node_modules
      - ./workspaces:/workspaces
      - ./data:/data
      - ./examples:/examples
```

使い方: `docker compose -f docker-compose.dev.yml up`

#### 成功確認
- [ ] (任意) Docker dev でも HMR が動作する
- [ ] (任意) ホスト側ソース変更がブラウザに反映される

---

### Step 2-5: ローカルビルド + 統合テスト

local image で compose 動作確認:

```bash
cd ~/projects/harmony

# build
docker build -t harmony:local ./frontend
docker build -t harmony-backend:local ./backend

# compose の image 名を一時的に local に書き換えてテスト
# (sed でも手動でも)
docker compose up

# 動作確認後 Ctrl+C で停止
docker compose down
```

#### 成功確認
- [ ] 両 image build 成功 (warning のみ許容、error はゼロ)
- [ ] `docker compose up` で両コンテナ起動
- [ ] ブラウザでデザイナー操作可
- [ ] AI エージェントから MCP 接続可 (Claude Code 等)
- [ ] `workspaces/` 永続化動作

---

### Step 2-6: GitHub Container Registry に push

```bash
# GitHub Token (write:packages 権限) で認証
echo $GITHUB_TOKEN | docker login ghcr.io -u <username> --password-stdin

# tag 付け
docker tag harmony:local ghcr.io/<org>/harmony:0.1.0
docker tag harmony:local ghcr.io/<org>/harmony:latest
docker tag harmony-backend:local ghcr.io/<org>/harmony-backend:0.1.0
docker tag harmony-backend:local ghcr.io/<org>/harmony-backend:latest

# push
docker push ghcr.io/<org>/harmony:0.1.0
docker push ghcr.io/<org>/harmony:latest
docker push ghcr.io/<org>/harmony-backend:0.1.0
docker push ghcr.io/<org>/harmony-backend:latest
```

GitHub の Packages タブで image が公開されたか確認。private/public 設定も適切に。

#### 成功確認
- [ ] `docker pull ghcr.io/<org>/harmony:0.1.0` が別環境で成功
- [ ] GitHub の Package ページで image が見える

---

### Step 2-7: README に利用手順を追加

`README.md` または `docs/installation.md` に Docker 利用手順を追加:

```markdown
## Docker での起動

任意のディレクトリで:

\`\`\`bash
mkdir my-design-project && cd my-design-project
curl -O https://raw.githubusercontent.com/<org>/harmony/main/docker-compose.yml
docker compose up
\`\`\`

ブラウザで http://localhost:5173 を開く。
JSON 仕様は ./workspaces/ 配下に保存される。
```

#### 成功確認
- [ ] README から Docker 利用方法に到達できる
- [ ] 別マシン (or 別 WSL2 distro) で手順通りに起動成功

---

### Step 2-8: CI でリリース時 image build を自動化 (任意)

GitHub Actions で git tag push 時に image build → ghcr.io push を自動化。`.github/workflows/release.yml` 等に追加。詳細は別途 CI 設計を行う。

#### 成功確認
- [ ] tag push で workflow が走る
- [ ] ghcr.io に新バージョン image が push される

---

### Phase 2 完了

- [ ] `frontend/Dockerfile` commit 済み
- [ ] `backend/Dockerfile` commit 済み
- [ ] `docker-compose.yml` commit 済み
- [ ] ghcr.io に image 公開済み
- [ ] README に利用手順記載済み
- [ ] 別環境で `docker compose up` のみで起動できることを確認済み

---

## トラブルシューティング

### Phase 1 関連

| 症状 | 原因 / 対処 |
|---|---|
| `docker` コマンドが WSL2 で `command not found` | Docker Desktop の Settings → Resources → WSL Integration で Ubuntu が ON になっているか確認 |
| `npm install` が異様に遅い (5 分以上) | ソースが `/mnt/c/...` 配下にある可能性。WSL2 native パス (`~/projects/...`) に移動する |
| Vite HMR が反応しない | `/mnt/c/...` 配下、または file watcher 上限。WSL2 native パスへ移動 + `cat /proc/sys/fs/inotify/max_user_watches` 確認 |
| `git push` で permission denied | SSH 鍵未登録 or `~/.ssh/` 権限不正。`chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_*` |
| MCP に Claude Code が繋がらない | backend が起動しているか / ポート 5179 が空いているか (`lsof -iTCP:5179`) |
| WSL2 がメモリ食いすぎ | `C:\Users\<user>\.wslconfig` に `[wsl2]` `memory=12GB` を追記、`wsl --shutdown` で再起動 |
| ブラウザで `localhost:5173` が見えない | WSL2 の port forwarding 確認 (`.wslconfig` の `localhostForwarding=true`)、Windows Firewall 確認 |

### Phase 2 関連

| 症状 | 原因 / 対処 |
|---|---|
| Docker build で permission denied | `node_modules` が bind mount に巻き込まれている → named volume で隔離 (compose の `- /app/node_modules`) |
| compose up しても画面が出ない | Phase 1 の native dev が同時起動していてポート競合。両方は同時起動できない |
| volume mount したファイルの権限おかしい | コンテナの user UID とホスト UID 不一致。Dockerfile に `USER node` 等を追加 or 起動時に `--user` 指定 |
| ghcr.io への push が 401 | GitHub token に `write:packages` スコープが必要 |

---

## 関連ドキュメント

- [`AGENTS.md`](../../AGENTS.md) — プロジェクト全般のガイダンス
- [`CLAUDE.md`](../../CLAUDE.md) — Claude Code 固有の設定
- [`docs/spec/workspace.md`](../spec/workspace.md) — ワークスペース仕様
- [`docs/spec/edit-session-draft.md`](../spec/edit-session-draft.md) — サーバ側 draft 管理モデル

---

## 改訂履歴

| 日付 | 改訂内容 |
|---|---|
| 2026-05-06 | 初版作成 |
