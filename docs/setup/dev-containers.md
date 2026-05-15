# Dev Containers セットアップ (推奨)

VSCode Dev Containers 拡張で Harmony を開発する手順書。**本プロジェクトの推奨開発環境**。

WSL2 native のみのセットアップも引き続きサポート対象です ([`wsl2-native.md`](./wsl2-native.md))。Harmony 本体を Docker image として配布する将来構想は [`distribution-roadmap.md`](./distribution-roadmap.md) を参照。

## なぜ Dev Containers が推奨か

- **複数プロジェクト共存**: 1 つの WSL2 に Node / Java / Python が混在しても、プロジェクト間で完全 isolation
- **JDK / Node バージョンのプロジェクト別固定**: `devcontainer.json` の宣言で再現可
- **onboarding コスト**: 新規開発者 / 他チーム / OSS contributor は `git clone && Reopen in Container` だけで dev 環境完成
- **WSL2 distro を汚さない**: Node / npm / playwright browsers / 各種 CLI はすべて container 内、ホスト WSL2 は git + docker クライアントだけで足りる

すでに WSL2 native で安定運用していて移行する必要がない場合は、そのまま使い続けて問題ありません ([`wsl2-native.md`](./wsl2-native.md) 経路もサポート対象)。

## 前提条件

- **Windows 11 + WSL2** (Ubuntu 推奨)
- **Docker Desktop** (Settings → Resources → WSL Integration → Ubuntu ON)
  - または WSL2 内 Docker Engine (Docker Desktop ライセンスを避けたい場合)
- **VSCode** + **Dev Containers 拡張** (`ms-vscode-remote.remote-containers`)

WSL2 + Ubuntu + Node 等の基本セットアップが未完了の場合は [`wsl2-native.md`](./wsl2-native.md) Step 1-0〜1-1 を共通の前提セットアップとして参照してください (本書の手順は Docker Desktop と VSCode Dev Containers 拡張が入っていることのみを前提とします)。

## Quick Start (新規 / fresh clone)

```bash
# WSL2 シェルで
cd ~/projects
git clone git@github.com:csilost2001/harmony.git
cd harmony

# VSCode 起動 (Remote-WSL で開く)
code .
```

`csilost2001/harmony` は本リポジトリの canonical 出典。fork して作業する場合は自分の fork URL に置き換えてください。

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

## 初回起動で WSL2 host 側に何が作られるか

Reopen in Container を実行すると、以下が自動で WSL2 host 側に作られます。**利用者の事前準備は不要**です (Docker bind mount が missing path を自動 mkdir する仕様):

```
~/.agent-containers/                       ← AI agent 用データ root
└── harmony/                               ← project 名で自動分離 (${localWorkspaceFolderBasename})
    ├── .claude/                           ← Claude Code: sessions / settings / memory / .credentials.json / .config.json
    ├── .codex/                            ← Codex CLI: auth.json / config.toml / sessions
    ├── .copilot/                          ← Copilot CLI: session-state / command-history-state.json / memory (#1114)
    └── .harmony/                          ← Harmony 本体: recent-workspaces.json
```

これらは bind mount で container 内 `/home/node/.{claude,codex,copilot,harmony}/` と双方向同期され、**rebuild しても永続化されます**。backup したい場合は通常の `cp -r` / `rsync` / `git` で WSL2 host から直接触れます。

> ⚠️ **WSL2 host の `~/.claude/` (= WSL2 native claude 用) は本構成では一切触りません**。`~/.agent-containers/<project>/` という別名前空間にすることで、WSL2 native claude と container claude を**同時稼働させても干渉しません**。詳細は本書「AI CLI の扱い」節を参照。

別の project (例: `other-app`) を Dev Container で開けば自動で `~/.agent-containers/other-app/` 配下が作られます。

## 初回起動時に必要な手作業 (一度だけ)

container 起動後、以下の認証作業を 1 度だけ行います (rebuild 跨ぎで永続化されるため 2 度目以降は不要):

1. **Claude Code OAuth**: container 内ターミナルで
   ```bash
   claude /login
   ```
   ブラウザで OAuth を完遂すると `.credentials.json` が `~/.agent-containers/<project>/.claude/` に書き込まれる (`refreshToken` で 60〜90 日は自動更新)。
2. **Codex CLI OAuth**:
   ```bash
   codex login
   ```
   同様に `~/.agent-containers/<project>/.codex/auth.json` に保存される。
3. **GitHub Copilot CLI**: 認証は `gh auth` (= `~/.config/gh/`) を共有するため、host で `gh auth login` 済みなら追加 OAuth 不要。Copilot CLI が初回起動時に必要な権限を付与するよう促す場合あり。session / memory / history は `~/.agent-containers/<project>/.copilot/` に永続化される (#1114)。
4. **(任意) 個人 alias (`ccd` / `cdx` 等)**: VS Code user settings.json に dotfiles 3 行を追加。詳細は本書「個人 alias」節を参照。

OAuth が必要なのは初回 + refreshToken expire 後 (60〜90 日) のみ。日々の rebuild では認証は維持されます。

## 過去 WSL2 native だった人向け移行手順

すでに [`wsl2-native.md`](./wsl2-native.md) の手順で WSL2 native 開発をしている場合の移行ステップ。**WSL2 native のままでも問題ない**ため、以下の利点を求める場合のみ移行を検討してください:

- 複数プロジェクトを WSL2 上で開発し、Node / JDK / Python のバージョン衝突が発生
- B チーム / OSS contributor に dev 環境を配布する必要が出てきた
- 新規開発者の onboarding を短縮したい
- WSL2 distro の汚れ (~/.npm / ~/.cache / 各種 SDK) を整理したい

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

## 両モード併用 (任意)

`.devcontainer/` が repo にあっても、WSL2 native セットアップは引き続き動作します。以下のように使い分けることも可能:

- WSL2 native の `cd backend && npm run dev` は引き続き動く
- `~/.claude/`, `~/.gitconfig`, `~/.ssh/` は WSL2 native のものをそのまま使う (Remote-WSL モード時)
- VSCode で開く時に **WSL モードか Container モードを選択** できる

| モード | 起動方法 | source の場所 | tools の場所 |
|---|---|---|---|
| WSL2 native | `code .` → Remote-WSL | WSL2 ext4 | WSL2 distro 内 (nvm / Node) |
| Dev Container | `code .` → Reopen in Container | WSL2 ext4 (bind mount) | container 内 (image + features) |

`/workspaces/harmony` (container 内 path) と `~/projects/harmony` (WSL2 path) は **同じ実体** (bind mount) なので、片方で編集したファイルはもう片方からも見える。同時起動はポート競合するので避ける。

## AI CLI (Claude Code / Codex) の扱い

> [!IMPORTANT]
> **DevContainers + Claude Code は世界的にハマりやすい組合せ**。Anthropic 公式 docs だけでは「rebuild の度に wizard / re-login が要求される」「Remote Control が動かない」等の罠を踏む。本 repo は **#1097 でこれらを完全解消した構成** を採用しているため、**本節の内容を変更しないでください**。変更が必要な場合は #1097 と本 doc 末尾の改訂履歴を読んでから検討する。

### TL;DR — 本環境の構成 (要点)

| 項目 | 採用構成 | 落とし穴 |
|---|---|---|
| Claude Code install | 公式 feature `ghcr.io/anthropics/devcontainer-features/claude-code:1.0` | feature 経由なら毎 rebuild で最新が入る。Auto-update は `DISABLE_AUTOUPDATER=1` で container 起動後の上書き禁止 |
| `~/.claude/` 永続化 | host bind mount: `~/.agent-containers/<project>/.claude/` ↔ container `/home/node/.claude/` | host の `~/.claude/` を直接 mount すると WSL2 native claude と statsig 等で write 競合 → **必ず別名前空間** (`~/.agent-containers/`) を使う |
| `~/.claude.json` (state file) | volume 外 → wizard 毎回発火する問題 | **`~/.claude/.config.json` を空 `{}` で先に作成しておくと claude が state file の保存先を `.config.json` に切替える** (undocumented、Claude 2.x で動作確認) |
| 認証 token | container 内で 1 度 `claude /login` (ブラウザ OAuth) → `~/.agent-containers/<project>/.claude/.credentials.json` に永続化、`refreshToken` で 60〜90 日は自動更新 | `CLAUDE_CODE_OAUTH_TOKEN` env var は **inference scope only / Remote Control 不可** で罠。本構成では使わない |
| `~/.codex/` 永続化 | 同じく host bind mount: `~/.agent-containers/<project>/.codex/` ↔ container `/home/node/.codex/` | codex は `~/.codex.json` のような `$HOME` 直下ファイルを持たないので `.config.json` workaround 不要 |
| `~/.copilot/` 永続化 | 同じく host bind mount: `~/.agent-containers/<project>/.copilot/` ↔ container `/home/node/.copilot/` | Copilot CLI 公式 default location ([cli-config-dir-reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference))、session-state + command-history-state.json + memory を保持。`COPILOT_HOME` env で上書き可だが本構成では default を使用 |
| `~/.harmony/` 永続化 | 同じく host bind mount: `~/.agent-containers/<project>/.harmony/` ↔ container `/home/node/.harmony/` | Harmony 本体の state file 用 |
| 個人 alias (ccd / cdx) | VS Code user 設定の `dotfiles.installCommand` (公式 dotfiles 機能) | `postAttachCommand` で install.sh を呼ぶハックは禁止 (lifecycle 違反) |

#### host 側ディレクトリ構造 (人間が触る場所)

```
~/.agent-containers/                    ← AI agent (claude / codex / copilot 等) container 用データ root
└── harmony/                            ← Harmony project の container 専用
    ├── .claude/                        ← Claude Code: sessions / settings / memory / .credentials.json / .config.json
    ├── .codex/                         ← Codex CLI: auth.json / config.toml / history / sessions
    ├── .copilot/                       ← Copilot CLI: session-state / command-history-state.json / memory (#1114)
    └── .harmony/                       ← Harmony 本体: recent-workspaces.json
```

別 project (例: `other-app`) を Dev Container で開くと自動で `~/.agent-containers/other-app/.claude/` 等が作られる (`${localWorkspaceFolderBasename}` 変数で project 名解決)。

**WSL2 host の `~/.claude/` (WSL2 native claude 用) は本構成では一切触らない** — 別名前空間にすることで WSL2 native claude と container claude を同時稼働しても data 破損しない。

### Claude Code

#### 1. CLI install: 公式 Dev Container Feature

`devcontainer.json` の `features` に Anthropic 提供の公式 feature を追加:

```jsonc
"features": {
  "ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}
}
```

container build 時に最新の Claude Code が自動 install される。

#### 2. 認証: `.credentials.json` を bind mount で永続化

container 内で 1 度 `claude` (もしくは `claude /login`) を起動して **ブラウザ OAuth を完遂**すると、`.credentials.json` が host の bind mount target (`~/.agent-containers/<project>/.claude/.credentials.json`) に書き込まれる。以降の rebuild では:
- container 内 claude が起動時に `.credentials.json` から OAuth token を読む
- token は `refreshToken` を含む完全な OAuth credential で、`user:sessions:claude_code` scope も含むため **Remote Control も動作する**
- token 期限が近づくと claude が自動 refresh する (refreshToken が valid な間は手作業不要)

`devcontainer.json`:

```jsonc
"containerEnv": {
  "DISABLE_AUTOUPDATER": "1"
}
```

`DISABLE_AUTOUPDATER: "1"` は公式推奨 (container 内で claude が自動更新で勝手にバージョン変わるのを防止)。

##### `CLAUDE_CODE_OAUTH_TOKEN` env var は **使わない**

`claude setup-token` で発行する 1 年トークンを env var で渡す方式 (公式 docs の「CI pipelines and scripts」向け) を以前試したが、**inference scope のみで Remote Control 不可** という制限がある (公式 docs に明記):

> This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. **It is scoped to inference only and cannot establish Remote Control sessions.**

env var (precedence 5) は `.credentials.json` (precedence 6) より優先されるため、env var を設定していると **Remote Control 用の full-scope token が無視される**。Remote Control を使う構成ではこの env var 方式を採用しない。

##### 完全 re-login の頻度

`refreshToken` の有効期限が切れた時のみ (典型的に 60〜90 日)、container 内で `claude /login` を再実行してブラウザ OAuth を通す必要あり。env var (1 年) と比べると頻度が高めだが、Remote Control 含む全機能が動く対価。

#### 3. データ永続化: host subdir bind mount + `.config.json` workaround

`~/.claude/` (sessions / settings / projects 配下の memory) を **WSL2 host の project 別 subdir に bind mount** する。Named Volume ではなく bind mount を選んだ理由は後述の比較表参照:

```jsonc
"mounts": [
  "source=${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.claude,target=/home/node/.claude,type=bind,consistency=cached",
  "source=${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.codex,target=/home/node/.codex,type=bind,consistency=cached",
  "source=${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.copilot,target=/home/node/.copilot,type=bind,consistency=cached",
  "source=${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.harmony,target=/home/node/.harmony,type=bind,consistency=cached"
]
```

- `${localEnv:HOME}` = WSL2 host の `~/` (例: `/home/hidekatsu`)
- `${localWorkspaceFolderBasename}` = project フォルダ名 (例: `harmony`) → 複数 project の自動分離
- 結果: host 側に `~/.agent-containers/harmony/.claude/`、`~/.agent-containers/harmony/.codex/`、`~/.agent-containers/harmony/.copilot/`、`~/.agent-containers/harmony/.harmony/` のディレクトリ群が作られ、container 内 `/home/node/.{claude,codex,copilot,harmony}/` と双方向同期される

**重要**: WSL2 host の `~/.claude/` (= WSL2 native claude の保管場所) は **触らない**。`~/.agent-containers/<project>/.claude/` という別の名前空間を使うことで、WSL2 native claude と container 内 claude を **同時稼働させても干渉しない** (host `~/.claude/` 直接 bind は同時稼働で statsig 等の write 競合が起きる、bcaccd7 → 235caeb で確認済)。

##### `~/.claude.json` 問題と `.config.json` workaround (継続)

bind mount でも **`~/.claude.json` ファイル (= `$HOME` 直下、`.claude/` の外) は mount 対象外** で、rebuild 毎に消える → `hasCompletedOnboarding` flag が消えて wizard が毎回発火する問題は残る。

**解決策 (undocumented だが claude binary に実装済の機能)**: `~/.claude/.config.json` (mount target 内) を存在させると、claude は **`~/.claude.json` の代わりに `~/.claude/.config.json` を state file として使う**。`postCreateCommand` で空ファイルを初期化:

```jsonc
"postCreateCommand": "... && ([ -f ~/.claude/.config.json ] || echo '{}' > ~/.claude/.config.json)"
```

挙動:
- 初回 rebuild: 空 `.config.json` が作られる → claude 起動 → wizard 発火 (`hasCompletedOnboarding` 未設定) → user が wizard 完了 → flag が `.config.json` に書かれる (host bind mount 内、永続)
- **2 回目以降の rebuild**: `.config.json` が host 側に残っている → flag を読んで wizard skip

出典: [Zenn — Dev Container で Claude Code を使う](https://zenn.dev/nstock/articles/2c1ea72861f87c)。公式 docs には未記載なので Anthropic アップデートで仕様変更の可能性ありだが、現状 (Claude Code 2.x) で動作確認済。

##### Named Volume vs host subdir bind mount の比較

| 観点 | Named Volume (旧構成) | host subdir bind mount (現構成) |
|---|---|---|
| データの所在 | Docker-managed (`/var/lib/docker/volumes/...`) | WSL2 host `~/.agent-containers/<project>/` |
| host から閲覧 | `docker run` 経由で見るしかない | 普通の `ls`/`cat`/`vi` 可能 |
| WSL2 native claude との競合 | なし (完全分離) | なし (host `~/.claude/` は触らない、別名前空間) |
| backup | `docker volume export` 等 | rsync / git / 通常手段 |
| `docker volume prune` で消える | はい (誤操作リスク) | いいえ (host filesystem) |
| project 自動分離 | `${devcontainerId}` (hash) | `${localWorkspaceFolderBasename}` (人間可読、`~/.agent-containers/<name>/`) |
| 公式 docs 推奨度 | ◎ named volume を例示 | △ 明示言及なし (host `~/.claude/` 直接 bind は warning ありだが本構成は別名前空間なので該当せず) |

bind mount に切り替えた狙い: **host から見えて backup / 障害復旧が楽**、`docker volume prune` で誤消失しない、`~/.agent-containers/<project>/` で人間可読な project 分離。

##### Named Volume からの migration (旧構成からの初回切替)

旧 `harmony-claude` / `harmony-codex` / `harmony-state` named volume を使っていた人は、bind mount 切替前に host へデータ移管する:

```bash
# host 側で受け入れ先作成 (UID は user で問題なし、node も UID 1000 想定)
mkdir -p ~/.agent-containers/harmony/.claude \
         ~/.agent-containers/harmony/.codex \
         ~/.agent-containers/harmony/.harmony

# Named Volume → host にコピー
docker run --rm -v harmony-claude:/src:ro -v ~/.agent-containers/harmony/.claude:/dst alpine sh -c 'cp -aT /src /dst'
docker run --rm -v harmony-codex:/src:ro  -v ~/.agent-containers/harmony/.codex:/dst  alpine sh -c 'cp -aT /src /dst'
docker run --rm -v harmony-state:/src:ro  -v ~/.agent-containers/harmony/.harmony:/dst alpine sh -c 'cp -aT /src /dst'

# 後で旧 volume が不要になったら (動作確認後)
# docker volume rm harmony-claude harmony-codex harmony-state
```

- rebuild しても host 側のデータは container 破棄に影響されない
- WSL2 host の `~/.claude/` とは独立 (memory / sessions は WSL2 native claude と container claude で別々に育つ。公式が明確に「machine-local、cross-machine 共有非対応」と宣言: [Memory docs](https://code.claude.com/docs/en/memory))

### Codex CLI

公式 Dev Container Feature が存在しないため、引き続き `postCreateCommand` で `npm install -g @openai/codex` を実施。auth は `~/.codex/auth.json` (= host bind mount target `~/.agent-containers/<project>/.codex/auth.json`) に格納されるため、container 内で 1 度 `codex login` するだけで rebuild 跨ぎで保持される。codex は `~/.codex.json` のような `$HOME` 直下のファイルを持たないので claude のような `.config.json` workaround は不要。

### 認証フロー全体図

```
host (WSL2)                              container (Dev Container)
─────────────────────────                ──────────────────────────
~/.claude/                               /home/node/.claude/
  .credentials.json (host claude)        (bind mount from host
                                          ~/.agent-containers/<project>/.claude/)
                                          ↓
                                         .credentials.json (container claude)
WSL2 native claude が読む                 container 内 claude が読む
  ↓                                       ↓
独立した OAuth credential (各環境別、memory / sessions も別保管)
```

host と container は **別 OAuth credential で独立**動作。それぞれの環境で初回 `/login` が必要だが、`.credentials.json` の `refreshToken` で 60〜90 日は自動更新される。WSL2 native claude と container claude を **同時稼働させても干渉しない** (別ディレクトリのため)。

### 個人 alias (ccd / cdx 等): VS Code 公式 dotfiles 機能

[VS Code Dev Containers Personalizing 公式](https://code.visualstudio.com/docs/devcontainers/containers) の dotfiles 機能を使う。**user 側 1 回限りの setup** として、VS Code user settings.json (Ctrl+, → 右上アイコン → "Open Settings (JSON)") に 3 行追加:

```json
{
  "dotfiles.repository": "<your-github-id>/dotfiles",
  "dotfiles.targetPath": "~/dotfiles",
  "dotfiles.installCommand": "install.sh"
}
```

これで VS Code が **rebuild 毎に自動で**:
1. dotfiles repo を `~/dotfiles/` に clone
2. `~/dotfiles/install.sh` を実行 (各自の dotfiles repo に置く)

`install.sh` は `ln -sfn ~/dotfiles/.bash_aliases ~/.bash_aliases` 等の idempotent symlink installer を想定。base image の `~/.bashrc` には標準で `[ -f ~/.bash_aliases ] && . ~/.bash_aliases` が含まれているため、symlink さえ作れば alias は次のシェル起動時から効く (**既に開いている terminal は新規開き直す必要あり**)。

参考実装: [`csilost2001/dotfiles`](https://github.com/csilost2001/dotfiles) (`ccd` / `cdx` 例)。

### バージョン更新

- **Claude Code**: 公式 feature の version tag (`:1.0`) は install script の version であり Claude Code 自体ではない。Claude Code 自体は feature が **常に最新** を install する。`DISABLE_AUTOUPDATER: "1"` を入れているので **container 起動後の自動更新は止まる** が、**rebuild 時の初回 install は最新版** になる。安定運用したい場合は公式 docs の [Pin a specific version](https://code.claude.com/docs/en/devcontainer#enforce-organization-policy) に従い、feature の代わりに Dockerfile で `npm install -g @anthropic-ai/claude-code@X.Y.Z` で pin する手もあり (Harmony は現状 feature 採用)。
- **Codex**: container 内で `npm install -g @openai/codex@<version>` で個別更新。

## 仕組み解説: devcontainer.json の構造 (#1118 Phase 1+2 以降)

```
ghcr.io/csilost2001/harmony-devcontainer-base:<version>  ← Phase 2 で確立した base
  ├── mcr.microsoft.com/devcontainers/typescript-node:20-trixie
  └── Playwright + Chromium + apt deps (稀更新、~285 MiB)
                  ↓ FROM
.devcontainer/Dockerfile (overlay)
  └── @openai/codex@<version> (頻繁更新、月単位)
                  ↓
Dev Containers が features を適用
  └── github-cli / claude-code / copilot-cli
                  ↓
container 起動 → onCreate → postCreate (npm install + .config.json)
```

| 要素 | 役割 | Harmony での設定 |
|---|---|---|
| `build` | overlay Dockerfile を build | `.devcontainer/Dockerfile` (FROM = ghcr.io の base image) |
| base image | 稀更新の重い install を内包 | `ghcr.io/csilost2001/harmony-devcontainer-base:<version>` (#1118 Phase 2) |
| `features` | ツール後付け (宣言的) | `github-cli` / `claude-code` / `copilot-cli` |
| `postCreateCommand` | プロジェクト固有 setup | `npm install` (frontend + backend) + `.claude/.config.json` 初期化のみ (軽量) |

「重い + 共通」→ base image (ghcr) / 「軽い + バージョン違い」→ features / 「source 依存」→ postCreateCommand、という指針。

Phase 0 (postCreate やめて Dockerfile 化) で warm rebuild 56→15 秒 (Ryzen) / 94→21 秒 (Note PC)、Phase 1 (base + overlay 階層化) で codex 更新時の base 再 build 回避、Phase 2 (ghcr 配布) で新規開発者の cold start を大幅短縮 (Playwright DL 不要)。

詳細: ISSUE [#1118](https://github.com/csilost2001/harmony/issues/1118) / [`distribution-roadmap.md`](./distribution-roadmap.md)。

## Maintainer: base image の更新と publish (#1118 Phase 2)

base image (`ghcr.io/csilost2001/harmony-devcontainer-base:<version>`) を更新するのは maintainer のみ。**頻度は数ヶ月に 1 回程度** (Playwright メジャー / マイナー更新、Node メジャー更新、Debian release 切替時)。

> **本セクションは maintainer 限定**。通常の Harmony 開発者・利用者は読まなくて良い。Phase 3 完了後は `/publish-dev-image` AI skill 経由で本手順を実行できる予定。

### 初回セットアップ (1 回だけ)

1. **GitHub PAT 発行** — https://github.com/settings/tokens/new
   - Note: `harmony-devcontainer-ghcr` (任意)
   - Expiration: 90 days 推奨
   - Scope: **`write:packages`** にチェック (`read:packages` も自動付与)
   - **Generate token** 押下 → `ghp_xxxxxxxx...` 文字列をコピー (このページを離れると二度と見られない)

2. **WSL2 ターミナルで Docker login** (Dev Container 内ではなく **host 側**で実行):
   ```bash
   docker login ghcr.io -u <github-username>
   # Password に上記 PAT を貼り付け → "Login Succeeded"
   ```
   → `~/.docker/config.json` に credential が保存され、以降の `docker push` で再認証不要。

### 更新手順 (毎回)

1. `.devcontainer/base/Dockerfile` を編集 (Playwright version 更新等)
2. WSL2 ターミナルで publish:
   ```bash
   bash .devcontainer/scripts/publish-dev-image.sh <new-version>
   # 例: bash .devcontainer/scripts/publish-dev-image.sh 0.2
   ```
   → `ghcr.io/csilost2001/harmony-devcontainer-base:<new-version>` が push される (数分)
3. **初回 push 後 1 回だけ**、image を public 設定にする:
   - URL: https://github.com/users/csilost2001/packages/container/harmony-devcontainer-base/settings
   - **Danger Zone** → **Change package visibility** → **Public**
   - これをやらないと、他の利用者が pull する時に認証が必要になる
4. `.devcontainer/Dockerfile` の FROM 行を新 version に更新:
   ```dockerfile
   FROM ghcr.io/csilost2001/harmony-devcontainer-base:<new-version>
   ```
5. commit + push
6. (任意) Rebuild Container で動作確認 — 初回は ghcr.io から pull (~30 秒)

### Fork ユーザ向け

`HARMONY_GHCR_USER` 環境変数で自 GitHub username に上書き可能:

```bash
HARMONY_GHCR_USER=myusername bash .devcontainer/scripts/publish-dev-image.sh 0.1
```

(Fork した場合は `.devcontainer/Dockerfile` の FROM も自 ghcr URL に置換が必要)

### Local 動作確認用 (ghcr に push しない)

`.devcontainer/scripts/build-base.sh` で local build のみ:

```bash
bash .devcontainer/scripts/build-base.sh
# → harmony-devcontainer-base:local タグの image が local に作られる
# overlay FROM を一時的に :local に書き換えて Rebuild すればテスト可
```

通常は publish-dev-image.sh が build + push まで一気にやるので不要。push 前の dry-run 用。

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
| container が起動するが永続化が消える | host subdir bind mount が正しく動いていない。`ls ~/.agent-containers/<project>/.claude/` で host 側にファイルがあるか確認。空なら旧 Named Volume からの migration 未完了の可能性 — 本 doc「Named Volume からの migration」節参照。VSCode `Dev Containers: Show Container Log` で mount エラーも確認 |
| rebuild の度に Claude が wizard を要求する | `~/.agent-containers/<project>/.claude/.config.json` が host に無い (postCreateCommand 未実行/失敗) → 本 doc「3. データ永続化」節を参照 |
| Claude が `/login` を要求する (`.credentials.json` あるのに) | refreshToken が expire (典型 60〜90 日) → container 内で `claude /login` を再実行してブラウザ OAuth |
| Remote Control failed to connect: Session creation failed | 過去の構成で `CLAUDE_CODE_OAUTH_TOKEN` env var が残っているか確認: `echo $CLAUDE_CODE_OAUTH_TOKEN` (container 内)。本構成では `devcontainer.json` の `containerEnv` から削除済みだが、user 個人の `.bashrc` 等で設定していると container にも漏れる可能性。env var はクリアして rebuild |
| rebuild の度に `ccd` / `cdx` 等の個人 alias が消える | VS Code user settings.json に `dotfiles.repository` / `dotfiles.installCommand` の 3 行が未設定。本 doc「個人 alias: VS Code 公式 dotfiles 機能」節を参照 |
| Docker Desktop ライセンスを使いたくない | rootless Docker (`apt install docker.io` を WSL2 内) でも動作。ただし Windows ホストからの port forward に追加設定要 |

## CI 連携 (将来)

Dev Containers の image を CI でも使うと、ローカル / CI 完全一致が達成できる。本リポジトリは現状 CI 未導入だが、将来的に検討する場合は [`@devcontainers/cli`](https://github.com/devcontainers/cli) を CI で使い、image build + 内部コマンド実行をスクリプト化できる。

## `/generate-code` 出力アプリへの同梱 (#1048)

本 doc は **Harmony 本体** (Harnize Harmony 自身の開発環境) の Dev Containers 設定について解説する。

`/generate-code` skill が出力する**業務アプリ**には、同じ思想 (pre-build しない、MS 公式 base image + features 構成) で `.devcontainer/devcontainer.json` + `Dockerfile` + `docker-compose.yml` を同梱する (#1048)。techStack 4 組合せ (spring-boot × thymeleaf / nextjs、nestjs × thymeleaf / nextjs) のテンプレが `.claude/skills/generate-code/templates/devcontainer/` 配下に配置されており、`/generate-code` 実行時に techStack を判定して該当テンプレをコピー出力する。詳細は [`SKILL.md` Step 5.5](../../.claude/skills/generate-code/SKILL.md) を参照。

**`<出力先>` の運用想定**: `/generate-code <id> <出力先>` の `<出力先>` は **業務アプリ project root** を指す (project-root model)。Harmony 利用者は意味のある folder 名 (例: `~/projects/retail-app/`) を独立した project root として作り、それを `<出力先>` に指定して VS Code / Dev Container で開く。`examples/<id>/generated/<techStack>/` は Harmony 同梱サンプル / dogfood 参照物であり、常用の project root として開く運用は想定しない (`${localWorkspaceFolderBasename}` が `generated` で衝突するため)。詳細は [`SKILL.md` Step 5.5](../../.claude/skills/generate-code/SKILL.md) の「出力先の運用想定 (project-root model)」を参照。設定駆動 (`harmony.json` の `outputDir` 等) は [#1116](https://github.com/csilost2001/harmony/issues/1116) で検討中。

## 関連ドキュメント

- [`AGENTS.md`](../../AGENTS.md) — プロジェクト全般のガイダンス
- [`CLAUDE.md`](../../CLAUDE.md) — Claude Code 固有
- [`wsl2-native.md`](./wsl2-native.md) — WSL2 native セットアップ手順 (代替パターン)
- [`distribution-roadmap.md`](./distribution-roadmap.md) — Harmony 本体の Docker image 配布構想 (#1055 L2/L3)
- ISSUE [#847](https://github.com/csilost2001/harmony/issues/847) — Dev Containers 移行 roadmap
- ISSUE [#1048](https://github.com/csilost2001/harmony/issues/1048) — `/generate-code` 出力アプリへの Dev Containers 同梱 (#847 B セクション)

## 改訂履歴

| 日付 | 改訂内容 |
|---|---|
| 2026-05-12 | 初版 (#847 A セクション着手) |
| 2026-05-12 | `/generate-code` 出力アプリへの同梱方針セクション追記 (#1048) |
| 2026-05-14 | #1097 で AI CLI 永続化を完全再設計: host bind mount (`~/.agent-containers/<project>/`) + `.config.json` workaround + `.credentials.json` 経由 auth。`CLAUDE_CODE_OAUTH_TOKEN` env var / symlink トリック / `${devcontainerId}` named volume 等の中間試行は全撤去。詳細は本節「TL;DR — 本環境の構成」参照 |
| 2026-05-15 | Dev Containers を「推奨」に明示昇格 (#1109)。Quick Start 直後に「ホスト側に何が作られるか」+「初回 OAuth 1 回」セクション追加。「Phase 1」「並行運用可」「両モード併用が標準」等の WSL2 native と並列のトーンを「推奨は Dev Containers、WSL2 native も代替として valid」に再整理。`wsl2-docker-migration.md` → `wsl2-native.md` / `distribution-roadmap.md` リンク更新 |
