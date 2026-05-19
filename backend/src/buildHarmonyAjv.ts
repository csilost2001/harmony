/**
 * buildHarmonyAjv.ts (#1188)
 *
 * Harmony 共通 AJV インスタンスを生成する helper。
 * `schemas/v3/README.md` L302 で documented されている設定を 1 箇所に集約し、
 * backend 内 validator 群 (projectStorage / workspaceInit) の drift を防ぐ。
 *
 * 規範設定:
 * - `strict: false` — schema 内 description / format 関連の warning を抑制
 * - `allErrors: true` — 違反を 1 件目で止めず全列挙
 * - `discriminator: true` — discriminator keyword 付き oneOf (BranchCondition / CdcDestination /
 *   Constraint / TestPrecondition / TestAssertion 等) で kind 単位の focused エラー報告 (#525 F-4)
 * - `addFormats(ajv)` — `date-time` / `uri` / `regex` 等の format 検証を有効化
 *
 * frontend 側の同名 helper (`frontend/src/utils/buildHarmonyAjv.ts`) と同一設定。
 * monorepo package boundary 都合で frontend/backend に複製。
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function buildHarmonyAjv(): InstanceType<typeof Ajv2020> {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    discriminator: true,
  });
  addFormats(ajv);
  return ajv;
}
