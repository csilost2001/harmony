## 開発環境 (Dev Containers)

> 本 README は、生成された業務アプリを独立した project root として開く前提です。`examples/<id>/generated/` は Harmony 同梱サンプル / dogfood 参照物であり、実開発・別配布では `retail-app/` など意味のある folder 名の project root に配置して開いてください (`${localWorkspaceFolderBasename}` が AI CLI state の分離キーになります)。

VSCode + Dev Containers 拡張があれば、`git clone` 後に `Reopen in Container` で即環境完成。

1. 前提: Docker Desktop + VSCode + Dev Containers 拡張 (`ms-vscode-remote.remote-containers`)
2. `code .` → 右下のポップアップで「Reopen in Container」をクリック
3. 初回は 5-10 分 (features install + Maven 依存 + npm install)
4. ターミナル 2 つで起動 (Maven Wrapper があれば優先、無ければ system mvn を使用):
   ```bash
   # ターミナル 1: Backend (Spring Boot)
   ./mvnw spring-boot:run 2>/dev/null || mvn spring-boot:run

   # ターミナル 2: Frontend (Next.js)
   cd frontend
   npm run dev
   ```
5. ブラウザで http://localhost:3000 (Next.js)、Backend API は http://localhost:8080

Postgres を使う場合は **ホスト側 (WSL2 / macOS / Windows) ターミナル**で:
```bash
docker compose up db
```
(Dev Container 内には docker CLI を入れていないため、コンテナ内シェルからは実行できません)

詳細: [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json)

## 設計ツール (Harmony)

開発コンテナと同時に Harmony (設計ツール) が起動します (`.devcontainer/compose.yml` の `harmony` サービス。開発コンテナとネットワークを共有)。

- **画面**: VS Code のポート転送 `5179` (「Harmony (設計)」) から開く → `http://localhost:5179/`
- **AI CLI から**: プロジェクトのルートの `.mcp.json` が `http://localhost:5179/mcp` につないでいる。つないだら最初に `designer__get_project_context`
- **初回のワークスペース**: プロジェクトのルート (`/workspaces/app`) を Harmony のワークスペースにする。AI に「`designer__workspace_open { path: "/workspaces/app", init: true, dataDir: "design" }` で開いて」と頼むか、画面の「ワークスペース」から `/workspaces/app` を選んで作る。設計は `design/`、生成したソースは同じフォルダに入る (`harmony.json` も同じフォルダ)
- **Harmony の版**: `.devcontainer/compose.yml` の `image:` の既定値 (`ghcr.io/csilost2001/harmony:local`) を公開済みの版に書き換えて固定し、`Dev Containers: Rebuild Container` で上げる。このファイルは git で共有されるので、チームで同じ版になる。一時的に変えるだけならホストの環境変数 `HARMONY_IMAGE` を使う
- この構成は、ホストのユーザー ID が 1000 のとき (WSL2 の既定のユーザー、Docker Desktop など) を前提にしている。それ以外の Linux は既知の制約。詳細: Harmony の `docs/setup/app-devcontainer-sidecar.md`

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

`Dockerfile` は本番用 multi-stage build (Next.js build + Maven → JRE 21)、dev は `.devcontainer/` を参照。
