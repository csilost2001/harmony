import type { Locator, Page } from "@playwright/test";

export const FAKE_WS_ID = "e2e-fake-ws-aaaaaaaaaaaaaaaaa";
export const PUCK_SCREEN_ID = "puck-test-0001-4000-8000-aaaaaaaaaaaa";
export const GJS_SCREEN_ID = "grapes-test-0002-4000-8000-bbbbbbbbbbbb";
export const PUCK_TW_SCREEN_ID = "puck-tw-test-0003-4000-8000-cccccccccccc";

export const EMPTY_PUCK_DATA = {
  root: { props: {} },
  content: [],
};

export const PUCK_DATA_WITH_HEADING = {
  root: { props: {} },
  content: [
    {
      type: "Heading",
      props: {
        id: "heading-001",
        text: "こんにちは",
        level: "h2",
        align: "left",
        padding: "none",
        marginBottom: "md",
        colorAccent: "default",
      },
    },
  ],
};

export const HEADING_PARAGRAPH_DATA = {
  root: { props: {} },
  content: [
    {
      type: "Heading",
      props: {
        id: "heading-visual-001",
        text: "受注一覧",
        level: "h2",
        align: "left",
        padding: "none",
        marginBottom: "sm",
        colorAccent: "default",
      },
    },
    {
      type: "Paragraph",
      props: {
        id: "paragraph-visual-001",
        text: "本日の受注状況を確認し、必要な処理を実行します。",
        align: "left",
        padding: "none",
        marginBottom: "md",
        colorAccent: "default",
      },
    },
  ],
};

/** Puck 画面を含む最小プロジェクト (v3 schema 形式) */
export function makeDummyProject(screenOverrides: object[] = []) {
  const now = new Date().toISOString();
  return {
    $schema: "../../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
    meta: {
      id: "e2e-puck-test-0000-4000-8000-000000000000",
      name: "Puck E2E テスト用プロジェクト",
      createdAt: now,
      updatedAt: now,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    techStack: {
      designer: {
        cssFramework: "bootstrap",
        editorKind: "puck",
      },
    },
    entities: {
      screens: [
        {
          id: PUCK_SCREEN_ID,
          no: 1,
          name: "Puck テスト画面 (Bootstrap)",
          kind: "other",
          path: "/puck-test",
          maturity: "draft",
          updatedAt: now,
        },
        {
          id: GJS_SCREEN_ID,
          no: 2,
          name: "GrapesJS テスト画面",
          kind: "other",
          path: "/gjs-test",
          maturity: "draft",
          updatedAt: now,
        },
        {
          id: PUCK_TW_SCREEN_ID,
          no: 3,
          name: "Puck Tailwind テスト画面",
          kind: "other",
          path: "/puck-tw-test",
          maturity: "draft",
          updatedAt: now,
        },
        ...screenOverrides,
      ],
      screenGroups: [],
      screenTransitions: [],
      tables: [],
      processFlows: [],
      views: [],
      viewDefinitions: [],
      sequences: [],
    },
  };
}

/** screen entity (localStorage: v3-screen-<id>) を生成する */
export function makeScreenEntity(
  screenId: string,
  name: string,
  kind: string,
  path: string,
  editorKind: "puck" | "grapesjs",
  cssFramework: "bootstrap" | "tailwind",
) {
  const now = new Date().toISOString();
  return {
    $schema: "../schemas/v3/screen.v3.schema.json",
    id: screenId,
    name,
    createdAt: now,
    updatedAt: now,
    kind,
    path,
    items: [],
    design: {
      editorKind,
      cssFramework,
      ...(editorKind === "puck"
        ? { puckDataRef: "puck-data.json" }
        : { designFileRef: `${screenId}.design.json` }),
    },
  };
}

/**
 * MCP WebSocket 接続を確実に CLOSED にする init script を仕掛ける。
 *
 * `workspace-e2e-bypass=true` の localStorage flag だけでは、AppShell が
 * MCP 接続待ちで spinner のまま止まり Designer が mount されないケースがある
 * (test 5 混在シナリオで pre-existing failure を確認、#814 で吸収)。
 * ClosedWebSocket 偽実装で同期的に CLOSED 状態に落とすことで workspaceState を
 * error に進め、localStorage fallback を必ず発火させる。
 */
export async function installPuckMcpBypass(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class ClosedWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState = ClosedWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor() {
        super();
        window.setTimeout(() => {
          this.readyState = ClosedWebSocket.CLOSED;
          const event = new CloseEvent("close");
          this.dispatchEvent(event);
          this.onclose?.(event);
        }, 0);
      }

      send(): void {
        throw new Error("E2E Puck tests use localStorage fallback");
      }

      close(): void {
        this.readyState = ClosedWebSocket.CLOSED;
      }
    }

    window.WebSocket = ClosedWebSocket as unknown as typeof WebSocket;
    localStorage.setItem("workspace-e2e-bypass", "true");
  });
}

export interface SetupPuckOptions {
  screenId?: string;
  puckData?: object;
  cssFramework?: "bootstrap" | "tailwind";
}

export async function setupPuckScreen(
  page: Page,
  {
    screenId = PUCK_SCREEN_ID,
    puckData = EMPTY_PUCK_DATA,
    cssFramework = "bootstrap",
  }: SetupPuckOptions = {},
): Promise<void> {
  const project = makeDummyProject();
  const tab = {
    id: `design:${screenId}`,
    type: "design",
    resourceId: screenId,
    label: cssFramework === "tailwind" ? "Puck Tailwind テスト" : "Puck テスト",
    isDirty: false,
    isPinned: false,
  };
  const screenEntity = makeScreenEntity(
    screenId,
    tab.label,
    "other",
    "/puck-test",
    "puck",
    cssFramework,
  );

  await installPuckMcpBypass(page);
  await page.addInitScript(
    ({ proj, tabData, pData, localKey, entity, entityKey }) => {
      localStorage.setItem("flow-project", JSON.stringify(proj));
      localStorage.setItem("designer-open-tabs", JSON.stringify([tabData]));
      localStorage.setItem("designer-active-tab", tabData.id);
      localStorage.setItem(localKey, JSON.stringify(pData));
      localStorage.setItem(entityKey, JSON.stringify(entity));
    },
    {
      proj: project,
      tabData: tab,
      pData: puckData,
      localKey: `puck-data-${screenId}`,
      entity: screenEntity,
      entityKey: `v3-screen-${screenId}`,
    },
  );

  await page.goto(`/w/${FAKE_WS_ID}/screen/design/${screenId}`);
}

export function getPuckContainer(page: Page): Locator {
  return page.locator("[data-testid='puck-editor-container']");
}

export function getPlacedPrimitive(page: Page, name: string): Locator {
  return page.locator(`[data-testid='puck-primitive-${name}']`);
}

/**
 * Puck 左パレットの component item locator。
 *
 * Puck の DOM 実装メモ (v0.x):
 *  - `draggable="true"` 属性は使わない (dnd-kit は pointer events)
 *  - 各 item は CSS module hash class `_DrawerItem_xxxx_yy` を持つ
 *  - role="button" + accessible name (label) で安定アクセス可能
 */
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
