# 業務アプリの開発コンテナに Harmony を同居させる

外の業務プロジェクト (Harmony 本体の repo ではない、お客さまのアプリのフォルダ) で、**設計 (Harmony) と開発 (AI・ビルド・テスト) を 1 つのフォルダで続ける**ための構成。Harmony をアプリの開発コンテナの「となり」に置く (本書では「同居」と呼ぶ。開発コンテナと並べて起動する別のコンテナ、という意味)。

- 業務プロジェクトからは **MCP だけで** Harmony を使う (スキル・テンプレートをコピーしない)
- 設計データとアプリのソースが**同じフォルダ・同じ git** にある (Harmony からもソースが見える)

Harmony 本体を開発する人は [dev-containers.md](./dev-containers.md)、Harmony を単独で起動して使うだけなら [compose-runtime.md](./compose-runtime.md)。

## 構成

```text
~/projects/tax-app/            ← 1 フォルダ = 1 git リポジトリ = Harmony のワークスペース
  harmony.json                 ← ワークスペースの設定 (dataDir: "design")
  design/                      ← 設計データ
  (アプリのソース)             ← /generate-code が作る。既定はルート直下。backend/ などに分けることもできる
  .mcp.json                    ← Harmony (http://localhost:5179/mcp) と Playwright MCP (ブラウザの自動操作)
  .tmp/.gitignore              ← Playwright MCP の出力 (.tmp/playwright-mcp/) を git に入れない
  .devcontainer/
    devcontainer.json          ← compose 形式。dev と harmony を起動
    compose.yml                ← dev / harmony の 2 サービス (Harmony の版もここで決める)
```

| コンテナ | 役割 |
|---|---|
| `dev` | Claude Code などの AI CLI・Node/Java・ビルド。フォルダを `/workspaces/app` に置く |
| `harmony` | 設計ツール (配布 image)。**同じフォルダを同じパス `/workspaces/app`** に置く。`network_mode: service:dev` で dev とネットワークを共有 (2 つのコンテナが 1 つのネットワークを分け合うので、お互いに `localhost` で届く) |

この形にした理由:

- **dev から MCP につながる**: Harmony は Host が `localhost` / `127.0.0.1` の要求だけを受け付ける (`backend/src/security/originCheck.ts`)。ネットワークを共有すれば、dev から見た Harmony は `localhost:5179` で、Harmony を直さずにつながる。画面も VS Code のポート転送 (5179) で `localhost` として開ける
- **生成の記録がそのまま使える**: ソースが Harmony のワークスペースの中にあるので、`designer__record_generation` (ワークスペースからの相対パス) と `designer__check_generation_drift` が使える
- **パスの読み替えが要らない**: 2 つのコンテナで同じパス、同じ git
- Harmony 本体の開発 (dev server の停止・E2E) の影響を受けない (配布 image で動く)

## 雛形の取り出し方

まだ設計もソースも無い、最初の 1 回は **取り出し方 2 (Harmony の repo からコピー)** を使う。取り出し方 1 と 3 は、すでに Harmony に MCP でつながっている AI が必要なので、Harmony が起動してから使える (つなげるまでは使えない)。

雛形は `ai-skills/generate-code/templates/devcontainer/<組合せ>/` にある。組合せは `nestjs-nextjs` / `nestjs-thymeleaf` / `spring-boot-nextjs` / `spring-boot-thymeleaf` の 4 つ。どれにも同じ Harmony の構成が入っている。取り出し方は 3 つ。

1. **`/generate-code` に任せる** (Harmony につながってから): ワークスペースのルートに `.devcontainer/` がまだ無ければ、`/generate-code` が技術スタックに合う雛形を置く (すでにあるファイルは飛ばす。本番用の `Dockerfile` などは、`.devcontainer/` があっても出力先に作られる) ([generate-code-workflow.md](../user-guide/generate-code-workflow.md))
2. **Harmony の repo から取る** (初めての 1 回はこれ): 上のフォルダの `.devcontainer/`・`.mcp.json`・`.tmp/.gitignore` を、業務プロジェクトのルートにコピーする (隠しフォルダ `.devcontainer/` と `.tmp/` も忘れずに)
3. **MCP の Resource で読む** (Harmony につながってから。リポジトリを持たない場合): `harmony://skill/generate-code/files` で一覧を見て、`harmony://skill/generate-code/templates/devcontainer/<組合せ>/.devcontainer/compose.yml` のように 1 ファイルずつ読んで書き出す。AI に頼めばよい


## 初回の起動

ホストに Docker Desktop (または Docker Engine) と、VS Code + Dev Containers 拡張が要る。

1. Harmony の image を用意する (下の「Harmony の版」)
2. VS Code でプロジェクトのフォルダを開き、`Reopen in Container`
3. dev と harmony の 2 つが起動する。初回は dev の features の取得などで数分かかる
4. VS Code のポート転送 `5179` (「Harmony (設計)」) から `http://localhost:5179/` を開くと、Harmony の画面が出る
5. dev のターミナルで Claude Code を起動する。`.mcp.json` で `http://localhost:5179/mcp` につながる (Claude Code は、プロジェクトの `.mcp.json` を初めて使うときに承認を求めるので、承認する)。つないだら最初に `designer__get_project_context`

Claude Code ではなく Codex CLI を使う場合は、プロジェクトの `.codex/config.toml` (またはユーザーの `~/.codex/config.toml`) に次を書く。

```toml
[mcp_servers.harmony]
url = "http://localhost:5179/mcp"
```

> 起動の形は `dev` 1 つが主で、`harmony` は `runServices` で一緒に起動される。`docker compose up` を `.devcontainer/` で単独に実行する使い方は想定しない (Dev Container が組み立てる)。

## ワークスペースの作り方

プロジェクトのルート (`/workspaces/app`) を Harmony のワークスペースにする。設計は `design/` に入る。

AI (dev の Claude Code) に頼む場合の呼び出し:

```text
designer__workspace_open { "path": "/workspaces/app", "init": true, "dataDir": "design" }
```

画面から作る場合: 「ワークスペース」の画面で `/workspaces/app` を選んで新規作成し、データのフォルダ名を `design` にする。

できあがるもの: `/workspaces/app/harmony.json` と `/workspaces/app/design/`。以降は設計を MCP の tool か画面で直し、`/generate-code` (MCP の Prompt `generate-code`) で生成する。ソースは既定ではプロジェクトのルート直下に出る。`backend/` `frontend/` などに分けたいときは、`/generate-code` の出力先にそのフォルダを渡す (そのときも `.devcontainer/` と `.mcp.json` はルートのまま、入れ子にはならない。本番用の `Dockerfile` / `docker-compose.yml` と README の設計ツールの節は、その出力先のフォルダに作られる。すでにあるファイルだけは飛ばして、上書きしない)。生成したら `designer__record_generation`、再生成の前は `designer__check_generation_drift` と `designer__get_regeneration_diff`。作業の流れは [customer-project-agents-template.md](./customer-project-agents-template.md) の AGENTS.md に書いてある。

### 環境変数と、ワークスペースが開く時機

`compose.yml` の `harmony` サービスには、次の 2 つの環境変数がある。どちらもワークスペースを自動で開く設定ではない。

- `HARMONY_WORKSPACES_DIR` (`/workspaces/app`): 画面でフォルダを選ぶときに、最初に見せる場所
- `HARMONY_ALLOWED_BROWSE_ROOTS` (`/workspaces`): 画面で選べるフォルダの範囲

ワークスペースは最初の 1 回だけ、画面 (ワークスペースの選択) か MCP の `designer__workspace_open` で `/workspaces/app` を開く。ワークスペースが選ばれていなくても、`designer__workspace_*` の tool は使える。開いた直後から、MCP の続く要求にも効く (MCP は要求ごとに接続を作るが、新しい接続の作業先は「最後に開いたワークスペース」になる。画面で開いたワークスペースにも、MCP が付いていく)。開いたワークスペースは `harmony-state` の volume に記録され、次からは起動時に自動で開く (前回開いたワークスペースの `harmony.json` が残っているとき)。

この同居の構成では `DESIGNER_DATA_DIR` は使わない。これは「固定モード」で、`harmony.json` が無いと起動せず、ワークスペースも切り替えられないので、最初の 1 回の `init` ができなくなる。

### Prompts を出さない AI クライアント

VS Code の Claude Code 拡張のように、MCP の Prompts を出さない AI クライアントでは、Resource `harmony://skill/<名前>/SKILL.md` (例: `harmony://skill/generate-code/SKILL.md`) を読めば同じ手順になる (Prompt の本文は SKILL.md の本文と同じ)。

## Harmony の版

`harmony` サービスの image は、`.devcontainer/compose.yml` の `image:` で決まる (`${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:local}`。既定は `:local`)。

### 配布 image の版を固定する (公開されたあと)

`compose.yml` の `image:` の既定値 (`:local` の部分) を、公開済みの版に書き換える。

```yaml
image: ${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:<version>}
```

`compose.yml` は git で共有されるので、チームで同じ版になる。一時的に別の版を試すだけなら、ホストの環境変数 `HARMONY_IMAGE` を設定して起動する (ファイルは変わらない。VS Code をターミナルから `code .` で開いたときに効く。GUI から起動すると環境変数を引き継がないことがある)。版を上げるときは書き換えて、VS Code で `Dev Containers: Rebuild Container`。設計データ (`harmony.json`・`design/`) はホストのフォルダを共有しているもの (bind mount = ホストのフォルダをそのままコンテナに見せる仕組み) にあり、Harmony の状態 (`~/.harmony` = 最近開いたワークスペースなど) は `harmony-state` の volume に残るので、版を上げても消えない。

### ローカルでビルドした image を使う (いまはこちら)

配布 image は ghcr にまだ公開されていない。Harmony の repo を持っているホストの WSL2 / Linux で、image を作る。

```bash
cd <Harmony の repo>
bash scripts/build-harmony-image.sh local
```

これで `ghcr.io/csilost2001/harmony:local` ができる。`compose.yml` の既定のままなら、この image が使われる。**ビルドしていないと、起動時に `pull access denied` で止まる** (ghcr から取ろうとして失敗している。先に `bash scripts/build-harmony-image.sh local` を実行する)。**Dev Container の中では Docker が使えない**ので、ビルドはホスト側のターミナルで行う。Podman なら `CONTAINER_ENGINE=podman bash scripts/build-harmony-image.sh local` ([compose-runtime.md](./compose-runtime.md))。

> **版を上げたら、開いている Harmony の画面 (ブラウザのタブ・VS Code の簡易ブラウザ) をすべて再読み込みする。** 作り直す前から開いていたタブは古い画面のまま動き続け、ワークスペースの扱いが新しい版と食い違うことがある (例: AI がワークスペースを閉じたとき、古いタブが開き直して、AI の作業先が戻る)。画面は接続のたびにサーバの版と比べ、古いと気づくと上部に「Harmony が更新されました。再読み込みしてください」と出して、ワークスペースの開き直しを止める。その知らせが出たタブは再読み込みする ([版の食い違いの検知](../spec/server-security.md))。ただし、この仕組みが入る前の版の画面は知らせられないので、その一度は手で全タブを再読み込みする。

## 雛形の更新を取り込む

開発コンテナの雛形 (`.devcontainer/`・`.mcp.json`・`Dockerfile` など) は、コードを生成したときに Harmony の雛形から写したものです。Harmony の雛形が新しくなると、アプリ側は古いままになります。次のしくみで気づけます。

- 雛形を写したあと、AI が `designer__record_scaffold` で記録 (`design/scaffold.json`。git に載る) を残す。記録は、写したときの雛形の版と中身
- 雛形が新しくなると、`designer__check_design` の info (「開発コンテナの雛形」)・`designer__get_project_context` の `scaffold`・画面「連携と運用 → 版と更新」の節「開発コンテナの雛形」が知らせる。記録が無い古いアプリも、ルートの `.devcontainer/compose.yml` が Harmony の image を使っていれば知らせる
- 取り込むときは、AI に「**開発コンテナの雛形の更新を取り込んで**」と頼む。AI は `designer__get_scaffold_update` で差分の材料を取り、記録があるファイルは 3 方向 (写したときの雛形・いまの雛形・いまのアプリ)、無いファイルは 2 方向 (いまの雛形・いまのアプリ) で比べる。**利用者が手を入れた箇所 (Harmony の `image:` の版、足した service、ポートなど) は残し**、差分を見せて OK を取ってから書く。当てたら `designer__record_scaffold` で記録を最新にする
- `.devcontainer/` のファイルを変えたら、VS Code で `Dev Containers: Rebuild Container` が要る

## 接続できない場合 (別のコンテナ名・host.docker.internal)

次のような経路で Harmony の `/mcp` や画面に接続すると、`Host header not allowed` で断られる。

- 別のコンテナ名 (例: `http://harmony:5179/mcp`)
- `http://host.docker.internal:5179/mcp`
- ホストの LAN の IP アドレス

理由: Harmony は DNS rebinding (悪意のある Web ページが、利用者のブラウザ経由で手元のサーバーを操作しようとする攻撃) を防ぐため、Host ヘッダーが `localhost` / `127.0.0.1` の要求だけを受け付ける (`backend/src/security/originCheck.ts`)。この構成が dev とネットワークを共有するのは、dev から Harmony が `localhost` に見えるようにするため。

許可するホスト名を設定で増やす機能は、いまは入れていない。別のコンテナから使いたいときも、そのコンテナを `network_mode: service:dev` にするか、dev 経由で使う。

## ファイルの持ち主 (ホストのユーザー ID)

Harmony の image も dev の image も、実行ユーザーは uid 1000 (`node` / `vscode`)。この構成は、**ホストのユーザー ID が 1000 のとき (WSL2 の既定のユーザー。Docker Desktop はファイルの持ち主を読み替える) を前提**にしている。そのときは、画面で保存した設計ファイルを dev の git で差分として見るときに、持ち主・権限の問題は出ない。

ホストの uid が 1000 でない Linux は、**既知の制約**として未対応。フォルダの持ち主を変える (`chown`) と dev とホストの本人が書けなくなり、`harmony` に `user:` を指定すると状態の保存先 (`~/.harmony`・ログ) に書けなくなるので、どちらも勧めない。自分の uid を確かめるには `id -u`。

SELinux が有効なホスト (Fedora など) では、フォルダの共有 (`volumes` の `..:/workspaces/app`) に `:z` を付けないと読み書きできない場合がある (例: `..:/workspaces/app:z`)。

## DB を足すとき

雛形には DB を入れていない (業務アプリによって違うため)。PostgreSQL を同居させるなら、`compose.yml` に `db` サービスを足し、`devcontainer.json` の `runServices` に `"db"` を足す。アプリからは `db:5432` で届く。Harmony は DB に触れない。

## ブラウザの自動操作 (Playwright MCP)

AI が画面を開いて見た目や動きを確かめる (E2E の確認にも使う) ために、雛形の 4 組合せすべてに Playwright MCP を入れている (#1573)。

| MCP の名前 | 使いどころ |
|---|---|
| `playwright` | ふだんはこちら。画面なしのブラウザ (headless) |
| `playwright-headed` | 人が「画面を見たい」と言ったときだけ。Windows のデスクトップにブラウザの窓が開く |

どちらも `.mcp.json` に `npx -y @playwright/mcp@latest --isolated --browser chromium --output-dir /workspaces/app/.tmp/playwright-mcp` で書いてある (`playwright` は `--headless` 付き)。開発コンテナの `localhost` で動くので、Harmony の画面 `http://localhost:5179` も業務アプリ (`http://localhost:3000` など) もそのまま開ける。

- **入るもの**: `devcontainer.json` の `postCreateCommand` の末尾で `(npx -y -p @playwright/mcp@latest playwright install --with-deps chromium || echo '入れられなかった旨の案内')` (依存ライブラリは `sudo apt` で入る。初回だけ。Chromium の分で初回が 1〜2 分・数百 MB 延びる。ネットが無いなどで失敗しても、`|| echo` があるので postCreate 全体は失敗せず、コンテナの作成は止まらない)。`postStartCommand` で、起動のたびに `(playwright install chromium >/dev/null 2>&1 || echo '案内')` で最新の MCP に合うブラウザを入れ直す (入っていれば数秒で出力なし。ネットが無いなどで失敗したときだけ案内を出し、コンテナの起動は止めない)。postStart の出力を捨てるのは、Playwright が、プロジェクトの依存に入れていない状態で毎回出す英語の WARNING 枠が、失敗に見えるため (#1579)。postCreate は apt の進み具合が見えるよう出力を残すので、初回の postCreate のログに 1 回出る WARNING (`npx playwright install without first installing your project's dependencies`) は無視してよい (ブラウザは入っている)。
- **版**: `@latest`。MCP の版が上がるとブラウザの版も変わるので、起動のたびに入れ直している。それでも「ブラウザが無い」と出たら `npx -y -p @playwright/mcp@latest playwright install chromium`
- **headed の前提**: Windows + WSL2 + Docker Desktop。`compose.yml` の `dev` に、WSLg の X11 (`/tmp/.X11-unix`・`/mnt/wslg` の volumes と `DISPLAY: ":0"`) を渡している (Harmony 本体の開発コンテナと同じ)。プロジェクトのフォルダは WSL の中に置き、WSL から開く (Windows 側のフォルダから開くと窓が出ない)。**macOS / Linux native では、WSLg の 4 行 (volumes の `/tmp/.X11-unix` と `/mnt/wslg` の 2 行、`environment:` と `DISPLAY` の 2 行) を消す** (`environment:` のキー行だけ残すと値の無い mapping になるので、`DISPLAY` の行と一緒に消す。ただし NestJS の雛形は、`environment:` に `DATABASE_URL` などが続くことがある。そのときは `environment:` の行を残し、`DISPLAY` の行だけ消す)。消さないと、Docker Desktop for Mac など共有されていないパスを渡せない環境ではコンテナが起動しないおそれがある (実機では未確認。確認項目 9)。Linux native ではホストに空のフォルダができるだけ。そのときは headed は使えず、`playwright` だけ使う。`WAYLAND_DISPLAY` は設定しない。Dev Containers 拡張の Wayland socket の mount エラーが出る環境では、VS Code の user settings に `dev.containers.mountWaylandSocket=false` を入れる
- **保存先**: スナップショット・スクリーンショットは `.tmp/playwright-mcp/`。雛形の `.tmp/.gitignore` (`*` と `!.gitignore`) があるので git に入らない。VS Code のエクスプローラーでは開ける。ただし `browser_take_screenshot` などでファイル名を指定すると、`--output-dir` ではなく起動した場所 (プロジェクトのルート) からの相対パスで保存される (実機で確認)。名前を指定するときは `.tmp/playwright-mcp/` の下を指定する
- **E2E (`@playwright/test`) とは別のブラウザ**: generate-tests の E2E は、自分の版のブラウザを `npx playwright install chromium` で入れる。MCP と `@playwright/test` で Chromium の版 (rev) が違うと、2 つ入る。そろえない (正常)

### 自動のブラウザも「開いている画面」に数えられる

Harmony の画面を Playwright のブラウザで開くと、それも Harmony の WebSocket 接続 (wsConnections。画面のつながり) の 1 つに数えられる。人の画面と区別はつかない。そのため、`designer__workspace_close` のように「開いている画面」に影響する操作を AI が確かめるときは、自動のブラウザが開いたままの画面もあることを考えに入れる (確かめ終わったら `browser_close` で閉じる)。

## 実機での確認項目

雛形を変えたときは、実機 (ホストの Docker) で次を通す。

1. `Reopen in Container` で dev と harmony が起動し、ブラウザで Harmony の画面が開ける
2. dev の Claude Code が `http://localhost:5179/mcp` に接続でき、Resources が読める。Prompts が出る、または `harmony://skill/<名前>/SKILL.md` を Resource で読める (スキルの付属ファイル `harmony://skill/generate-code/...` を含む)
3. 画面・テーブル・処理フローを 1 つずつ作り、`generate-code` でプロジェクトのルート直下に生成して記録する
4. 設計を直すと「再生成が必要」、生成物を手で直すと「生成物が変わった」と検出される
5. 画面で保存した設計ファイルが、dev 側の git で差分として見える (持ち主・権限の問題がない)
6. `compose.yml` の `image:` の既定値を書き換えると、Rebuild Container で実際に image が切り替わる (ホストの環境変数 `HARMONY_IMAGE` でも切り替わる)
7. `Dev Containers: Rebuild Container` で dev だけが作り直されたとき、またはホスト側で dev だけを再起動したあとも、dev から harmony (`localhost:5179`) に届く (`network_mode: service:dev` が古いネットワークを握ったままにならない)
8. 設計が空の状態 (ルートに `package.json` が無い) から `Reopen in Container` しても、`postCreateCommand` が最後まで走る (Codex CLI が入る)
9. Playwright MCP: `playwright` (headless) で `http://localhost:5179/` が開けてスナップショットが取れる。`playwright-headed` で Windows のデスクトップに窓が開く (Windows + WSL2 + Docker Desktop)。`.tmp/playwright-mcp/` にスナップショットが出ても、`git status` に現れない。コンテナを再起動しても、`postStartCommand` が短時間で終わる
   - 雛形が実際に使う image の上で確かめる: `typescript-node:26` (nestjs 系) と java (`java:1-21-bookworm` + Node 26。spring-boot 系) の両方で、`postCreateCommand` の `playwright install --with-deps chromium` と `postStartCommand` の導入が終了コード 0 で終わり、Chromium が置かれる (java の image で sudo の apt が通ることを含む)
   - ネットを切った状態で `Reopen in Container` しても、`postCreateCommand` が最後まで走り、ブラウザの導入に失敗した案内が出る
   - `playwright-headed` で Windows のデスクトップに窓が開く (Windows + WSL2 + Docker Desktop、フォルダは WSL の中)
   - macOS (Docker Desktop for Mac) で、`compose.yml` の WSLg の 4 行を消すと起動し、消さないと起動しない (いまは推定)
