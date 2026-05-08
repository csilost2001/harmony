/**
 * v3 Project builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - maturity: "draft"
 * - schemaVersion: "v3"
 */

import type {
  ExtensionApplied,
  Maturity,
  Mode,
  Project,
  ProjectEntities,
  ProjectId,
  ProjectTechStack,
  Timestamp,
  Uuid,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

/**
 * `id` / `〜Id` 末尾の全フィールドを normalizeId() で UUID v4 に正規化する。
 *
 * harmony.v3.schema.json が UUID v4 pattern を strict 検証するため、
 * テスト用の人間可読な id ("scr-1", "tbl-0001" 等) をそのまま渡すと
 * backend が "harmony.json が不正です" で reject する (#959 修正6)。
 *
 * - immutable: 元 entities オブジェクトを変更しない
 * - 決定論的: 同じ input から常に同じ UUID が生成される (cross-reference 安全)
 * - 汎用的: 各 array の要素について `.id` + 末尾が `Id` のフィールドをすべて正規化
 */
function normalizeEntityIds(entities: ProjectEntities): ProjectEntities {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (!Array.isArray(value)) {
      result[key] = value;
      continue;
    }
    result[key] = value.map((item: Record<string, unknown>) => {
      const normalized: Record<string, unknown> = {};
      for (const [field, val] of Object.entries(item)) {
        if (typeof val === "string" && (field === "id" || field.endsWith("Id"))) {
          normalized[field] = normalizeId(val);
        } else {
          normalized[field] = val;
        }
      }
      return normalized;
    });
  }
  return result as ProjectEntities;
}

export interface BuildProjectOpts {
  id?: string;
  name?: string;
  dataDir?: string;
  mode?: Mode;
  maturity?: Maturity;
  entities?: ProjectEntities;
  techStack?: ProjectTechStack;
  extensionsApplied?: ExtensionApplied[];
}

export function buildProject(opts: BuildProjectOpts = {}): Project {
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as ProjectId)
    : (crypto.randomUUID() as unknown as ProjectId);

  const entities = opts.entities ? normalizeEntityIds(opts.entities) : {};

  return {
    $schema: "../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: opts.dataDir ?? "harmony",
    meta: {
      id: id as unknown as Uuid,
      name: opts.name ?? "テストプロジェクト",
      maturity: opts.maturity ?? "draft",
      createdAt: FIXED_TS,
      updatedAt: FIXED_TS,
      mode: opts.mode,
    },
    extensionsApplied: opts.extensionsApplied ?? [],
    entities,
    techStack: opts.techStack,
  };
}
