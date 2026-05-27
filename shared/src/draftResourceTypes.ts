/**
 * DRAFT_RESOURCE_TYPES — frontend / backend / MCP / WS の単一 source-of-truth (#1375)
 *
 * 本配列 1 箇所の更新で以下すべてが追従する:
 *   - `DraftResourceType` (TypeScript union 型) — backend / frontend 双方が同型を共有
 *   - `VALID_RESOURCE_TYPES` (runtime allowlist `ReadonlySet<DraftResourceType>`) — backend WS / MCP handler が import
 *   - MCP `editSession__*` tool schema の `resourceType.enum` — backend `tools.ts` が `[...DRAFT_RESOURCE_TYPES]` で参照
 *
 * 経緯:
 *   - PR #1372 → #1376 (#1374) で backend 内の 4 表現 (型 union / WS Set / MCP allowlist / MCP tool enum) を本配列起点に集約。
 *   - 同 PR では frontend 側 `frontend/src/types/draft.ts` の手書き union 型重複を残しており、
 *     `as const` 配列 + `typeof[number]` で導出するパターンを採用しても backend と完全に同期できなかった。
 *   - #1375 で `@harmony/shared` package (npm workspaces) を新設し、本ファイルを唯一の定義ファイルとして
 *     frontend / backend の両方が同じモジュールから import する経路を確立した。
 *
 * 新 resource type を追加する手順:
 *   1. 本配列に kebab-case literal を追加 (末尾 comma 必須、コメントで根拠 ISSUE 番号を残す)
 *   2. backend / frontend の各 build で型エラーが出る箇所を順に対応 (switch 分岐 / Map 等)
 *   3. 必要に応じて `backend/src/wsHandlers/editSession.ts` や `backend/src/tools.ts` 等の
 *      handler 側 routing を追加 (allowlist 自体はここから自動導出)
 */
export const DRAFT_RESOURCE_TYPES = [
  "screen",
  "puck-data",
  "table",
  "process-flow",
  "view",
  "view-definition",
  "page-layout",
  "screen-item",
  "sequence",
  "extension",
  "convention",
  "flow",
  "er-layout",
  "generic-definition", // #1331: GenericDefinition EditSession 化 (kind/name 複合 id)
] as const;

export type DraftResourceType = typeof DRAFT_RESOURCE_TYPES[number];
