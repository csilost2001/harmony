## 開発環境 (Dev Containers)

> 本 README は、生成された業務アプリを独立した project root として開く前提です。`examples/<id>/generated/` は Harmony 同梱サンプル / dogfood 参照物であり、実開発・別配布では `retail-app/` など意味のある folder 名の project root に配置して開いてください (`${localWorkspaceFolderBasename}` が AI CLI state の分離キーになります)。

VSCode + Dev Containers 拡張があれば、`git clone` 後に `Reopen in Container` で即環境完成。

1. 前提: Docker Desktop + VSCode + Dev Containers 拡張 (`ms-vscode-remote.remote-containers`)
2. `code .` → 右下のポップアップで「Reopen in Container」をクリック
3. 初回は 6-12 分 (features install + npm install + prisma generate + ブラウザ (Chromium))
4. DB 初期化 (Prisma + SQLite、dev 用):
   ```bash
   DATABASE_URL=file:./prisma/dev.db npx prisma db push
   ```
5. ターミナルで起動:
   ```bash
   npm run start:dev
   ```
6. ブラウザで http://localhost:3000

**DB**: dev のデフォルトは SQLite (`file:./prisma/dev.db`、Prisma 経由)。Dev Container 内に docker CLI は入っていないため、Postgres を試す場合は **ホスト側ターミナル**で `docker compose up` (Prisma schema を `postgresql` に変える必要あり)。

詳細: [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json)

## 設計ツール (Harmony)

開発コンテナと同時に Harmony (設計ツール) が起動します (`.devcontainer/compose.yml` の `harmony` サービス。開発コンテナとネットワークを共有)。

- **画面**: VS Code のポート転送 `5179` (「Harmony (設計)」) から開く → `http://localhost:5179/`
- **AI CLI から**: プロジェクトのルートの `.mcp.json` が `http://localhost:5179/mcp` につないでいる。つないだら最初に `designer__get_project_context`
- **初回のワークスペース**: プロジェクトのルート (`/workspaces/app`) を Harmony のワークスペースにする。AI に「`designer__workspace_open { path: "/workspaces/app", init: true, dataDir: "design" }` で開いて」と頼むか、画面の「ワークスペース」から `/workspaces/app` を選んで作る。設計は `design/`、生成したソースは同じフォルダに入る (`harmony.json` も同じフォルダ)
- **Harmony の版**: `.devcontainer/compose.yml` の `image:` の既定値 (`ghcr.io/csilost2001/harmony:local`) を公開済みの版に書き換えて固定し、`Dev Containers: Rebuild Container` で上げる。このファイルは git で共有されるので、チームで同じ版になる。一時的に変えるだけならホストの環境変数 `HARMONY_IMAGE` を使う (VS Code をターミナルから `code .` で開いたときに効く。GUI から起動すると環境変数を引き継がないことがある)
- この構成は、ホストのユーザー ID が 1000 のとき (WSL2 の既定のユーザー、Docker Desktop など) を前提にしている。それ以外の Linux は既知の制約。詳細: Harmony の `docs/setup/app-devcontainer-sidecar.md`

## ブラウザの自動操作 (Playwright MCP)

AI が画面を開いて、見た目や動きを確かめられます (E2E の確認にも使います)。プロジェクトのルートの `.mcp.json` に 2 つ入っています。

| MCP の名前 | 使いどころ |
|---|---|
| `playwright` | ふだんはこちら。画面なしのブラウザ (headless) で動く |
| `playwright-headed` | 人が「画面を見たい」と言ったときだけ。Windows のデスクトップにブラウザの窓が開く |

- **開ける画面**: Harmony の画面 `http://localhost:5179` も、業務アプリ (http://localhost:3000) も、そのまま開ける (どれも開発コンテナの `localhost`)
- **`playwright-headed` の前提**: Windows + WSL2 + Docker Desktop。窓を出すために `.devcontainer/compose.yml` が WSLg の X11 (`/tmp/.X11-unix`・`/mnt/wslg`・`DISPLAY`) を渡している。プロジェクトのフォルダを WSL の中に置き、WSL から開く (Windows 側のフォルダから開くと窓が出ない)。macOS / Linux native では `compose.yml` の `dev` の WSLg の 4 行 (volumes の `/tmp/.X11-unix` と `/mnt/wslg` の 2 行、`environment:` と `DISPLAY` の 2 行) を消す (Docker Desktop for Mac など共有されていないパスを渡せない環境では、消さないと起動しないおそれがある。Linux native ではホストに空のフォルダができるだけ)。headed は使えず、`playwright` だけ使う
- **Wayland の mount エラー**が出たら、VS Code の user settings に `dev.containers.mountWaylandSocket=false` を入れる
- **版とブラウザ**: Playwright MCP は `@latest`。コンテナを起動するたびに、その MCP に合う Chromium を入れ直す (入っていれば数秒。ネットが無くて失敗しても、起動は止まらない)。それでも「ブラウザが無い」と出たら `npx -y -p @playwright/mcp@latest playwright install chromium`
- **保存先**: スナップショット・スクリーンショットは `.tmp/playwright-mcp/` に出る。`.tmp/.gitignore` があるので git には入らない (VS Code のエクスプローラーでは開ける)。ファイル名を指定して保存させるときは、`.tmp/playwright-mcp/` の下を指定する (名前だけだと MCP を起動した場所 (Claude Code ならふつうはプロジェクトのルート) に出て git に入る)
- **E2E (`@playwright/test`) とは別のブラウザ**: generate-tests が作る E2E は、自分の版のブラウザを `npx playwright install chromium` で入れて使う。MCP と版が違うと Chromium が 2 つ入る (正常)
- **Harmony の「開いている画面」に数えられる**: 自動のブラウザも Harmony の画面につながるので、`designer__workspace_close` のように「開いている画面」に影響する操作を確かめるときは、そのブラウザも考えに入れる

## AI CLI 利用 (任意)

container 内に 3 つの AI CLI が install されています。**開発者が持っているサブスクの CLI だけ login** してください (全部入れる必要はなし)。

| AI CLI | 必要なサブスク | 初回 login コマンド |
|---|---|---|
| Claude Code | Anthropic Claude Pro/Max | `claude /login` (ブラウザ OAuth) |
| Codex | OpenAI ChatGPT Plus | `codex login` |
| Copilot CLI | GitHub Copilot | `gh auth login` (or host の `~/.config/gh` を bind mount で継承済の場合は不要) |

認証情報と AI エージェントの session / memory / history は host の `~/.agent-containers/<project>/.{claude,codex,copilot}/` と `~/.config/gh/` に bind mount で永続化されるため、**rebuild しても再 login 不要、session 履歴も保持** (`refreshToken` で 60〜90 日は自動更新)。

- `.claude/` — Claude Code OAuth + sessions + memory
- `.codex/` — Codex CLI OAuth + sessions + history
- `.copilot/` — Copilot CLI session-state + command-history-state.json + memory ([公式 docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference))
- `~/.config/gh/` — gh CLI auth (Copilot CLI の認証に必要)

WSL2 host 側 `~/.claude/` (WSL2 native claude 用) には触りません — `~/.agent-containers/` という別名前空間を使うことで host claude と container claude を同時稼働させても干渉しません。

## 本番デプロイ (Docker)

```bash
docker compose up --build
```

`Dockerfile` は本番用 multi-stage build (NestJS SSR + views)、dev は `.devcontainer/` を参照。production 時に Postgres へ切り替える場合は `docker-compose.yml` のコメントアウト行を有効化し、Prisma schema の provider を変更すること。
