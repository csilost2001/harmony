---
name: publish-harmony-image
description: "Harmony 本体の配布用 Docker image を host WSL2/Linux で build / smoke / ghcr push する maintainer 手順。Dev Container 内では実行しない。version 引数必須。"
metadata:
  type: maintainer-tool
---

# publish-harmony-image — Harmony production image を publish

## When to invoke

利用者から以下を明示された時だけ使う:

- 「Harmony 本体 image を publish して」
- 「ghcr.io/csilost2001/harmony に push して」
- `/publish-harmony-image <version>`

通常の開発、Dockerfile 編集、ローカル build 確認だけでは起動しない。

## 実行環境

Docker build / push は **host WSL2 bash または Linux host** で実行する。Dev Container 内には docker daemon access を前提にしない。

Dev Container 内から依頼された場合は、利用者に host 側で以下を実行してもらう:

```bash
cd ~/projects/harmony
bash scripts/build-harmony-image.sh <version>
bash scripts/smoke-harmony-image.sh <version>
docker push ghcr.io/csilost2001/harmony:<version>
```

## 前提条件

1. `docker info` が成功する
2. ghcr.io push 時は `docker login ghcr.io -u <github-user>` 済み
3. PAT には `write:packages` scope がある
4. tag 衝突確認: `docker manifest inspect ghcr.io/csilost2001/harmony:<version>` が失敗すること

## 手順

### Step 1: version を確認

SemVer 形式を推奨する。例: `0.1.0`, `1.0.0`, `1.1.0-rc.1`

### Step 2: build

```bash
bash scripts/build-harmony-image.sh <version>
```

既定 image:

```text
ghcr.io/csilost2001/harmony:<version>
```

別 registry / tag で試す場合:

```bash
HARMONY_IMAGE=harmony:local bash scripts/build-harmony-image.sh local
```

### Step 3: smoke

```bash
bash scripts/smoke-harmony-image.sh <version>
```

確認内容:

- `/health` が 200
- `/` が frontend の HTML を返す
- `/mcp` initialize が成功する
- host 側から `ws://127.0.0.1:<port>` への WebSocket handshake が成功する
- container が `/home/node/.harmony` と `/data/workspaces` volume 付きで起動できる
- smoke container は `127.0.0.1:<port>:5179` で local-only publish し、no-Origin MCP 確認用に `HARMONY_TRUST_LOCALHOST_PUBLISHED_PORT=1` を明示する

### Step 4: push

```bash
docker push ghcr.io/csilost2001/harmony:<version>
```

初回公開時は GitHub Packages の visibility を public に設定する。

### Step 5: 報告

報告には以下を含める:

- image tag
- smoke 結果
- push 結果
- 利用者向け compose snippet の変更有無

## 関連

- `Dockerfile` — Harmony 本体 1-container image
- `scripts/build-harmony-image.sh`
- `scripts/smoke-harmony-image.sh`
- `docs/setup/distribution-roadmap.md`
- `docs/spec/path-conventions.md`
