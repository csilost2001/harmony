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
    entities: opts.entities ?? {},
    techStack: opts.techStack,
  };
}
