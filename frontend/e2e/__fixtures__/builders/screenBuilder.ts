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
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

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
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as ScreenId)
    : (crypto.randomUUID() as unknown as ScreenId);

  return {
    $schema: "../../schemas/v3/screen.v3.schema.json",
    id,
    name: opts.name ?? "テスト画面",
    kind: opts.kind ?? "other",
    path: opts.path ?? "/test",
    groupId: opts.groupId
      ? (normalizeId(opts.groupId) as unknown as ScreenGroupId)
      : undefined,
    items: opts.items,
    maturity: opts.maturity ?? "draft",
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
