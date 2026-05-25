/**
 * v3 Screen builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - maturity: "draft"
 * - kind: "other"
 * - path: "/test"
 */

import type {
  Maturity,
  Screen,
  ScreenGroupId,
  ScreenId,
  ScreenItem,
  ScreenKind,
  Timestamp,
  Uuid,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";
import { normalizeToKebabId } from "./projectBuilder";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildScreenOpts {
  id?: string;
  name?: string;
  kind?: ScreenKind;
  path?: string;
  groupId?: string;
  items?: ScreenItem[];
  maturity?: Maturity;
}

export function buildScreen(opts: BuildScreenOpts = {}): Screen {
  // RFC #1284: id は kebab-case EntityId、uuid は不変識別子 (UUID v4)。
  const id = opts.id
    ? (normalizeToKebabId(opts.id) as unknown as ScreenId)
    : ("test-screen" as unknown as ScreenId);
  const uuid = opts.id
    ? (normalizeId(opts.id) as unknown as Uuid)
    : (crypto.randomUUID() as unknown as Uuid);

  return {
    $schema: "../../schemas/v3/screen.v3.schema.json",
    id,
    uuid,
    name: opts.name ?? "テスト画面",
    kind: opts.kind ?? "other",
    path: opts.path ?? "/test",
    groupId: opts.groupId
      ? (normalizeToKebabId(opts.groupId) as unknown as ScreenGroupId)
      : undefined,
    items: opts.items,
    maturity: opts.maturity ?? "draft",
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
