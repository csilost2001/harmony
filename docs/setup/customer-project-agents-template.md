# Customer Project AGENTS.md Template

Harmony を Docker image として使い、業務 project 側だけを AI の writable scope にするための `AGENTS.md` テンプレート。Harmony を業務アプリの開発コンテナに同居させる構成 ([app-devcontainer-sidecar.md](./app-devcontainer-sidecar.md)) を前提にしている。

## Template

```markdown
# AGENTS.md

このリポジトリは Harmony で設計・生成する業務アプリ project です。
プロジェクトのルートが、そのまま Harmony のワークスペースです (`harmony.json` + `design/`)。

## 編集してよい領域

- 生成・実装する業務アプリ本体 (プロジェクトのルート直下のソース。`backend/` などに分けた場合はそのフォルダ)
- この project の README / tests / docs

## 設計は MCP の tool で直す (ファイルを直接書き換えない)

- `harmony.json` と `design/` の JSON は、Harmony の MCP (`http://localhost:5179/mcp`) の tool で直す。
  ファイルとして直接書き換えない (ロック・作業コピー・保存前の版を通らず、画面と食い違うため)
- 読むだけなら tool でもファイルでもよいが、迷ったら tool を使う

## 作業の流れ

1. 接続したら最初に `designer__get_project_context` を呼ぶ (設計の全体と、未解決のマーカー = 人からの指示・質問が分かる)
2. 設計は MCP の tool で作る・直す。直したら `designer__check_design` を呼び、error / warning を 0 件にしてから報告する
3. コードの生成は Prompt `generate-code` の手順に従う (VS Code の Claude Code 拡張のように Prompts を出さない AI クライアントでは、Resource `harmony://skill/generate-code/SKILL.md` を読めば同じ手順になる。Prompt は SKILL.md の本文と同じ)。手順が参照する付属ファイル (`templates/**` など) は
   Resource `harmony://skill/generate-code/<スキルのフォルダからの相対パス>` で読む (一覧は `harmony://skill/generate-code/files`)。
   出力先は既定でプロジェクトのルート (開発コンテナの雛形 `.devcontainer/` はルートにあるので、作り直さない)。`backend/` などに分けたいときは出力先にそのフォルダを渡す (`.devcontainer/` と `.mcp.json` はルートのまま。本番用の `Dockerfile` / `docker-compose.yml` と README の節は、その出力先のフォルダに作られる。すでにあるファイルだけは飛ばす)
4. 生成したら `designer__record_generation` で「どの設計からどのファイルを作ったか」を記録する。開発コンテナの雛形を写したときは `designer__record_scaffold` も呼ぶ。雛形が新しくなったと知らされたら (`check_design` の info「開発コンテナの雛形」・`get_project_context` の `scaffold`)、`designer__get_scaffold_update` で差分を取り、利用者が手を入れた箇所を残して、利用者の OK を取ってから当てる (当てたら `record_scaffold`、`.devcontainer/` を変えたら Rebuild Container を頼む)
5. 設計を直して再生成するときは、先に `designer__check_generation_drift` (生成物を手で直していないか) と
   `designer__get_regeneration_diff` (何が変わるか) を呼ぶ

## 編集禁止

- Harmony 本体 repo と、Docker image 内の Harmony 配布物
- Harmony の schema (`schemas/v3/*.json`)

## Harmony 本体に問題を見つけた場合

この業務 project 作業中に Harmony 本体 source を直接修正しない。

1. 既存 schema / extension / project-level convention で回避できるか確認する
2. 回避できない場合は Harmony 本体側の issue / PR として扱う
3. 業務 project 側には必要最小限の workaround だけを残す

## Schema governance

グローバル schema の変更は Harmony framework maintainer の責務です。業務 project の AI agent は `schemas/v3/*.json` を変更しません。
```

## 推奨 project layout

プロジェクトのルート = Harmony のワークスペース。1 フォルダ = 1 git リポジトリ。

```text
customer-system/               ← git リポジトリ。Harmony のワークスペース (harmony.json の置き場所)
  AGENTS.md
  .mcp.json                    ← Harmony の MCP (http://localhost:5179/mcp)
  .devcontainer/               ← dev + harmony (+ 必要なら db) を compose で起動
  harmony.json                 ← dataDir: "design"
  design/                      ← 設計データ (screens / tables / process-flows など)
  (アプリのソース)               ← ルート直下。backend/ などに分けてもよい (/generate-code の出力先で指定)
```

Harmony は開発コンテナに同居して起動し (配布 image、版は `.devcontainer/compose.yml` の `image:` で固定)、`customer-system/` を同じパスで開く。AI coding agent は `customer-system/` を作業ディレクトリにし、Harmony 本体 repo を writable scope に含めない。構成と手順: [app-devcontainer-sidecar.md](./app-devcontainer-sidecar.md)。
