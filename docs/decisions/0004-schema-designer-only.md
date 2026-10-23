---
description: "スキーマの変更は設計者の専権。AI は拡張・既存の項目で表す"
status: decided
issue: "#511"
---

# 0004 スキーマの変更は設計者の専権

**状況**: AI がテストを通すため、または業務を表すために、スキーマを広げてしまう事故があった。

**決めたこと**: `schemas/v3/*.json` を AI の判断で変えない。業務の記述で表せないときは、拡張 (`extensions/<namespace>/*.json`) → 既存の項目での代替 → ISSUE を起票して停止、の順。

**理由**: スキーマは設計の一次成果物で、全サンプル・画面・生成コードに波及する。

**結果**: [schema-governance.md](../spec/schema-governance.md)。AI-INDEX と AGENTS.md の最初に書いた。設計者が明示して認めた変更だけが入る。
