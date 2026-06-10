# @harmony/spec package contract

`@harmony/spec` は Harmony 本体 source を業務 project の writable scope に入れず、AI / 開発者が schema・仕様・サンプルを readonly reference として参照するための配布単位。

関連: #1472 / [workspace.md](workspace.md) / [schema-governance.md](schema-governance.md)

## 1. 目的

Harmony 利用者が業務 project を設計・生成する時、AI は正しい JSON を作るために schema / docs / examples / type を参照する必要がある。一方で Harmony 本体 repo を writable にすると、業務 project 作業中に `frontend/` / `backend/` / `schemas/` などを誤編集するリスクがある。

`@harmony/spec` はこの境界を分離する。

```text
AI writable:
  customer-system/
    harmony-design/
    app/

AI readonly reference:
  @harmony/spec

AI prohibited:
  Harmony 本体 repo
```

## 2. package 構成

初期構成は以下を想定する。

```text
@harmony/spec
  schemas/
    v3/
  docs-md/
  docs-html/
  examples/
  types/
```

| ディレクトリ | 役割 | canonical 性 |
|---|---|---|
| `schemas/v3/` | JSON Schema。validation の正本 | canonical |
| `docs-md/` | 仕様書 Markdown | canonical documentation |
| `docs-html/` | 人間・AI が検索しやすい HTML build artifact | generated |
| `examples/` | 業界別サンプル project | reference |
| `types/` | TypeScript 型定義 | generated or shared-derived |

## 3. canonical source

JSON の妥当性判断は常に `schemas/v3/` を正本とする。`docs-html/` は検索・閲覧用の build artifact であり、schema と矛盾した場合は schema を優先する。

TypeScript 型は schema / shared source から派生する成果物として扱う。型定義だけを手で更新して schema と drift させてはならない。

## 4. 配布候補

社内向けでは npmjs public 公開を前提にしない。候補:

- GitHub Packages
- 社内 npm registry
- npm private package
- tarball
- git URL

初期は tarball または GitHub Packages が現実的。CI で package contents を固定し、`schemas/v3/` と `docs/html/` の生成漏れを検出する。

## 5. AI agent への渡し方

業務 project 側の `AGENTS.md` には以下を明記する。

```text
Writable:
  ./harmony-design/
  ./app/

Readonly reference:
  ./node_modules/@harmony/spec/
  or /path/to/harmony-spec/

Do not edit:
  Harmony 本体 repo
```

Harmony 本体の不備を見つけた場合は、業務 project 内で回避するか Harmony 本体側の issue / PR として扱う。業務 project 作業中に Harmony 本体 source を直接修正しない。

## 6. 初期実装範囲

#1472 では package 契約を固定する。実際の npm package publish / CI release は配布 pipeline 整備時に行う。
