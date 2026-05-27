# WSL2 native セットアップ手順 (代替パターン)

Harmony 本体を **WSL2 native** で開発する手順書。Windows native から WSL2 へソースを移し、I/O / file watcher / AI エージェントを native 速度で動かす構成。

> 💡 **推奨は Dev Containers です** ([`dev-containers.md`](./dev-containers.md))。本書は以下の場合の代替セットアップ手順です:
> - Docker Desktop を使えない / 使いたくない環境
> - 既に WSL2 native で動かしており Dev Containers に移行する必要がない場合
> - 環境のクセを完全に把握したい場合
>
> Harmony 本体は WSL2 native でも **実質サポート** されており、`.mcp.json` の URL モード経由で AI エージェントから接続できる構成は両環境で共通です。新規 onboarding には Dev Containers の方が短時間で完成しますが、本書のセットアップ経路も valid です。

Docker image としての Harmony 配布 (将来構想) は本書ではなく [`distribution-roadmap.md`](./distribution-roadmap.md) を参照してください。

---

## AI エージェント (Claude Code 等) への指示

このドキュメントを参照して step-by-step で実行する場合、必ず以下を守ること。

1. **1 ステップずつ実行**。複数 Step を一括実行しない。
2. 各 Step の **「成功確認」** セクションを満たしてから次へ進む。満たさない場合はユーザーに報告して指示を仰ぐ。
3. 失敗・想定外の出力があれば**ユーザーに報告して指示を仰ぐ** (自己判断で進めない、特に削除系)。
4. 既存の Windows 側 `C:\projects\html-designer\` は **絶対に削除しない**。移行完了後の保険として保持する。
5. WSL2 シェル内のコマンド実行を前提とする。`Bash` ツール使用時は WSL2 内で動作するか確認すること。
6. ユーザー名 / org 名等のプレースホルダ (`<user>` / `<org>` / `<username>`) は実値に置換が必要。不明ならユーザーに確認する。
7. 各 Step の所要目安: 5〜15 分。長くかかる場合は途中報告。

---

## 移行前後の構成

### 移行前 (Windows native)

```
Windows
├── C:\projects\html-designer\        ← 現在の作業ディレクトリ
├── C:\Users\csilo\.claude\           ← Claude Code 設定 / memory
└── Node.js (Windows native install)
```

### WSL2 native 完成時

```
WSL2 (Ubuntu)
├── /home/<user>/projects/harmony/   ← 新しい作業ディレクトリ
├── /home/<user>/.claude/            ← Claude Code 設定 (新規 or 移行)
└── nvm + Node.js 20

Windows
├── C:\projects\html-designer\        ← 退役 (削除しない、参照専用)
├── VSCode (UI のみ、Remote-WSL で接続)
└── Docker Desktop (任意、Dev Containers と併用する場合)
```

---

## Step 1-0: 前提条件チェック

WSL2 (+ 任意で Docker Desktop) が基本セットアップ済みかチェックする。

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
- Docker Desktop (任意): 公式サイトからインストールし、Settings → Resources → WSL Integration → Ubuntu を ON

#### 成功確認
- [ ] `wsl --status` が `WSL のバージョン: 2` を含む
- [ ] `wsl -l -v` の出力に `Ubuntu` が含まれる
- [ ] WSL2 シェルが起動できる (PowerShell で `wsl` 実行で bash プロンプト)

---

## Step 1-1: WSL2 内基本ツール確認・インストール

WSL2 (Ubuntu) シェルで実行。

**チェック**:

```bash
echo "=== WSL2 Tools Check ==="
echo "Node:    $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "npm:     $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "git:     $(git --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "gh:      $(gh --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
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
- [ ] `git --version`, `gh --version` が表示される
- [ ] `ssh -T git@github.com` で `Hi <username>!` が表示される
- [ ] `gh auth status` で `Logged in to github.com` 表示

---

## Step 1-2: harmony を WSL2 に clone

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

## Step 1-3: 依存パッケージインストール

```bash
cd ~/projects/harmony

# .nvmrc があれば使用
[ -f .nvmrc ] && nvm use

# root で 1 回実行 — npm workspaces (shared / frontend / backend) を一括解決
# shared/package.json の `prepare` hook で shared/dist/ を build
npm install
```

PR #1378 (#1375) で npm workspaces 化済み。`cd frontend && npm install` / `cd backend && npm install` の個別実行は **非推奨** (workspace 認識されず `@harmony/shared` の resolution で失敗する場合あり)。

**所要時間**: 2〜5 分 (WSL2 native、Windows 側で同操作した時より大幅に速い)。

#### 成功確認
- [ ] `node_modules/` (root) が存在
- [ ] `frontend/node_modules/` / `backend/node_modules/` / `shared/node_modules/` が存在 (workspaces により hoist + 各 subdir に必要 link)
- [ ] `shared/dist/` が存在 (`prepare` hook で build 済)
- [ ] `npm install` が exit code 0 で終了 (deprecation 警告は許容)

---

## Step 1-4: backend 起動確認

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

## Step 1-5: frontend 起動確認

別の WSL2 タブ (ターミナル 2) で。Step 1-4 のターミナルは残したまま。

```bash
cd ~/projects/harmony/frontend
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

## Step 1-6: VSCode を Remote-WSL に切替

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

## Step 1-7: Claude Code を WSL2 側にインストール

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

## Step 1-8: Claude Code memory / 設定の引き継ぎ (任意)

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

## Step 1-9: WSL2 native セットアップ完了総合テスト

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

#### 完了

ここまで全て OK なら WSL2 native セットアップ完了。

**運用安定化期間**: 1〜2 週間ほど WSL2 環境で運用し、問題が出ないことを確認する。問題が出たら一時的に Windows 側 (`C:\projects\html-designer\`) に戻れる状態を維持。

**退役判断**: 1〜2 週間運用して安定したら、Windows 側を archive 化または削除。
- archive 化: `Move-Item C:\projects\harmony C:\projects\_archived\harmony-windows-2026-XX-XX`
- 完全削除: 慎重に。git push 漏れがないことを WSL2 側と diff チェックしてから

---

## Dev Containers への切替を検討する目安

WSL2 native で安定運用に入った後、以下のいずれかに該当する時は Dev Containers への切替を検討:

- 複数プロジェクトを WSL2 上で開発し、Node / JDK / Python のバージョン衝突が発生
- B チーム / OSS contributor に dev 環境を配布する必要が出てきた
- 新規開発者の onboarding を短縮したい
- WSL2 distro の汚れ (~/.npm / ~/.cache / 各種 SDK) を整理したい

切替手順は [`dev-containers.md`](./dev-containers.md) §「WSL2 native ユーザー向け移行手順」を参照。後戻りも `Dev Containers: Reopen Folder Locally` で即可能、両モード併用も可。

該当しないなら WSL2 native のままで問題なし。

---

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| `npm install` が異様に遅い (5 分以上) | ソースが `/mnt/c/...` 配下にある可能性。WSL2 native パス (`~/projects/...`) に移動する |
| Vite HMR が反応しない | `/mnt/c/...` 配下、または file watcher 上限。WSL2 native パスへ移動 + `cat /proc/sys/fs/inotify/max_user_watches` 確認 |
| `git push` で permission denied | SSH 鍵未登録 or `~/.ssh/` 権限不正。`chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_*` |
| MCP に Claude Code が繋がらない | backend が起動しているか / ポート 5179 が空いているか (`lsof -iTCP:5179`) |
| WSL2 がメモリ食いすぎ | `C:\Users\<user>\.wslconfig` に `[wsl2]` `memory=12GB` を追記、`wsl --shutdown` で再起動 |
| ブラウザで `localhost:5173` が見えない | WSL2 の port forwarding 確認 (`.wslconfig` の `localhostForwarding=true`)、Windows Firewall 確認 |

---

## 関連ドキュメント

- [`AGENTS.md`](../../AGENTS.md) — プロジェクト全般のガイダンス
- [`CLAUDE.md`](../../CLAUDE.md) — Claude Code 固有の設定
- [`dev-containers.md`](./dev-containers.md) — 開発環境 (推奨)
- [`distribution-roadmap.md`](./distribution-roadmap.md) — Harmony 本体の Docker image 配布構想
- [`docs/spec/workspace.md`](../spec/workspace.md) — ワークスペース仕様
- [`docs/spec/edit-session-draft.md`](../spec/edit-session-draft.md) — サーバ側 draft 管理モデル

---

## 改訂履歴

| 日付 | 改訂内容 |
|---|---|
| 2026-05-06 | 初版 (旧 `wsl2-docker-migration.md`) |
| 2026-05-15 | `wsl2-native.md` にリネーム + 「Phase」用語廃止 + Phase 1.5 セクション削除 + Phase 2 部分を [`distribution-roadmap.md`](./distribution-roadmap.md) に分離 + 「Dev Containers が推奨、本書は代替」の navigation banner 追加 (#1109) |
