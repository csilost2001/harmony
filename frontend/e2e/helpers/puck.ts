import type { Locator, Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./realWorkspace";
import { buildProject, buildScreen } from "../__fixtures__/builders";
import type { Project, ProjectEntities, Screen, ScreenEntry, Timestamp } from "../../src/types/v3";
import fs from "node:fs/promises";
import path from "node:path";

// 元 spec で使用していた人間可読 id を維持。realWorkspace 経由では normalizeId で
// UUID v4 に正規化される (harmony.v3 schema 準拠)。
export const PUCK_SCREEN_ID = "puck-test-0001-4000-8000-aaaaaaaaaaaa";
export const GJS_SCREEN_ID = "grapes-test-0002-4000-8000-bbbbbbbbbbbb";
export const PUCK_TW_SCREEN_ID = "puck-tw-test-0003-4000-8000-cccccccccccc";
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

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

/** Puck 画面を含む最小プロジェクト (v3 形式) */
export function makeDummyProject(extraScreens: ScreenEntry[] = []): Project {
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
    } as ProjectEntities,
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
  const base = buildScreen({ id: screenId, name, kind: kind as Parameters<typeof buildScreen>[0]["kind"], path });
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
  // Puck data は harmony/screens/<id>.design.json に書き出す
  const file = path.join(ws.workspacePath, "harmony", "screens", `${screenIdNorm}.design.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(puckData, null, 2), "utf-8");

  await page.addInitScript((tabData) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tabData]));
    localStorage.setItem("harmony-active-tab", tabData.id);
  }, {
    id: `design:${screenIdNorm}`,
    type: "design",
    resourceId: screenIdNorm,
    label: cssFramework === "tailwind" ? "Puck Tailwind テスト" : "Puck テスト",
    isDirty: false,
    isPinned: false,
  });

  await ws.gotoActive(page, `/screen/design/${screenIdNorm}`);
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
