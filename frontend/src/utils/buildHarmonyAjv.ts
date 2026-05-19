/**
 * buildHarmonyAjv.ts (#1188)
 *
 * Harmony 共通 AJV インスタンスを生成する helper。
 * `schemas/v3/README.md` L302 で documented されている設定を 1 箇所に集約し、
 * frontend 内 validator 群 (validateHarmony / genericDefinitionValidator 等) の drift を防ぐ。
 *
 * 規範設定:
 * - `strict: false` — schema 内 description / format 関連の warning を抑制
 * - `allErrors: true` — 違反を 1 件目で止めず全列挙
 * - `discriminator: true` — discriminator keyword 付き oneOf (BranchCondition / CdcDestination /
 *   Constraint / TestPrecondition / TestAssertion 等) で kind 単位の focused エラー報告 (#525 F-4)
 * - `addFormats(ajv)` — `date-time` / `uri` / `regex` 等の format 検証を有効化
 *
 * 呼出し側は本関数で得た ajv に対し `addSchema()` で必要な schema を登録し、
 * `compile()` で validator を取り出す。
 */

import Ajv2020 from "ajv/dist/2020";
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
