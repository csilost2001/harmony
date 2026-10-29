# 業務アプリの開発コンテナに Harmony を同居させる

外の業務プロジェクト (Harmony 本体の repo ではない、お客さまのアプリのフォルダ) で、**設計 (Harmony) と開発 (AI・ビルド・テスト) を 1 つのフォルダで続ける**ための構成。Harmony をアプリの開発コンテナの「となり」に置く (サイドカー)。

- 業務プロジェクトからは **MCP だけで** Harmony を使う (スキル・テンプレートをコピーしない)
- 設計データとアプリのソースが**同じフォルダ・同じ git** にある (Harmony からもソースが見える)

Harmony 本体を開発する人は [dev-containers.md](./dev-containers.md)、Harmony を単独で起動して使うだけなら [compose-runtime.md](./compose-runtime.md)。

## 構成

```text
~/projects/tax-app/            ← 1 フォルダ = 1 git リポジトリ = Harmony のワークスペース
  harmony.json                 ← ワークスペースの設定 (dataDir: "design")
  design/                      ← 設計データ
  backend/  frontend/          ← アプリのソース (/generate-code が作る)
  .mcp.json                    ← http://localhost:5179/mcp
  .devcontainer/
    devcontainer.json          ← compose 形式。dev と harmony を起動
    compose.yml                ← dev / harmony の 2 サービス
    .env.example               ← HARMONY_IMAGE (Harmony の版) の例
```

| コンテナ | 役割 |
|---|---|
| `dev` | Claude Code などの AI CLI・Node/Java・ビルド。フォルダを `/workspaces/app` に置く |
| `harmony` | 設計ツール (配布 image)。**同じフォルダを同じパス `/workspaces/app`** に置く。`network_mode: service:dev` で dev とネットワークを共有 |

この形にした理由:

- **dev から MCP につながる**: Harmony は Host が `localhost` / `127.0.0.1` の要求だけを受け付ける (`backend/src/security/originCheck.ts`)。ネットワークを共有すれば、dev から見た Harmony は `localhost:5179` で、Harmony を直さずにつながる。画面も VS Code のポート転送 (5179) で `localhost` として開ける
- **生成の記録がそのまま使える**: ソースが Harmony のワークスペースの中にあるので、`designer__record_generation` (`backend/...` のパス) と `designer__check_generation_drift` が使える
- **パスの読み替えが要らない**: 2 つのコンテナで同じパス、同じ git
- Harmony 本体の開発 (dev server の停止・E2E) の影響を受けない (配布 image で動く)

## 雛形の取り出し方

雛形は `ai-skills/generate-code/templates/devcontainer/<組合せ>/` にある。組合せは `nestjs-nextjs` / `nestjs-thymeleaf` / `spring-boot-nextjs` / `spring-boot-thymeleaf` の 4 つ。どれにも同じ Harmony の構成が入っている。取り出し方は 3 つ。

1. **`/generate-code` に任せる**: 業務プロジェクトの出力先に `.devcontainer/` がまだ無ければ、`/generate-code` が技術スタックに合う雛形を置く ([generate-code-workflow.md](../user-guide/generate-code-workflow.md))
2. **Harmony の repo から取る**: 上のフォルダの `.devcontainer/` と `.mcp.json` を、業務プロジェクトのルートにコピーする (隠しフォルダ `.devcontainer/` も忘れずに)
3. **MCP の Resource で読む** (リポジトリを持たない場合): `harmony://skill/generate-code/files` で一覧を見て、`harmony://skill/generate-code/templates/devcontainer/<組合せ>/.devcontainer/compose.yml` のように 1 ファイルずつ読んで書き出す。AI に頼めばよい

コピーしたら、`.gitignore` に `.devcontainer/.env` を足す (Harmony の版を決める個人用の設定のため)。

## 初回の起動

ホストに Docker Desktop (または Docker Engine) と、VS Code + Dev Containers 拡張が要る。

1. Harmony の image を用意する (下の「Harmony の版」)
2. VS Code でプロジェクトのフォルダを開き、`Reopen in Container`
3. dev と harmony の 2 つが起動する。初回は dev の features の取得などで数分かかる
4. VS Code のポート転送 `5179` (「Harmony (設計)」) から `http://localhost:5179/` を開くと、Harmony の画面が出る
5. dev のターミナルで Claude Code を起動する。`.mcp.json` で `http://localhost:5179/mcp` につながる。つないだら最初に `designer__get_project_context`

> 起動の形は `dev` 1 つが主で、`harmony` は `runServices` で一緒に起動される。`docker compose up` を `.devcontainer/` で単独に実行する使い方は想定しない (Dev Container が組み立てる)。

## ワークスペースの作り方

プロジェクトのルート (`/workspaces/app`) を Harmony のワークスペースにする。設計は `design/` に入る。

AI (dev の Claude Code) に頼む場合の呼び出し:

```text
designer__workspace_open { "path": "/workspaces/app", "init": true, "dataDir": "design" }
```

画面から作る場合: 「ワークスペース」の画面で `/workspaces/app` を選んで新規作成し、データのフォルダ名を `design` にする。

できあがるもの: `/workspaces/app/harmony.json` と `/workspaces/app/design/`。以降は設計を MCP の tool か画面で直し、`/generate-code` (MCP の Prompt `generate-code`) で `backend/` `frontend/` に生成する。生成したら `designer__record_generation`、再生成の前は `designer__check_generation_drift` と `designer__get_regeneration_diff`。作業の流れは [customer-project-agents-template.md](./customer-project-agents-template.md) の AGENTS.md に書いてある。

## Harmony の版

`harmony` サービスの image は `HARMONY_IMAGE` で決まる (既定は `ghcr.io/csilost2001/harmony:local`)。

### 配布 image の版を固定する (公開されたあと)

`.devcontainer/.env.example` を `.env` にコピーして指定する。

```text
HARMONY_IMAGE=ghcr.io/csilost2001/harmony:<version>
```

版を上げるときは `.env` のタグを書き換えて、VS Code で `Dev Containers: Rebuild Container`。設計データ (`harmony.json`・`design/`) は bind mount のフォルダにあり、Harmony の状態 (`~/.harmony` = 最近開いたワークスペースなど) は `harmony-state` の volume に残るので、版を上げても消えない。

### ローカルでビルドした image を使う (いまはこちら)

配布 image は ghcr にまだ公開されていない。Harmony の repo を持っているホストの WSL2 / Linux で、image を作る。

```bash
cd <Harmony の repo>
bash scripts/build-harmony-image.sh local
```

これで `ghcr.io/csilost2001/harmony:local` ができる。`.env` に何も書かなければ、この image が使われる。**Dev Container の中では Docker が使えない**ので、ビルドはホスト側のターミナルで行う。Podman なら `CONTAINER_ENGINE=podman bash scripts/build-harmony-image.sh local` ([compose-runtime.md](./compose-runtime.md))。

## 接続できない場合 (別のコンテナ名・host.docker.internal)

次のような経路で Harmony の `/mcp` や画面に接続すると、`Host header not allowed` で断られる。

- 別のコンテナ名 (例: `http://harmony:5179/mcp`)
- `http://host.docker.internal:5179/mcp`
- ホストの LAN の IP アドレス

理由: Harmony は DNS rebinding を防ぐため、Host ヘッダーが `localhost` / `127.0.0.1` の要求だけを受け付ける (`backend/src/security/originCheck.ts`)。この構成が dev とネットワークを共有するのは、dev から Harmony が `localhost` に見えるようにするため。

許可するホスト名を設定で増やす機能は、いまは入れていない。別のコンテナから使いたいときも、そのコンテナを `network_mode: service:dev` にするか、dev 経由で使う。

## ファイルの持ち主 (ホストの uid が 1000 でないとき)

Harmony の image も dev の image も、実行ユーザーは uid 1000 (`node` / `vscode`)。ホスト (Linux / WSL2) のあなたのユーザーも uid 1000 なら、画面で保存した設計ファイルを dev の git で差分として見るときに、持ち主・権限の問題は出ない。Docker Desktop (Windows / macOS) でも、通常は問題ない。

ホストの uid が 1000 でない Linux では、bind mount したフォルダの持ち主が合わず、Harmony が `design/` や `harmony.json` を書けない (保存時に権限エラー) ことがある。`id -u` で確かめ、1000 でなければ次のどちらかにする。

- プロジェクトのフォルダを、uid 1000 が書き込めるようにする (例: `sudo chown -R 1000:1000 <フォルダ>`)
- `compose.yml` の `harmony` サービスに `user: "<ホストの uid>:<ホストの gid>"` を足す (dev 側は Dev Containers が uid を合わせる)

## DB を足すとき

雛形には DB を入れていない (業務アプリによって違うため)。PostgreSQL を同居させるなら、`compose.yml` に `db` サービスを足し、`devcontainer.json` の `runServices` に `"db"` を足す。アプリからは `db:5432` で届く。Harmony は DB に触れない。

## 実機での確認項目

雛形を変えたときは、実機 (ホストの Docker) で次を通す。

1. `Reopen in Container` で dev と harmony が起動し、ブラウザで Harmony の画面が開ける
2. dev の Claude Code が `http://localhost:5179/mcp` に接続でき、Resources・Prompts が読める (スキルの付属ファイル `harmony://skill/generate-code/...` を含む)
3. 画面・テーブル・処理フローを 1 つずつ作り、`generate-code` で `backend/` `frontend/` に生成して記録する
4. 設計を直すと「再生成が必要」、生成物を手で直すと「生成物が変わった」と検出される
5. 画面で保存した設計ファイルが、dev 側の git で差分として見える (持ち主・権限の問題がない)
