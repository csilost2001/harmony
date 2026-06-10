# Customer Project AGENTS.md Template

Harmony を Docker image / readonly spec package として利用し、業務 project 側だけを AI の writable scope にするための `AGENTS.md` テンプレート。

## Template

```markdown
# AGENTS.md

このリポジトリは Harmony で設計・生成する業務アプリ project です。

## 編集してよい領域

- `harmony-design/` — Harmony workspace。`harmony.json` と `<dataDir>/` 配下の設計 JSON を含む
- `app/` — 生成・実装する業務アプリ本体
- この project の README / tests / docs

## readonly reference

- `node_modules/@harmony/spec/` または別途配置された `@harmony/spec`
- Harmony schemas / docs / examples の readonly copy

## 編集禁止

- Harmony 本体 repo
- Harmony 本体の `frontend/`, `backend/`, `shared/`, `schemas/`, `docs/`
- Docker image 内の Harmony 配布物

## Harmony 本体に問題を見つけた場合

この業務 project 作業中に Harmony 本体 source を直接修正しない。

1. 既存 schema / extension / project-level convention で回避できるか確認する
2. 回避できない場合は Harmony 本体側の issue / PR として扱う
3. 業務 project 側には必要最小限の workaround だけを残す

## Schema governance

グローバル schema の変更は Harmony framework maintainer の責務です。業務 project の AI agent は `schemas/v3/*.json` を変更しません。
```

## 推奨 project layout

```text
customer-system/
  AGENTS.md
  harmony-design/
    harmony.json
    harmony/
      screens/
      tables/
      process-flows/
  app/
```

Harmony は Docker image として起動し、`customer-system/harmony-design` を workspace として開く。AI coding agent は `customer-system/` を作業ディレクトリにし、Harmony 本体 repo を writable scope に含めない。
