/**
 * テストフィクスチャ用の brand cast helper (#1355)。
 *
 * v3 schema 由来の branded types (`LocalId` / `Identifier` / `EntityId` / `Uuid` 等) は
 * 構造的に `string & { readonly __brand: ... }` のため、リテラル `string` を直接代入できない。
 * テストフィクスチャでは値の中身よりも shape の組み立てが重要なため、本 helper で
 * `as unknown as Brand` の冗長記述を 1 行に圧縮する。
 *
 * 本 module は test (`*.test.ts` / `*.test.tsx`) 専用。production code から import 禁止。
 */

/**
 * 任意の string literal を任意の branded type にキャストする (テスト fixture 専用)。
 *
 * @example
 *   const id = b<LocalId>("step-1");
 *   const sid = b<ScreenId>("screen-001");
 */
export function b<T>(value: string): T {
  return value as unknown as T;
}

/**
 * fixture object を任意の type にキャストする (テスト fixture 専用)。
 * builder 関数で literal を組み立てた後に望みの型 (`ProcessFlow` / `Screen` 等) として返却する用途。
 *
 * @example
 *   function makeFlow(partial: unknown): ProcessFlow {
 *     return fixture<ProcessFlow>({ meta: ..., actions: [], ...partial as object });
 *   }
 */
export function fixture<T>(obj: unknown): T {
  return obj as unknown as T;
}

/**
 * テスト fixture 用に branded string array を作成する。
 *
 * @example
 *   const ids = bs<LocalId>(["a", "b", "c"]);
 */
export function bs<T>(values: string[]): T[] {
  return values as unknown as T[];
}
