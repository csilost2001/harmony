#!/usr/bin/env node
/**
 * examples/<project-id>/ 形式 (examples/retail 等) を 1 プロジェクトとして検証するスクリプト (#709)。
 * process-flows/ ディレクトリ命名と conventions/catalog.json 配置に対応したプロジェクト単位検証スクリプト。
 * examples/<project-id>/ を canonical サンプル領域として検証する (#774)。
 *
 * 使用法:
 *   cd frontend && npm run validate:samples -- ../data
 *   cd frontend && npm run validate:samples -- ../examples/retail
 *
 * 終了コード: 0 = pass, 1 = fail
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { ProcessFlow } from "../src/types/action.js";
import { checkSqlColumns, type TableDefinition } from "../src/schemas/sqlColumnValidator.js";
import { checkSqlOrder, type OrderTableDefinition } from "../src/schemas/sqlOrderValidator.js";
import { checkConventionReferences, type ConventionsCatalog } from "../src/schemas/conventionsValidator.js";
import { checkReferentialIntegrity } from "../src/schemas/referentialIntegrity.js";
import { checkIdentifierScopes } from "../src/schemas/identifierScope.js";
import { checkScreenItemFlowConsistency } from "../src/schemas/screenItemFlowValidator.js";
import { checkScreenItemFieldTypeConsistency } from "../src/schemas/screenItemFieldTypeValidator.js";
import { checkScreenItemRefKeyConsistency } from "../src/schemas/screenItemRefKeyValidator.js";
import { checkViewDefinitions } from "../src/schemas/viewDefinitionValidator.js";
import { checkScreenNavigation } from "../src/schemas/screenNavigationValidator.js";
import { resolveScreenItemRefs } from "../src/schemas/screenItemRefResolver.js";
import { loadExtensionsFromBundle, type ExtensionsBundle, type LoadedExtensions } from "../src/schemas/loadExtensions.js";
import { checkAntipatterns } from "../src/schemas/processFlowAntipatternValidator.js";
import type { Screen } from "../src/types/v3/screen.js";
import type { Conventions } from "../src/types/v3/conventions.js";
import type { ViewDefinition } from "../src/types/v3/view-definition.js";
import type { ScreenTransitionEntry } from "../src/types/v3/project.js";

const designerDir = resolve(__dirname, "..");
const repoRoot = resolve(designerDir, "..");

interface ProjectResources {
  projectId: string;
  displayName: string;
  projectDir: string;
  tables: TableDefinition[];
  conventions: ConventionsCatalog | null;
  conventionsV3: Conventions | null;
  screens: Screen[];
  viewDefinitions: ViewDefinition[];
  screenTransitions: ScreenTransitionEntry[];
  flowsDir: string;
}

interface ValidationIssue {
  validator: string;
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

interface FlowValidationResult {
  filePath: string;
  displayName: string;
  projectId: string;
  issues: ValidationIssue[];
}

interface ProjectValidationResult {
  projectId: string;
  displayName: string;
  issues: ValidationIssue[];
}

export interface ValidationSummary {
  totalFlows: number;
  passedFlows: number;
  failedFlows: number;
  results: FlowValidationResult[];
  projectResults: ProjectValidationResult[];
  projectCount: number;
  totalTableCount: number;
  totalConventionsCount: number;
  totalScreenCount: number;
  totalViewDefinitionCount: number;
  extensionFileCount: number;
}

function loadTablesFromDir(dir: string): TableDefinition[] {
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as TableDefinition);
  } catch {
    return [];
  }
}

function loadConventionsFromFile(filePath: string): ConventionsCatalog | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ConventionsCatalog;
  } catch {
    return null;
  }
}

function loadScreensFromDir(dir: string): Screen[] {
  if (!existsSync(dir)) return [];
  try {
    // `.design.json` は GrapesJS 状態ファイルのため除外 (Screen 定義ではない)
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".design.json"));
    return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as Screen);
  } catch {
    return [];
  }
}

function loadViewDefinitionsFromDir(dir: string): ViewDefinition[] {
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as ViewDefinition);
  } catch {
    return [];
  }
}

function loadScreenTransitionsFromProjectJson(projectDir: string): ScreenTransitionEntry[] {
  const filePath = join(projectDir, "project.json");
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { entities?: { screenTransitions?: ScreenTransitionEntry[] } };
    return raw.entities?.screenTransitions ?? [];
  } catch {
    return [];
  }
}

function discoverProject(projectDirArg: string): ProjectResources {
  const projectDir = isAbsolute(projectDirArg) ? projectDirArg : resolve(process.cwd(), projectDirArg);
  const stat = statSync(projectDir);
  if (!stat.isDirectory()) {
    throw new Error(`対象パスはディレクトリではありません: ${projectDir}`);
  }
  const projectId = basename(projectDir);
  const displayName = relative(repoRoot, projectDir).replace(/\\/g, "/") || ".";
  const conventions = loadConventionsFromFile(join(projectDir, "conventions", "catalog.json"));
  return {
    projectId,
    displayName,
    projectDir,
    tables: loadTablesFromDir(join(projectDir, "tables")),
    conventions,
    conventionsV3: conventions as Conventions | null,
    screens: loadScreensFromDir(join(projectDir, "screens")),
    viewDefinitions: loadViewDefinitionsFromDir(join(projectDir, "view-definitions")),
    screenTransitions: loadScreenTransitionsFromProjectJson(projectDir),
    flowsDir: join(projectDir, "process-flows"),
  };
}

function loadExtensions(projectDir: string): { extensions: LoadedExtensions; fileCount: number } {
  let fileCount = 0;
  const bundle: {
    steps: { namespace: string; steps: Record<string, unknown> };
    fieldTypes: { namespace: string; fieldTypes: unknown[] };
    triggers: { namespace: string; triggers: unknown[] };
    dbOperations: { namespace: string; dbOperations: unknown[] };
    responseTypes: { namespace: string; responseTypes: Record<string, unknown> };
  } = {
    steps: { namespace: "", steps: {} },
    fieldTypes: { namespace: "", fieldTypes: [] },
    triggers: { namespace: "", triggers: [] },
    dbOperations: { namespace: "", dbOperations: [] },
    responseTypes: { namespace: "", responseTypes: {} },
  };

  const extDir = join(projectDir, "extensions");
  if (existsSync(extDir)) {
    const allFiles = readdirSync(extDir, { recursive: true })
      .filter((f): f is string => typeof f === "string" && f.endsWith(".json"));
    for (const file of allFiles) {
      const fullPath = join(extDir, file);
      try {
        const raw = JSON.parse(readFileSync(fullPath, "utf-8")) as Record<string, unknown>;
        fileCount++;

        // v3 canonical combined format: <namespace>.v3.json
        // 1 namespace = 1 ファイルで全拡張種別を含む形式 (schemas/v3/extensions.v3.schema.json)
        // bundle の各種別に { namespace, <bodyKey>: [...] } 形式で分解して積む。
        // namespace プレフィックスは loadExtensionsFromBundle 内の load* 関数が付与するため、
        // ここでは付与しない (二重プレフィックス回避)。
        if (basename(file).endsWith(".v3.json")) {
          const namespace = typeof raw.namespace === "string" ? raw.namespace : "";
          if (namespace) {
            bundle.fieldTypes.namespace = namespace;
            bundle.triggers.namespace = namespace;
            bundle.dbOperations.namespace = namespace;
            bundle.steps.namespace = namespace;
            bundle.responseTypes.namespace = namespace;
          }
          if (Array.isArray(raw.fieldTypes)) bundle.fieldTypes.fieldTypes.push(...raw.fieldTypes);
          // v3 schema では actionTriggers キーを使用 (TriggerDef 配列)
          if (Array.isArray(raw.actionTriggers)) bundle.triggers.triggers.push(...raw.actionTriggers);
          if (Array.isArray(raw.dbOperations)) bundle.dbOperations.dbOperations.push(...raw.dbOperations);
          if (raw.stepKinds && typeof raw.stepKinds === "object" && !Array.isArray(raw.stepKinds)) {
            // stepKinds は Record — load* が namespace prefix を付けるため ここでは raw.stepKinds の中身をそのまま積む
            for (const [key, value] of Object.entries(raw.stepKinds as Record<string, unknown>)) {
              bundle.steps.steps[key] = value;
            }
          }
          if (raw.responseTypes && typeof raw.responseTypes === "object" && !Array.isArray(raw.responseTypes)) {
            // responseTypes は Record — load* が namespace prefix を付けるため raw.responseTypes の中身をそのまま積む
            for (const [key, value] of Object.entries(raw.responseTypes as Record<string, unknown>)) {
              bundle.responseTypes.responseTypes[key] = value;
            }
          }
        }
      } catch {
        // 個別 extension の読み込みエラーは validator 側の互換性維持のため無視する。
      }
    }
  }

  const extBundle: ExtensionsBundle = {
    steps: Object.keys(bundle.steps.steps).length > 0 ? bundle.steps : undefined,
    fieldTypes: bundle.fieldTypes.fieldTypes.length > 0 ? bundle.fieldTypes : undefined,
    triggers: bundle.triggers.triggers.length > 0 ? bundle.triggers : undefined,
    dbOperations: bundle.dbOperations.dbOperations.length > 0 ? bundle.dbOperations : undefined,
    responseTypes: Object.keys(bundle.responseTypes.responseTypes).length > 0 ? bundle.responseTypes : undefined,
  };

  return { extensions: loadExtensionsFromBundle(extBundle).extensions, fileCount };
}

function loadFlowsForProject(project: ProjectResources): Array<{ filePath: string; displayName: string; flow: ProcessFlow; rawJson: string }> {
  if (!existsSync(project.flowsDir)) return [];
  const files = readdirSync(project.flowsDir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    const filePath = join(project.flowsDir, f);
    const rawJson = readFileSync(filePath, "utf-8");
    return {
      filePath,
      displayName: relative(repoRoot, filePath).replace(/\\/g, "/"),
      flow: JSON.parse(rawJson) as ProcessFlow,
      rawJson,
    };
  });
}

function issue(
  validator: string,
  code: string,
  path: string,
  message: string,
  severity: "error" | "warning" = "error",
): ValidationIssue {
  return { validator, code, path, message, severity };
}

/**
 * items 必須 kind 白リスト — 該当しない kind は warning 発報をスキップ。
 *
 * 各 kind の選定根拠 (schemas/v3/screen.v3.schema.json#/$defs/ScreenKind):
 * - form: フォーム入力画面 — 必ず項目が必要
 * - detail: 詳細表示 — 表示するフィールドが必要
 * - search: 検索条件入力 — 検索条件項目が必要
 * - confirm: 確認画面 — 確認する内容を表示する項目が必要 (modal と異なり画面遷移を伴う独立画面)
 * - wizard: ステップ式入力 — 各ステップで項目が必要
 *
 * 除外理由:
 * - dashboard / complete / error / login: 通常 items を持たない (固定表示やナビゲーションのみ)
 * - list: items が空でも direction:viewer の screen-item があれば OK (ITEMS_OR_VIEWER_KINDS で別扱い)
 * - modal: 一般的に簡易ダイアログで items を持たないことが多い (持つ場合は kind: form 等で別画面化が望ましい)
 * - other: 用途不明、判定不能のため安全側
 */
const ITEMS_REQUIRED_KINDS: ReadonlySet<string> = new Set([
  "form",
  "detail",
  "search",
  "confirm",
  "wizard",
]);

/** items に direction:viewer を持てる kind (viewer screen-item が 1 件以上あれば items 空でも OK) */
const ITEMS_OR_VIEWER_KINDS: ReadonlySet<string> = new Set([
  "list",
]);

/**
 * Check 1: Screen.items embed check (#714)
 *
 * - screens/<id>.json の items が空または未定義 → warning (EMPTY_SCREEN_ITEMS)
 *   ただし kind に応じた条件付き発報 (#723):
 *   - ITEMS_REQUIRED_KINDS (form/detail/search/confirm/wizard): items 空なら発報
 *   - ITEMS_OR_VIEWER_KINDS (list): items 空 かつ direction:viewer を含む screen-item もなければ発報
 *   - 拡張 kind (<ns>:<name>): 判定不能のため warning スキップ (安全側)
 *   - その他の kind (dashboard/complete/error 等): warning スキップ
 * - screen-items/ ディレクトリに .json ファイルが存在 → error (LEGACY_SCREEN_ITEMS_DIR)
 */
export function checkScreenItemsEmbedded(project: ProjectResources): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check 1a: items が空または未定義の screen (kind 別の条件付き発報 #723)
  for (const screen of project.screens) {
    if (screen.items && screen.items.length > 0) continue; // items あり → skip

    const id = screen.id ?? "unknown";
    const kind = typeof screen.kind === "string" ? screen.kind : "";

    // 拡張 ScreenKind (<ns>:<name>) は判定不能 → warning スキップ (安全側)
    if (kind.includes(":")) continue;

    // items 必須 kind にも viewer screen-item 代替 kind にも該当しなければ warning スキップ。
    // kind が空文字列 (= undefined/null を "" に正規化した場合) もここで skip される —
    // 種別不明の画面で false positive を出すより安全側に倒す意図。
    // 注: ITEMS_OR_VIEWER_KINDS (list 等) も含めて items が空のまま到達する場合は
    // direction:viewer の screen-item も存在しないと確定している (items が非空なら L302 で
    // continue 済のため)。viewer を含む items も `items.length > 0` で抑制されており、
    // kind=list で EMPTY_SCREEN_ITEMS 不要となるのは items に direction:viewer の
    // screen-item を 1 件以上定義した場合に限られる。
    if (!ITEMS_REQUIRED_KINDS.has(kind) && !ITEMS_OR_VIEWER_KINDS.has(kind)) {
      continue;
    }

    // ここまで到達 → 真に items が必要なのに空 (list 系は viewer screen-item も未定義)
    const isViewerKind = ITEMS_OR_VIEWER_KINDS.has(kind);
    issues.push({
      validator: "runtimeContractValidator",
      severity: "warning",
      code: "EMPTY_SCREEN_ITEMS",
      path: `screens/${id}.json`,
      message: isViewerKind
        ? `Screen.items が空です (kind=${kind})。direction:viewer の screen-item も未定義のため UI で表示する内容がありません。\`items\` に \`direction: "viewer"\` の screen-item を定義してください`
        : `Screen.items が空です (kind=${kind || "<undefined>"})。runtime は別ファイル \`screen-items/${id}.json\` を読まないため UI で空フォームになります。\`screens/${id}.json#items\` 配列に画面項目を embed してください`,
    });
  }

  // Check 1b: legacy screen-items/ ディレクトリが存在する場合
  const screenItemsDir = join(project.projectDir, "screen-items");
  if (existsSync(screenItemsDir)) {
    try {
      const files = readdirSync(screenItemsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        issues.push({
          validator: "runtimeContractValidator",
          severity: "error",
          code: "LEGACY_SCREEN_ITEMS_DIR",
          path: `screen-items/${file}`,
          message: `legacy 配置 \`screen-items/${file}\` を検出しました。runtime はこのディレクトリを読みません。\`screens/<id>.json#items\` に embed してください (#714)`,
        });
      }
    } catch {
      // ディレクトリ読み取りエラーは無視
    }
  }

  return issues;
}

/**
 * Check 2: Design file presence check (#714)
 *
 * - screens/<id>.design.json が存在しない → warning (MISSING_DESIGN_FILE)
 * - screen.design?.designFileRef が外部参照 (basename が <id>.design.json と不一致) → error (EXTERNAL_DESIGN_REF)
 */
export function checkDesignFilePresence(project: ProjectResources): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const screen of project.screens) {
    const id = screen.id ?? "unknown";
    const expectedDesignFile = `${id}.design.json`;

    // Check 2a: design.json ファイルが存在するか
    const designFilePath = join(project.projectDir, "screens", expectedDesignFile);
    if (!existsSync(designFilePath)) {
      issues.push({
        validator: "runtimeContractValidator",
        severity: "warning",
        code: "MISSING_DESIGN_FILE",
        path: `screens/${id}.json`,
        message: `\`screens/${expectedDesignFile}\` が存在しません。UI で空キャンバスになります (recoverable)`,
      });
    }

    // Check 2b: designFileRef が外部参照でないか
    const designFileRef = screen.design?.designFileRef;
    if (typeof designFileRef === "string" && basename(designFileRef) !== expectedDesignFile) {
      issues.push({
        validator: "runtimeContractValidator",
        severity: "error",
        code: "EXTERNAL_DESIGN_REF",
        path: `screens/${id}.json`,
        message: `designFileRef='${designFileRef}' は外部参照です。runtime はこれを読まず hard-coded path 'screens/${expectedDesignFile}' のみ参照します (#714)`,
      });
    }
  }

  return issues;
}

export async function runValidation(projectDirArg: string): Promise<ValidationSummary> {
  const project = discoverProject(projectDirArg);
  const { extensions, fileCount: extensionFileCount } = loadExtensions(project.projectDir);
  const flows = loadFlowsForProject(project);
  const results: FlowValidationResult[] = [];
  const projectResults: ProjectValidationResult[] = [];

  // ─── 必須リソース欠落チェック (docs/spec/sample-project-structure.md) ───────
  // conventions/catalog.json が欠落 → @conv.* 参照検証が全スキップされサイレント pass になるため error
  if (project.conventions === null) {
    const err = new Error(
      `[validate:samples] 必須リソース不足: ${project.displayName} に conventions/catalog.json が見つかりません。` +
      `docs/spec/sample-project-structure.md の必須リソース表を参照してください。`,
    );
    throw err;
  }

  // tables/ ディレクトリが欠落 → SQL カラム検証が空配列で動作するためサイレント pass になる → warning
  const tablesDir = join(project.projectDir, "tables");
  if (!existsSync(tablesDir)) {
    console.warn(
      `[validate:samples] 警告: ${project.displayName} に tables/ ディレクトリが見つかりません。` +
      `テーブル定義なしで検証を続行します (sqlColumnValidator / sqlOrderValidator は無効化)。`,
    );
  }

  function validateOne(filePath: string, displayName: string, flow: ProcessFlow, rawJson: string): FlowValidationResult {
    const issues: ValidationIssue[] = [];

    for (const i of checkSqlColumns(flow, project.tables)) {
      issues.push(issue("sqlColumnValidator", i.code, i.path, i.message));
    }

    for (const i of checkSqlOrder(flow, project.tables as unknown as OrderTableDefinition[])) {
      issues.push(issue("sqlOrderValidator", i.code, i.path, i.message, i.severity ?? "error"));
    }

    for (const i of checkConventionReferences(flow, project.conventions)) {
      issues.push(issue("conventionsValidator", i.code, i.path, i.message));
    }

    for (const i of checkReferentialIntegrity(flow, extensions)) {
      issues.push(issue("referentialIntegrity", i.code, i.path, i.message));
    }

    for (const i of checkIdentifierScopes(flow)) {
      issues.push(issue("identifierScope", i.code, i.path, `@${i.identifier} - ${i.message}`));
    }

    for (const i of checkAntipatterns(flow, rawJson)) {
      issues.push(issue("processFlowAntipatternValidator", i.code, i.path, i.message, i.severity));
    }

    // #781: outputBinding.transformations の field 重複チェック
    if (Array.isArray(flow.actions)) {
      for (let ai = 0; ai < flow.actions.length; ai++) {
        const action = flow.actions[ai];
        if (!Array.isArray(action.steps)) continue;
        const checkTransformations = (steps: unknown[], basePath: string) => {
          for (let si = 0; si < steps.length; si++) {
            const step = steps[si] as Record<string, unknown>;
            const path = `${basePath}[${si}]`;
            const ob = step.outputBinding as Record<string, unknown> | undefined;
            if (ob && Array.isArray(ob.transformations)) {
              const seen = new Set<string>();
              for (const t of ob.transformations as { field?: string }[]) {
                if (t.field) {
                  if (seen.has(t.field)) {
                    issues.push(issue(
                      "outputBindingTransformationsValidator",
                      "DUPLICATE_TRANSFORMATION_FIELD",
                      `${path}.outputBinding.transformations`,
                      `field "${t.field}" が transformations に重複して定義されています。同一 field への変換は 1 件のみ許可されます。`,
                    ));
                  }
                  seen.add(t.field);
                }
              }
            }
            // ネスト (branch / loop / transactionScope 等)
            for (const nestedKey of ["steps", "elseBranch"]) {
              if (nestedKey === "steps" && Array.isArray(step.steps)) {
                checkTransformations(step.steps as unknown[], `${path}.steps`);
              } else if (nestedKey === "elseBranch" && step.elseBranch) {
                const eb = step.elseBranch as Record<string, unknown>;
                if (Array.isArray(eb.steps)) checkTransformations(eb.steps as unknown[], `${path}.elseBranch.steps`);
              }
            }
            if (Array.isArray(step.branches)) {
              for (let bi = 0; bi < (step.branches as unknown[]).length; bi++) {
                const branch = (step.branches as Record<string, unknown>[])[bi];
                if (Array.isArray(branch.steps)) {
                  checkTransformations(branch.steps as unknown[], `${path}.branches[${bi}].steps`);
                }
              }
            }
            // transactionScope の onCommit / onRollback 配下も走査 (#785 Nit)
            if (Array.isArray(step.onCommit)) {
              checkTransformations(step.onCommit as unknown[], `${path}.onCommit`);
            }
            if (Array.isArray(step.onRollback)) {
              checkTransformations(step.onRollback as unknown[], `${path}.onRollback`);
            }
          }
        };
        checkTransformations(action.steps as unknown[], `actions[${ai}].steps`);
      }
    }

    return { filePath, displayName, projectId: project.projectId, issues };
  }

  for (const { filePath, displayName, flow, rawJson } of flows) {
    results.push(validateOne(filePath, displayName, flow, rawJson));
  }

  // ProcessFlow が 1 件も見つからない場合は構造エラー (process-flows/ の欠落または空)
  if (flows.length === 0) {
    throw new Error(
      `[validate:samples] 必須リソース不足: ${project.displayName} に ProcessFlow が 0 件です。` +
      `process-flows/ ディレクトリに .json ファイルを配置してください。` +
      `(docs/spec/sample-project-structure.md の必須リソース表を参照)`,
    );
  }

  const projectIssues: ValidationIssue[] = [];

  for (const i of checkScreenItemFlowConsistency(flows.map((f) => f.flow), project.screens)) {
    projectIssues.push(issue("screenItemFlowValidator", i.code, i.path, i.message, i.severity));
  }

  // #734: *Ref フィールドを plain 値に展開した版で screenItemFieldTypeValidator を実行
  // (plain min/max/minLength/maxLength が undefined の場合のみ Ref を解決して補完)
  const screensWithRefsResolved: Screen[] = project.screens.map((screen) => ({
    ...screen,
    items: (screen.items ?? []).map((item) => resolveScreenItemRefs(item, project.conventionsV3)),
  }));

  for (const i of checkScreenItemFieldTypeConsistency(flows.map((f) => f.flow), screensWithRefsResolved)) {
    projectIssues.push(issue("screenItemFieldTypeValidator", i.code, i.path, i.message, i.severity));
  }

  for (const i of checkScreenItemRefKeyConsistency(project.screens, project.conventionsV3)) {
    projectIssues.push(issue("screenItemRefKeyValidator", i.code, i.path, i.message, i.severity));
  }

  for (const i of checkViewDefinitions(
    project.viewDefinitions,
    project.tables as unknown as import("../src/schemas/viewDefinitionValidator.js").TableDefinitionForView[],
  )) {
    projectIssues.push(issue("viewDefinitionValidator", i.code, i.path, i.message, i.severity));
  }

  for (const i of checkScreenNavigation(flows.map((f) => f.flow), project.screens, project.screenTransitions)) {
    projectIssues.push(issue("screenNavigationValidator", i.code, i.path, i.message, i.severity));
  }

  for (const i of checkScreenItemsEmbedded(project)) {
    projectIssues.push(i);
  }

  for (const i of checkDesignFilePresence(project)) {
    projectIssues.push(i);
  }

  if (projectIssues.length > 0) {
    projectResults.push({
      projectId: project.projectId,
      displayName: project.displayName,
      issues: projectIssues,
    });
  }

  const hasErrorIssues = (r: FlowValidationResult) => r.issues.some((i) => i.severity === "error");
  const passedFlows = results.filter((r) => !hasErrorIssues(r)).length;
  const failedFlows = results.filter((r) => hasErrorIssues(r)).length;

  return {
    totalFlows: results.length,
    passedFlows,
    failedFlows,
    results,
    projectResults,
    projectCount: 1,
    totalTableCount: project.tables.length,
    totalConventionsCount: project.conventions ? 1 : 0,
    totalScreenCount: project.screens.length,
    totalViewDefinitionCount: project.viewDefinitions.length,
    extensionFileCount,
  };
}

const validatorDisplayOrder = [
  "sqlColumnValidator",
  "sqlOrderValidator",
  "conventionsValidator",
  "referentialIntegrity",
  "identifierScope",
  "screenItemFlowValidator",
  "screenItemFieldTypeValidator",
  "screenItemRefKeyValidator",
  "viewDefinitionValidator",
  "screenNavigationValidator",
  "runtimeContractValidator",
  "processFlowAntipatternValidator",
  "outputBindingTransformationsValidator",
];

export function printSummary(summary: ValidationSummary): void {
  console.log("samples dogfood validation");
  console.log();
  console.log(
    `projects: ${summary.projectCount} / ${summary.totalFlows} flows / ${summary.totalTableCount} tables` +
    ` / ${summary.totalScreenCount} screens / ${summary.totalViewDefinitionCount} viewDefinitions` +
    ` / ${summary.totalConventionsCount} conventions catalogs / ${summary.extensionFileCount} extension files`,
  );
  console.log();

  for (const result of summary.results) {
    const errorIssues = result.issues.filter((i) => i.severity === "error");
    const warnIssues = result.issues.filter((i) => i.severity === "warning");
    if (errorIssues.length === 0 && warnIssues.length === 0) {
      console.log(`PASS ${result.displayName} (${validatorDisplayOrder.length} validators pass)`);
    } else if (errorIssues.length === 0) {
      console.log(`WARN ${result.displayName} (${validatorDisplayOrder.length} validators pass, ${warnIssues.length} warning(s))`);
      for (const i of warnIssues) {
        console.log(`   [WARN] [${i.validator}] [${i.code}] ${i.path}: ${i.message}`);
      }
    } else {
      console.log(`FAIL ${result.displayName}`);
      for (const i of result.issues) {
        const tag = i.severity === "warning" ? "WARN" : "ERROR";
        console.log(`   [${tag}] [${i.validator}] [${i.code}] ${i.path}: ${i.message}`);
      }
    }
  }

  if (summary.projectResults.length > 0) {
    console.log();
    console.log("project-level validation:");
    for (const pr of summary.projectResults) {
      console.log(`  ${pr.displayName}`);
      for (const i of pr.issues) {
        const tag = i.severity === "warning" ? "WARN" : "ERROR";
        console.log(`     [${tag}] [${i.validator}] [${i.code}] ${i.path}: ${i.message}`);
      }
    }
  }

  console.log();
  console.log("---------------------------------------------------------");

  const totalByValidator = new Map<string, number>();    // error
  const totalWarnByValidator = new Map<string, number>(); // warning
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const result of summary.results) {
    for (const i of result.issues) {
      const map = i.severity === "warning" ? totalWarnByValidator : totalByValidator;
      map.set(i.validator, (map.get(i.validator) ?? 0) + 1);
      if (i.severity === "warning") totalWarnings++;
      else totalErrors++;
    }
  }
  for (const pr of summary.projectResults) {
    for (const i of pr.issues) {
      const map = i.severity === "warning" ? totalWarnByValidator : totalByValidator;
      map.set(i.validator, (map.get(i.validator) ?? 0) + 1);
      if (i.severity === "warning") totalWarnings++;
      else totalErrors++;
    }
  }

  console.log(`Summary: ${summary.passedFlows} / ${summary.totalFlows} flows passed.`);
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log("All validations passed.");
  } else if (totalErrors === 0) {
    console.log(`All errors resolved (${totalWarnings} warning${totalWarnings > 1 ? "s remain" : " remains"}):`);
    for (const validator of validatorDisplayOrder) {
      const w = totalWarnByValidator.get(validator) ?? 0;
      if (w > 0) console.log(`  - [${validator}] ${w} warning${w > 1 ? "s" : ""}`);
    }
  } else {
    console.log(`${summary.failedFlows} flow${summary.failedFlows > 1 ? "s" : ""} failed with ${totalErrors} error${totalErrors > 1 ? "s" : ""}${totalWarnings > 0 ? ` and ${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}` : ""}:`);
    for (const validator of validatorDisplayOrder) {
      const e = totalByValidator.get(validator) ?? 0;
      const w = totalWarnByValidator.get(validator) ?? 0;
      if (e > 0 || w > 0) {
        const parts: string[] = [];
        if (e > 0) parts.push(`${e} error${e > 1 ? "s" : ""}`);
        if (w > 0) parts.push(`${w} warning${w > 1 ? "s" : ""}`);
        console.log(`  - [${validator}] ${parts.join(", ")}`);
      }
    }
  }
  console.log("---------------------------------------------------------");
}

function parseArgs(argv: string[]): { projectDir: string } {
  const projectDir = argv.find((arg) => !arg.startsWith("-"));
  if (!projectDir) {
    throw new Error("対象プロジェクトディレクトリを指定してください。例: npm run validate:samples -- ../data");
  }
  return { projectDir };
}

// CLI エントリポイント: tsx で直接実行された場合のみ起動する
if (process.argv[1]?.endsWith("validate-samples.ts") || process.argv[1]?.endsWith("validate-samples.js")) {
  (async () => {
    try {
      const { projectDir } = parseArgs(process.argv.slice(2));
      const summary = await runValidation(projectDir);
      printSummary(summary);
      const projectErrorCount = summary.projectResults.reduce(
        (acc, pr) => acc + pr.issues.filter((i) => i.severity === "error").length,
        0,
      );
      process.exit(summary.failedFlows > 0 || projectErrorCount > 0 ? 1 : 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`ERROR ${message}`);
      process.exit(1);
    }
  })();
}
