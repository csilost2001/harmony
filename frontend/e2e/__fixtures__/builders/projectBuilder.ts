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
import { deterministicUuid } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

/**
 * `id` / `〜Id` 末尾の全フィールドを kebab-case 形式に正規化する。
 *
 * RFC #1284 (I-7): top-level entity の id は kebab-case (EntityId)。
 * テスト用の人間可読な id ("scr-1", "tbl-0001" 等) はそのまま kebab-case として通す。
 *
 * - immutable: 元 entities オブジェクトを変更しない
 * - passthrough: kebab-case pattern を満たす入力はそのまま、それ以外は normalizeId 経由で fallback
 * - 汎用的: 各 array の要素について `.id` + 末尾が `Id` のフィールドをすべて正規化
 */
const ENTITY_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * 任意 string を kebab-case EntityId に変換 (RFC #1284)。
 * 既に kebab-case を満たすならそのまま、それ以外は lowercase + 非英数 `-` 置換。
 * 他 builder からも import 可能。
 */
export function normalizeToKebabId(val: string): string {
  if (ENTITY_ID_RE.test(val)) return val;
  // UUID v4 等の任意 string を kebab-case に変換。lowercase、非英数を `-`、連続 / 末尾の `-` を整理。
  const slug = val
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ENTITY_ID_RE.test(slug) ? slug : `id-${slug || "auto"}`;
}

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
          normalized[field] = normalizeToKebabId(val);
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
  // RFC #1284: id は kebab-case EntityId、uuid は不変識別子 (UUID v4)。
  const id = opts.id
    ? (normalizeToKebabId(opts.id) as unknown as ProjectId)
    : ("test-project" as unknown as ProjectId);
  const uuid = opts.id
    // Round 6 Phase A: normalizeId は kebab-case 変換に責務移譲したため、UUID v4 生成は
    // deterministicUuid を使う (RFC #1284: EntityMeta.uuid 必須、cross-ref 用に決定論的)。
    ? (deterministicUuid(opts.id) as unknown as Uuid)
    : (crypto.randomUUID() as unknown as Uuid);

  const entities = opts.entities ? normalizeEntityIds(opts.entities) : {};

  return {
    $schema: "../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: opts.dataDir ?? "harmony",
    meta: {
      id: id as unknown as Uuid,
      uuid,
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
