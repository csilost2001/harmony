---
name: publish-dev-image
description: Harmony Dev Container 用 base image を ghcr.io に build + push する。maintainer 専用、image 更新時 (Playwright/Node メジャー更新 / Debian 切替) に呼出す。version 引数必須 (例: 0.2、1.0、1.1-rc1)。
metadata:
  type: maintainer-tool
---

# publish-dev-image — Harmony Dev Container base image を ghcr.io に publish

## When to invoke

利用者から以下のいずれかが要求された時に起動する:

- 「base image を publish して」「ghcr に push して」「dev container image を更新して」
- 明示的に `/publish-dev-image <version>` 形式で呼ばれた時
- `.devcontainer/base/Dockerfile` を編集した直後で「公開して」と頼まれた時

**起動しない場合**:
- 通常開発作業 (npm test / コード変更等) では呼ばない
- overlay (`.devcontainer/Dockerfile`) の codex バージョン変更のみの時は呼ばない (overlay は配布不要)

## 実行環境 — host bash で実行する (Dev Container 内ではない)

本 skill は **host (WSL2 bash / Docker Desktop が動く環境)** で実行する。Dev Container 内には docker CLI が存在しない (#1122 で P5b 採用、container 内 docker 廃止)。

Claude Code が Dev Container 内から呼ばれた場合は、利用者に以下を依頼する:

> `cd ~/projects/harmony` (host WSL2 bash) で `bash .devcontainer/scripts/publish-dev-image.sh <version>` を実行してください。Maintainer 専用機能のため container 内には docker daemon access を持たせていません (#1122)。

## 前提条件 (1 回だけ確認、host bash で)

1. **docker daemon access (host)**: `docker info` が succeed すること
   - WSL2 + Docker Desktop integration で OK
   - Linux native は host で dockerd 起動済

2. **ghcr.io 認証**: `~/.docker/config.json` に ghcr.io credential が保存されている状態
   - `docker info` 出力に `Registry: ghcr.io` 表示があれば OK
   - 無い場合: host bash で `docker login ghcr.io -u <github-username>` (PAT を password、write:packages scope 必須)

## 実行手順

### Step 1: version 引数の検証

利用者から渡された version を確認:

- 形式: SemVer 推奨 (`0.1`, `1.0`, `1.1-rc1`, `2.0.0` 等)
- 既存 tag と衝突しないか確認 (任意): `docker manifest inspect ghcr.io/csilost2001/harmony-devcontainer-base:<version>` が **fail** すること (= まだ無い)
- 衝突する場合は利用者に確認、bump 提案

### Step 2: publish script を host で実行

```bash
# host WSL2 bash (Dev Container の外) で実行
cd ~/projects/harmony
bash .devcontainer/scripts/publish-dev-image.sh <version>
```

このスクリプトが:
1. `.devcontainer/base/Dockerfile` から image を build (`ghcr.io/csilost2001/harmony-devcontainer-base:<version>` + `harmony-devcontainer-base:local` の 2 タグ)
2. ghcr.io に push

build は数分かかる (Playwright `--with-deps` + Chromium DL ~285 MiB の install)。

### Step 3: 初回 push のみ — public visibility 確認

`csilost2001` で初めて push したバージョンの場合のみ:

1. https://github.com/users/csilost2001/packages/container/harmony-devcontainer-base/settings をブラウザで開いてもらう
2. Danger Zone → Change package visibility → Public に設定してもらう (確認入力: `harmony-devcontainer-base`)
3. 既存バージョンが既に public ならスキップ

判定: `gh api /users/csilost2001/packages/container/harmony-devcontainer-base --jq .visibility` が `public` なら OK。

### Step 4: overlay Dockerfile の FROM 更新

`.devcontainer/Dockerfile` の `FROM` 行を新 version に更新:

```dockerfile
FROM ghcr.io/csilost2001/harmony-devcontainer-base:<new-version>
```

Edit ツールで `:<old-version>` → `:<new-version>` を 1 行置換。

### Step 5: commit + push

```bash
git add .devcontainer/Dockerfile
git commit -m "chore(devcontainer): base image を :<old-version> → :<new-version> に更新"
git push
```

### Step 6: 利用者報告

完了報告に以下を含める:

- 新 version の ghcr URL
- 利用者は次の Rebuild Container で自動 pull する旨
- 初回 push なら public 化済か確認した結果

## Fork ユーザ向け (将来 Harmony 派生プロジェクト)

`HARMONY_GHCR_USER` 環境変数で username override 可能:

```bash
HARMONY_GHCR_USER=myusername bash .devcontainer/scripts/publish-dev-image.sh 0.1
```

その場合、Step 4 の FROM URL も自 ghcr に置換すること (`ghcr.io/myusername/...`)。

## 失敗時の対処

| 症状 | 対処 |
|---|---|
| `docker: command not found` | host bash (Dev Container の外) で実行していない可能性。`echo $HOSTNAME` で host か container か確認、host から実行 |
| `denied: permission_denied` (push 時) | ghcr.io にログインしていない or PAT の scope 不足。host で `docker login ghcr.io` をやり直す (write:packages 必須) |
| `manifest unknown` (Rebuild 時) | 利用者 side で base image を resolve できない。public visibility を確認 |
| build 中の apt/Playwright DL fail | network 一時障害の可能性、再実行 |

## 関連

- ISSUE [#1118](https://github.com/csilost2001/harmony/issues/1118) — Phase 3 で本 skill を新設
- ISSUE [#1122](https://github.com/csilost2001/harmony/issues/1122) — P5b 採用で host 実行運用に切替 (container 内 docker 廃止)
- `.devcontainer/scripts/publish-dev-image.sh` — 実体スクリプト
- `.devcontainer/base/Dockerfile` — base image 定義
- `docs/setup/dev-containers.md` — Maintainer: base image の更新と publish (人間向け詳細手順)
