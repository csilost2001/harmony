import type { Locator, Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  repoPath,
  type OpenedWorkspace,
} from "./realWorkspace";
import { buildProject, buildScreen } from "../__fixtures__/builders";
import type { Harmony, HarmonyEntities, Screen, ScreenEntry, Timestamp } from "../../src/types/v3";
import fs from "node:fs/promises";
import path from "node:path";

// 元 spec で使用していた人間可読 id を維持。realWorkspace 経由では normalizeId で
// RFC #1284 / I-7 Round 6: top-level entity id は kebab-case EntityId、
// UUID-like 形式 (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
// は strict validator で reject されるため、被らない形に修正。
export const PUCK_SCREEN_ID = "puck-test-bootstrap-screen";
export const GJS_SCREEN_ID = "grapes-test-screen";
export const PUCK_TW_SCREEN_ID = "puck-test-tailwind-screen";
// 旧 spec が参照する FAKE_WS_ID は backend 経由ではダミー。互換のため export 維持。
export const FAKE_WS_ID = "00000000-e2e1-4000-8000-000000000814";

export const EMPTY_PUCK_DATA = {
  root: { props: {} },
  content: [],
};

export const PUCK_DATA_WITH_HEADING = {
  root: { props: {} },
  content: [
    {
      type: "Heading",
      props: { id: "heading-001", text: "こんにちは", level: "h2", align: "left", padding: "none", marginBottom: "md", colorAccent: "default" },
    },
  ],
};

export const HEADING_PARAGRAPH_DATA = {
  root: { props: {} },
  content: [
    {
      type: "Heading",
      props: { id: "heading-visual-001", text: "受注一覧", level: "h2", align: "left", padding: "none", marginBottom: "sm", colorAccent: "default" },
    },
    {
      type: "Paragraph",
      props: { id: "paragraph-visual-001", text: "本日の受注状況を確認し、必要な処理を実行します。", align: "left", padding: "none", marginBottom: "md", colorAccent: "default" },
    },
  ],
};

const EXTERNAL_DOGFOOD_FIXTURE_DIR = repoPath(
  "frontend",
  "src",
  "puck",
  "__tests__",
  "fixtures",
  "external-dogfood",
);

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

/** Puck 画面を含む最小プロジェクト (v3 形式) */
export function makeDummyProject(extraScreens: ScreenEntry[] = []): Harmony {
  return buildProject({
    name: "Puck E2E テスト用プロジェクト",
    techStack: { designer: { cssFramework: "bootstrap", editorKind: "puck" } },
    entities: {
      screens: [
        { id: PUCK_SCREEN_ID, no: 1, name: "Puck テスト画面 (Bootstrap)", kind: "other", path: "/puck-test", hasDesign: true, updatedAt: FIXED_TS },
        { id: GJS_SCREEN_ID, no: 2, name: "GrapesJS テスト画面", kind: "other", path: "/gjs-test", hasDesign: true, updatedAt: FIXED_TS },
        { id: PUCK_TW_SCREEN_ID, no: 3, name: "Puck Tailwind テスト画面", kind: "other", path: "/puck-tw-test", hasDesign: true, updatedAt: FIXED_TS },
        ...extraScreens,
      ],
    } as HarmonyEntities,
  });
}

/** screen entity (harmony/screens/<id>.json) を生成する */
export function makeScreenEntity(
  screenId: string,
  name: string,
  kind: string,
  path: string,
  editorKind: "puck" | "grapesjs",
  cssFramework: "bootstrap" | "tailwind",
): Screen {
  const base = buildScreen({ id: screenId, name, kind: kind as NonNullable<Parameters<typeof buildScreen>[0]>["kind"], path });
  return {
    ...base,
    items: [],
    design: {
      editorKind,
      cssFramework,
      ...(editorKind === "puck" ? { puckDataRef: "puck-data.json" } : { designFileRef: `${screenId}.design.json` }),
    },
  };
}

/** legacy: 旧 spec が参照していた MCP bypass。realWorkspace 移植後は no-op (互換維持) */
export async function installPuckMcpBypass(page: Page): Promise<void> {
  // realWorkspace 経由では backend 接続が前提なので bypass しない。互換のため no-op で残す。
  void page;
}

export interface SetupPuckOptions {
  screenId?: string;
  puckData?: object;
  cssFramework?: "bootstrap" | "tailwind";
  /** 内部使用: backend 起動済かどうか (test.skip 用) */
  _wsKey?: string;
}

/** Puck data を backend canonical path (`harmony/screens/<id>/puck-data.json`) に seed する。 */
export async function writePuckDataFile(
  ws: OpenedWorkspace,
  screenId: string,
  puckData: object,
): Promise<void> {
  const screenIdNorm = normalizeId(screenId);
  const file = path.join(ws.workspacePath, "harmony", "screens", screenIdNorm, "puck-data.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(puckData, null, 2), "utf-8");
}

/**
 * 外部 Puck Component dogfood fixture を workspace asset 配信 path に seed する。
 * backend は `<dataRoot>/puck-components/` を `/workspace-assets/<wsId>/puck-components/` として配信する。
 */
export async function seedExternalPuckComponentFixture(
  ws: OpenedWorkspace,
  opts: { manifest?: object } = {},
): Promise<void> {
  const targetDir = path.join(ws.workspacePath, "harmony", "puck-components");
  const distDir = path.join(targetDir, "dist");
  await fs.mkdir(distDir, { recursive: true });

  if (opts.manifest) {
    await fs.writeFile(
      path.join(targetDir, "manifest.json"),
      JSON.stringify(opts.manifest, null, 2),
      "utf-8",
    );
  } else {
    await fs.copyFile(
      path.join(EXTERNAL_DOGFOOD_FIXTURE_DIR, "manifest.json"),
      path.join(targetDir, "manifest.json"),
    );
  }

  await fs.copyFile(
    path.join(EXTERNAL_DOGFOOD_FIXTURE_DIR, "approval-status-bar.mjs"),
    path.join(distDir, "approval-status-bar.mjs"),
  );
}

let _wsCache: OpenedWorkspace | null = null;
const _wsKeysToCleanup = new Set<string>();

export async function setupPuckScreen(
  page: Page,
  {
    screenId = PUCK_SCREEN_ID,
    puckData = EMPTY_PUCK_DATA,
    cssFramework = "bootstrap",
    _wsKey = "issue-926-puck",
  }: SetupPuckOptions = {},
): Promise<void> {
  const screenIdNorm = normalizeId(screenId);
  const screenEntity = makeScreenEntity(
    screenIdNorm,
    cssFramework === "tailwind" ? "Puck Tailwind テスト" : "Puck テスト",
    "other",
    "/puck-test",
    "puck",
    cssFramework,
  );
  const ws = await setupTestWorkspace({
    key: _wsKey,
    project: makeDummyProject(),
    screenEntities: [screenEntity],
  });
  _wsCache = ws;
  _wsKeysToCleanup.add(_wsKey);
  await writePuckDataFile(ws, screenIdNorm, puckData);

  await ws.gotoActive(page as unknown as Parameters<typeof ws.gotoActive>[0], `/screen/design/${screenIdNorm}`);
}

/** test.afterAll() から呼んで puck テストの workspace を全件 cleanup */
export async function cleanupPuckWorkspaces(): Promise<void> {
  if (_wsKeysToCleanup.size > 0) {
    await cleanupRealWorkspaces([..._wsKeysToCleanup]);
    _wsKeysToCleanup.clear();
    _wsCache = null;
  }
}

export function isPuckMcpRunning(): Promise<boolean> {
  return isMcpRunning();
}

export function getPuckContainer(page: Page): Locator {
  return page.locator("[data-testid='puck-editor-container']");
}

export function getPlacedPrimitive(page: Page, name: string): Locator {
  return page.locator(`[data-testid='puck-primitive-${name}']`);
}

export function getPaletteItem(page: Page, label: string): Locator {
  return page.getByRole("button", { name: label, exact: true }).first();
}

export async function dragPrimitiveTo(
  page: Page,
  paletteLabel: string,
  targetSelector: string,
): Promise<void> {
  const paletteItem = getPaletteItem(page, paletteLabel);
  const target = page.locator(targetSelector).first();
  await paletteItem.waitFor({ state: "visible", timeout: 10000 });
  await target.waitFor({ state: "visible", timeout: 10000 });

  const sourceBox = await paletteItem.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error(`DnD target not measurable: ${paletteLabel} -> ${targetSelector}`);
  }

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + Math.min(targetBox.height / 2, 260);

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(
      sourceX + ((targetX - sourceX) * i) / 10,
      sourceY + ((targetY - sourceY) * i) / 10,
    );
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * dnd-kit の KeyboardSensor 経路で primitive を palette から canvas に配置する。
 * mouse-based の dragPrimitiveTo は MouseEvent しか発火せず PointerSensor を活性化できない。
 * KeyboardSensor は dnd-kit のデフォルト sensor (accessibility 機能):
 *   - paletteItem に focus
 *   - Space で pickup
 *   - 矢印キーで移動
 *   - Space で drop
 */
export async function dragPrimitiveByKeyboard(
  page: Page,
  paletteLabel: string,
  moveSteps: number = 5,
): Promise<void> {
  const paletteItem = getPaletteItem(page, paletteLabel);
  await paletteItem.waitFor({ state: "visible", timeout: 10000 });
  await paletteItem.focus();
  await page.waitForTimeout(100);
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  for (let i = 0; i < moveSteps; i += 1) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
}

export async function selectPlacedPrimitive(page: Page, name: string): Promise<void> {
  await getPlacedPrimitive(page, name).first().click();
  await page.waitForTimeout(300);
}

export async function setPuckFieldText(page: Page, fieldLabel: string, value: string): Promise<void> {
  const input = page
    .locator(`xpath=//label[contains(normalize-space(.), "${fieldLabel}")]/following-sibling::*//input | //label[contains(normalize-space(.), "${fieldLabel}")]/following-sibling::input`)
    .first();
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill(value);
  await input.blur();
}

export async function setPuckFieldSelect(page: Page, fieldLabel: string, value: string): Promise<void> {
  const select = page
    .locator(`xpath=//label[contains(normalize-space(.), "${fieldLabel}")]/following-sibling::*//select | //label[contains(normalize-space(.), "${fieldLabel}")]/following-sibling::select`)
    .first();
  await select.waitFor({ state: "visible", timeout: 5000 });
  await select.selectOption(value);
}

// Suppress unused-warning by re-exporting cache (used by some specs)
export { _wsCache };
