---
layout: ../../layouts/SpecLayout.astro
title: Phase B 動作確認サンプル
description: HTML 化基盤 (Astro + Tailwind + pagefind + shiki + mermaid) の動作確認用ページ
---

# Phase B 動作確認サンプル

このページは Phase B (HTML 基盤構築) の動作確認用です。Phase C で削除されます。

## コードハイライト (shiki)

JSON:

```json
{
  "schemaVersion": "3.0.2",
  "processFlow": {
    "id": "sample",
    "name": "サンプル",
    "actions": [
      { "id": "act-001", "trigger": { "kind": "submit" }, "steps": [] }
    ]
  }
}
```

TypeScript:

```typescript
interface ProcessFlow {
  schemaVersion: string;
  id: string;
  actions: Action[];
}
```

Bash:

```bash
cd backend && npm run dev
```

## Mermaid 図 (build-time SVG)

```mermaid
graph LR
  A[業務記述 md] -->|AI| B[ProcessFlow JSON]
  B -->|generate-code| C[backend code]
  B -->|generate-tests| D[e2e tests]
  C --> E[Production]
  D --> E
```

## テーブル

| 項目 | 値 |
|---|---|
| schemaVersion | 3.0.2 |
| actions | array |
| trigger.kind | enum |

## リンクテスト

- [トップへ](/)
- [外部リンク (GitHub)](https://github.com/csilost2001/harmony)

## 注釈

> ℹ️ Phase C で `docs/spec/*.md` を全変換した時点で、このサンプルは削除されます。
