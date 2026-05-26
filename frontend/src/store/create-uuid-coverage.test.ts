/**
 * I-7 Round 8 S-R7-1 (#1299 Codex Should-fix): 各 entity の create 関数が
 * uuid field (UUID v4) を発番することを保証する回帰テスト。
 *
 * RFC #1284 Phase B で導入した「id (kebab-case) と uuid (UUID v4) の 2 フィールド」
 * モデルが create path で確実に履行されることを ID-Refactor 後も担保する。
 *
 * 既存:
 *   - flowStore.roundtrip.test.ts:147,255 → meta.uuid (Project)
 *   - tableStore.test.ts:117 → existing fixture
 *   - viewDefinitionStore.test.ts:122 (Round 8 で追加)
 *
 * 本ファイル:
 *   - createTable / createSequence / createView / createPageLayout / createProcessFlow
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type {
  DisplayName,
  PhysicalName,
  ProcessFlowType,
  ScreenId,
  Timestamp,
} from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import { setScreenFlowPositionsStorageBackend } from "./screenFlowPositionsStore";
import { createTable, setTableStorageBackend } from "./tableStore";
import { createSequence, setSequenceStorageBackend } from "./sequenceStore";
import { createView, setViewStorageBackend } from "./viewStore";
import { createPageLayout, setPageLayoutStorageBackend } from "./pageLayoutStore";
import { createProcessFlow, setProcessFlowStorageBackend } from "./processFlowStore";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TS = "2026-05-26T00:00:00.000Z" as Timestamp;

function emptyProject(): FlowProject {
  return { version: 1, name: "t", screens: [], groups: [], edges: [], updatedAt: TS };
}

function setupMockBackends() {
  const flowBackend: FlowStorageBackend = {
    loadProject: vi.fn().mockResolvedValue(emptyProject()),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteScreenData: vi.fn().mockResolvedValue(undefined),
  };
  setFlowStorageBackend(flowBackend);
  setScreenFlowPositionsStorageBackend({
    loadScreenFlowPositions: vi.fn().mockResolvedValue(null),
    saveScreenFlowPositions: vi.fn().mockResolvedValue(undefined),
  });
  setTableStorageBackend({
    loadTable: vi.fn().mockResolvedValue(null),
    saveTable: vi.fn().mockResolvedValue(undefined),
    deleteTable: vi.fn().mockResolvedValue(undefined),
  });
  setSequenceStorageBackend({
    loadSequence: vi.fn().mockResolvedValue(null),
    saveSequence: vi.fn().mockResolvedValue(undefined),
    deleteSequence: vi.fn().mockResolvedValue(undefined),
  });
  setViewStorageBackend({
    loadView: vi.fn().mockResolvedValue(null),
    saveView: vi.fn().mockResolvedValue(undefined),
    deleteView: vi.fn().mockResolvedValue(undefined),
  });
  setPageLayoutStorageBackend({
    loadPageLayout: vi.fn().mockResolvedValue(null),
    savePageLayout: vi.fn().mockResolvedValue(undefined),
    deletePageLayout: vi.fn().mockResolvedValue(undefined),
  });
  setProcessFlowStorageBackend({
    loadProcessFlow: vi.fn().mockResolvedValue(null),
    saveProcessFlow: vi.fn().mockResolvedValue(undefined),
    deleteProcessFlow: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof setProcessFlowStorageBackend>[0]);
  setFlowDraftMode(false);
  localStorage.clear();
}

beforeEach(() => {
  setupMockBackends();
});

describe("create function uuid coverage (I-7 Round 8 S-R7-1)", () => {
  it("createTable は uuid (UUID v4) を発番する", async () => {
    const t = await createTable(
      "orders" as PhysicalName,
      "受注" as DisplayName,
      undefined,
      undefined,
      { id: "order-test" },
    );
    expect(t.uuid).toBeDefined();
    expect(typeof t.uuid).toBe("string");
    expect(t.uuid).toMatch(UUID_V4_RE);
  });

  it("createSequence は uuid (UUID v4) を発番する", async () => {
    const seq = await createSequence(
      "seq_orders" as PhysicalName,
      "注文番号採番" as DisplayName,
      undefined,
      { id: "seq-orders-test" },
    );
    expect(seq.uuid).toBeDefined();
    expect(seq.uuid).toMatch(UUID_V4_RE);
  });

  it("createView は uuid (UUID v4) を発番する", async () => {
    const v = await createView(
      "v_active_orders" as PhysicalName,
      "アクティブ受注" as DisplayName,
      undefined,
      { id: "v-active-orders-test" },
    );
    expect(v.uuid).toBeDefined();
    expect(v.uuid).toMatch(UUID_V4_RE);
  });

  it("createPageLayout は uuid (UUID v4) を発番する", async () => {
    const pl = await createPageLayout(
      "標準レイアウト" as DisplayName,
      "puck",
      "bootstrap",
      undefined,
      { id: "pl-standard-test" },
    );
    expect(pl.uuid).toBeDefined();
    expect(pl.uuid).toMatch(UUID_V4_RE);
  });

  it("createProcessFlow は meta.uuid (UUID v4) を発番する", async () => {
    const pf = await createProcessFlow(
      "Order Process",
      "business" as ProcessFlowType,
      undefined as ScreenId | undefined,
      undefined,
      { id: "pf-order-test" },
    );
    expect(pf.meta.uuid).toBeDefined();
    expect(pf.meta.uuid).toMatch(UUID_V4_RE);
  });
});
