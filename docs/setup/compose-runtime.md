# Harmony を Compose で起動する

Harmony を **開発せず、設計ツールとして起動して使う** 場合の手順。Harmony 本体のコードを編集する開発者は [`dev-containers.md`](./dev-containers.md) を使う。

## 判断表

| 目的 | 使うもの | コマンド |
|---|---|---|
| Harmony 本体を開発する | VS Code Dev Containers | `npm run backend` + `npm run frontend` |
| Harmony を GUI ツールとして使う | Docker Compose | `docker compose up` |
| Docker ではなく Podman で使う | Podman Compose | `podman compose up` |
| image を作る maintainer 作業 | host の Docker / Podman | `bash scripts/build-harmony-image.sh local` |

Compose は複数コンテナ専用ではなく、単一コンテナの起動設定をファイル化する用途にも使う。Harmony の配布 runtime は 1 container なので、`compose.yml` は長い `docker run` を利用者に打たせないための起動レシピ。

## 前提

- Docker Compose v2 (`docker compose`) または Podman Compose (`podman compose` / `podman-compose`)
- 起動する image が pull 済み、または local build 済み
- host 側 workspace directory

maintainer が local image を作る場合:

```bash
bash scripts/build-harmony-image.sh local
```

Podman で build する場合:

```bash
CONTAINER_ENGINE=podman bash scripts/build-harmony-image.sh local
```

## 起動

既定値のまま起動する:

```bash
docker compose up
```

ブラウザで開く:

```text
http://127.0.0.1:5179/
```

background 起動:

```bash
docker compose up -d
docker compose logs -f harmony
docker compose down
```

Podman の場合:

```bash
podman compose up
```

環境によって `podman compose` ではなく `podman-compose` の場合がある。

## 設定変更

必要な場合だけ `.env.example` を `.env` にコピーして編集する。

```bash
cp .env.example .env
```

| 変数 | 既定値 | 用途 |
|---|---|---|
| `HARMONY_IMAGE` | `ghcr.io/csilost2001/harmony:local` | 起動する image |
| `HARMONY_PORT` | `5179` | host 側公開 port |
| `HARMONY_WORKSPACES` | `./workspaces` | host 側 workspace directory |
| `HARMONY_WORKSPACES_MOUNT_OPTIONS` | empty | Podman + SELinux 用 mount option |

host 側 port を変える例:

```text
HARMONY_PORT=5180
```

起動 URL は `http://127.0.0.1:5180/` になる。

workspace directory を変える例:

```text
HARMONY_WORKSPACES=/home/me/harmony-workspaces
```

## セキュリティ境界

`compose.yml` は port を `127.0.0.1:${HARMONY_PORT}:5179` に bind する。LAN へ公開しないこと。

`HARMONY_TRUST_LOCALHOST_PUBLISHED_PORT=1` は no-Origin MCP client を Docker / Podman の published port 経由で使うための opt-in。これは `127.0.0.1` bind とセットで使う前提で、`0.0.0.0:5179:5179` のような公開 bind とは組み合わせない。

## Podman 補足

Image は Docker 専用機能に依存していないため、Podman でも動作する想定。ただし会社環境の Podman 構成差があるため、以下を確認する。

- `podman compose version` が通るか
- 通らない場合は `podman-compose` が使えるか
- SELinux 有効 host では bind mount に `:Z` が必要か

SELinux で workspace bind mount が permission denied になる場合:

```text
HARMONY_WORKSPACES_MOUNT_OPTIONS=:Z
```

## Smoke

Compose 起動経路を smoke する:

```bash
bash scripts/smoke-harmony-compose.sh
```

Podman で smoke する:

```bash
CONTAINER_ENGINE=podman bash scripts/smoke-harmony-compose.sh
```

確認内容:

- `/health`
- SPA HTML
- `/mcp` initialize
- host 側からの WebSocket handshake

## Dev Containers との違い

| 項目 | Dev Containers | Compose runtime |
|---|---|---|
| 目的 | Harmony 本体を開発する | Harmony を起動して使う |
| 対象者 | contributor / AI coding agent | 業務アプリ設計者 |
| 起動 | VS Code 拡張が Docker を裏で操作 | 利用者が `docker compose up` |
| frontend | Vite dev server port 5173 | backend が static SPA を port 5179 で配信 |
| backend | `npm run backend` | image 内 `node backend/dist/index.js` |
| repo clone | 必須 | compose file と image があれば不要 |
