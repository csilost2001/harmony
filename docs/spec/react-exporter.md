# reactExporter — designer__export_screen 用 HTML→JSX 変換器 (ISSUE #1147 N-8)

## 位置付け

`backend/src/reactExporter.ts` は **MCP tool `designer__export_screen` の実装** で、Designer (GrapesJS) が出力した HTML スニペットを React TSX コンポーネントの **構文骨格** に変換する低レベルユーティリティ。

実装場所が backend なのは、ブラウザ側 (`exportScreen` ws コマンド) から取得した HTML を AI エージェントに JSX として返すまでが MCP 同期 RPC の流れに含まれるため。frontend にも同等の機能を置く必要がなく、backend で完結する。

## `/generate-code` skill との関係

両者は対象スコープが直交しており、置き換えではなく **補完関係**。

| 観点 | `designer__export_screen` (reactExporter.ts) | `/generate-code` skill |
|------|--------------------------------------------|----------------------|
| 入力 | Designer (GrapesJS) の HTML スニペット | Screen JSON / ProcessFlow JSON + `project.techStack` |
| 出力 | React TSX 構文骨格 1 ファイル (HTML→JSX の機械変換) | techStack 全体に整合した frontend / backend コード一式 |
| 用途 | デザイン確認 / クイック取り込み / プロトタイピング | 業務システム本体の AI 生成 (Next.js / Thymeleaf / NestJS / Spring Boot) |
| 機械的か AI 的か | 機械変換 (htmlparser2 ベース、`/* USER_HANDLER */` placeholder のみ残す) | AI 推論ベース (skill 内ルール + golden-examples) |
| イベントハンドラ | `() => { /* USER_HANDLER */ }` プレースホルダ (S-19 で TODO から rename 済) | スペック / 設計から実装ロジックを推論 |
| 出力先 | MCP レスポンス (markdown コードブロック、保存はユーザーに委ねる) | プロジェクト配下のファイル一式 (path 規約に従う) |

## 維持判断

将来の整理候補:
- (a) 維持 — designer から手軽に React 骨格を引き出せる軽量ツールとして残す (現状の判断)
- (b) `/generate-code` への統合 — techStack=NestJS+Next.js のサブ機能化
- (c) 削除 — ユーザーが直接 Designer の export 機能経由で取得できるなら不要

現状は **(a) 維持** が妥当:
1. `htmlToReact()` は決定的変換 (機械的) であり、`/generate-code` の AI 推論経路とは
   コスト・速度・確実性が異なる
2. MCP tool 単位で AI エージェントから直接呼べる利便性がある
3. 14 イベント属性の機械的変換テーブル等、`/generate-code` 側に持ち込むメリットが
   薄い (skill prompt サイズが膨らむだけ)

`/generate-code` skill の能力が「techStack に応じた componentized output 全 file 生成」に
収束しているため、競合は発生していない。両者の境界を明確に保つ。

## API

```ts
export function htmlToReact(html: string, componentName: string): {
  code: string;       // 生成された TSX (`export default function ${componentName}() { return (...); }` 形)
  warnings: string[]; // 変換不能だった属性 / 構造の警告
};
export function toPascalCase(str: string): string; // 画面名 → コンポーネント名変換
```

呼び出し元: `backend/src/handlers/screen.ts` の `case "designer__export_screen"`。

## 実装メモ

- htmlparser2 で DOM を walk、`ATTR_RENAME` テーブルで HTML → JSX 属性名変換
- 14 種のイベント属性 (`onclick`, `onchange`, ...) は `() => { /* USER_HANDLER */ }`
  形式の placeholder を残す (ユーザーが後でロジックを埋める)
- ISSUE #1147 S-19 で `/* TODO */` から `/* USER_HANDLER */` に rename し、汎用
  TODO grep のノイズを減らした
