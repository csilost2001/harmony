// @ts-nocheck
import type {
  ActionDefinition,
  Branch,
  BranchCondition,
  BranchStep,
  ProcessFlow,
  Step,
} from "../types/action";
import type { Maturity, Mode } from "../types/v3/common";
import { generateUUID } from "./uuid";

export const PROCESS_FLOW_V3_SCHEMA_REF = "../schemas/v3/process-flow.v3.schema.json";

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function clone<T>(raw: T): T {
  return JSON.parse(JSON.stringify(raw)) as T;
}

function isV3ProcessFlow(raw: Raw): boolean {
  return raw.$schema === PROCESS_FLOW_V3_SCHEMA_REF || (isRecord(raw.meta) && typeof raw.meta.kind === "string");
}

function isValidMaturity(v: unknown): v is Maturity {
  return v === "draft" || v === "provisional" || v === "committed";
}

function isValidMode(v: unknown): v is Mode {
  return v === "upstream" || v === "downstream";
}

function nowIso(): string {
  return new Date().toISOString();
}

function noteKind(v: unknown): "assumption" | "prerequisite" | "todo" | "deferred" | "question" {
  if (v === "todo" || v === "question") return v;
  if (v === "decision" || v === "risk" || v === "deferred") return "deferred";
  if (v === "prerequisite") return "prerequisite";
  return "assumption";
}

function normalizeNotes(step: Raw): void {
  const notes = Array.isArray(step.notes) ? (step.notes as Raw[]) : [];
  if (notes.length > 0) {
    step.notes = notes.map((n) => ({ ...n, kind: noteKind(n.kind ?? n.type) }));
  } else if (typeof step.note === "string" && step.note.trim()) {
    step.notes = [{
      id: generateUUID(),
      kind: "assumption",
      body: step.note,
      createdAt: nowIso(),
    }];
  }
  delete step.note;
}

function normalizeOutputBinding(step: Raw): void {
  if (typeof step.outputBinding === "string" && step.outputBinding.trim()) {
    step.outputBinding = { name: step.outputBinding };
  }
}

function normalizeValidationRules(step: Raw): void {
  if (!Array.isArray(step.rules)) return;
  step.rules = (step.rules as Raw[]).map((rule) => {
    const next = { ...rule };
    if (typeof next.kind === "string" && !next.severity) {
      next.severity = next.kind.toLowerCase();
    }
    delete next.kind;
    return next;
  });
}

function normalizeBranchCondition(raw: unknown): BranchCondition {
  if (isRecord(raw) && typeof raw.kind === "string") return raw as unknown as BranchCondition;
  return { kind: "expression", expression: typeof raw === "string" ? raw : "" } as BranchCondition;
}

interface LegacyBranchFields {
  label?: string;
  description?: string;
  jumpTo?: string;
}

function legacyToBranch(code: string, condition: unknown, raw: LegacyBranchFields | undefined): Branch {
  const steps: Step[] = [];
  const description = raw?.description?.trim();
  const jumpTo = raw?.jumpTo?.trim();
  if (description) {
    steps.push({
      id: generateUUID(),
      kind: "legacy:OtherStep",
      description,
      maturity: "draft",
    } as Step);
  }
  if (jumpTo) {
    steps.push({
      id: generateUUID(),
      kind: "jump",
      description: "",
      jumpTo,
      maturity: "draft",
    } as Step);
  }
  const label = raw?.label?.trim();
  return {
    id: generateUUID(),
    code,
    label: label || undefined,
    condition: normalizeBranchCondition(condition),
    steps,
  };
}

function migrateBranch(raw: unknown): Branch {
  const branch = isRecord(raw) ? raw : {};
  return {
    ...branch,
    condition: normalizeBranchCondition(branch.condition),
    steps: Array.isArray(branch.steps) ? branch.steps.map(migrateStepInPlace) : [],
  } as unknown as Branch;
}

function migrateStepArray(raw: unknown): Step[] {
  return Array.isArray(raw) ? raw.map(migrateStepInPlace) : [];
}

function migrateStepInPlace(raw: unknown): Step {
  if (!isRecord(raw)) return raw as Step;
  const step = raw;
  const legacyType = typeof step.type === "string" ? step.type : undefined;
  const kind = typeof step.kind === "string" ? step.kind : legacyType;

  if (kind) step.kind = kind === "other" ? "legacy:OtherStep" : kind;
  delete step.type;
  delete step.transactional;
  normalizeNotes(step);
  normalizeOutputBinding(step);
  if (!isValidMaturity(step.maturity)) step.maturity = "draft";

  if (step.kind === "validation") {
    normalizeValidationRules(step);
    if (isRecord(step.inlineBranch)) {
      const inline = step.inlineBranch as Raw;
      inline.ok = migrateStepArray(inline.ok);
      inline.ng = migrateStepArray(inline.ng);
    }
  }

  if (step.kind === "dbAccess") {
    if (!step.tableId && typeof step.tableName === "string") step.tableId = step.tableName;
    delete step.tableName;
  }

  if (step.kind === "externalSystem") {
    if (!step.systemRef && typeof step.systemName === "string") step.systemRef = step.systemName;
    delete step.systemName;
  }

  if (step.kind === "commonProcess") {
    delete step.refName;
  }

  if (step.kind === "screenTransition") {
    if (!step.targetScreenId && typeof step.targetScreenName === "string") step.targetScreenId = step.targetScreenName;
    delete step.targetScreenName;
  }

  if (step.kind === "branch") {
    if (Array.isArray(step.branches)) {
      step.branches = step.branches.map(migrateBranch);
    } else {
      step.branches = [
        legacyToBranch("A", step.condition, step.branchA as LegacyBranchFields | undefined),
        legacyToBranch("B", "", step.branchB as LegacyBranchFields | undefined),
      ];
    }
    if (isRecord(step.elseBranch)) step.elseBranch = migrateBranch(step.elseBranch);
    delete step.condition;
    delete step.branchA;
    delete step.branchB;
  }

  if (step.kind === "loop") {
    step.steps = migrateStepArray(step.steps);
  }

  if (step.kind === "transactionScope") {
    step.steps = migrateStepArray(step.steps);
    if (Array.isArray(step.onCommit)) step.onCommit = step.onCommit.map(migrateStepInPlace);
    if (Array.isArray(step.onRollback)) step.onRollback = step.onRollback.map(migrateStepInPlace);
  }

  if (step.kind === "workflow") {
    if (Array.isArray(step.onApproved)) step.onApproved = step.onApproved.map(migrateStepInPlace);
    if (Array.isArray(step.onRejected)) step.onRejected = step.onRejected.map(migrateStepInPlace);
    if (Array.isArray(step.onTimeout)) step.onTimeout = step.onTimeout.map(migrateStepInPlace);
    if (isRecord(step.quorum) && step.quorum.type === "n-of-m") step.quorum.type = "nOfM";
  }

  if (step.kind === "externalSystem" && isRecord(step.outcomes)) {
    for (const outcome of Object.values(step.outcomes)) {
      if (isRecord(outcome) && Array.isArray(outcome.sideEffects)) {
        outcome.sideEffects = outcome.sideEffects.map(migrateStepInPlace);
      }
    }
  }

  if (step.kind === "cdc") {
    if (!step.tableIds && Array.isArray(step.tables)) step.tableIds = step.tables;
    delete step.tables;
    if (isRecord(step.destination) && typeof step.destination.type === "string" && !step.destination.kind) {
      step.destination.kind = step.destination.type;
      delete step.destination.type;
    }
  }

  return step as unknown as Step;
}

function migrateAction(raw: unknown): ActionDefinition {
  const action = isRecord(raw) ? raw : {};
  if (!isValidMaturity(action.maturity)) action.maturity = "draft";
  action.steps = migrateStepArray(action.steps);
  return action as unknown as ActionDefinition;
}

function pickDefined(source: Raw, keys: string[]): Raw {
  const out: Raw = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function normalizeV3(raw: Raw): ProcessFlow {
  const next = clone(raw);
  next.$schema = PROCESS_FLOW_V3_SCHEMA_REF;
  const meta = (next.meta ?? {}) as Raw;
  if (!isValidMaturity(meta.maturity)) meta.maturity = "draft";
  if (!isValidMode(meta.mode)) meta.mode = "upstream";
  next.meta = meta;
  next.actions = Array.isArray(next.actions) ? next.actions.map(migrateAction) : [];
  return next as unknown as ProcessFlow;
}

export function migrateProcessFlow(raw: unknown): ProcessFlow {
  if (!isRecord(raw)) throw new Error("migrateProcessFlow: input is not an object");
  if (isV3ProcessFlow(raw)) return normalizeV3(raw);

  const source = clone(raw);
  const ts = nowIso();
  const catalogs = pickDefined(source, [
    "errorCatalog",
    "externalSystemCatalog",
    "secretsCatalog",
    "envVarCatalog",
    "domainCatalog",
    "functionCatalog",
    "eventCatalog",
  ]);

  const contextCatalogs: Raw = {};
  if (catalogs.errorCatalog) contextCatalogs.errors = catalogs.errorCatalog;
  if (catalogs.externalSystemCatalog) contextCatalogs.externalSystems = catalogs.externalSystemCatalog;
  if (catalogs.secretsCatalog) contextCatalogs.secrets = catalogs.secretsCatalog;
  if (catalogs.envVarCatalog) contextCatalogs.envVars = catalogs.envVarCatalog;
  if (catalogs.domainCatalog) contextCatalogs.domains = catalogs.domainCatalog;
  if (catalogs.functionCatalog) contextCatalogs.functions = catalogs.functionCatalog;
  if (catalogs.eventCatalog) contextCatalogs.events = catalogs.eventCatalog;

  const context: Raw = {};
  if (Object.keys(contextCatalogs).length > 0) context.catalogs = contextCatalogs;
  if (Array.isArray(source.ambientVariables)) context.ambientVariables = source.ambientVariables;
  for (const key of ["health", "readiness", "resources"]) {
    if (source[key] !== undefined) context[key] = source[key];
  }

  const authoring = pickDefined(source, ["markers", "decisions", "glossary", "notes", "testScenarios"]);

  const migrated: Raw = {
    $schema: PROCESS_FLOW_V3_SCHEMA_REF,
    meta: {
      id: source.id,
      name: source.name ?? "",
      kind: source.type ?? "other",
      description: source.description ?? "",
      version: source.version ?? "1.0.0",
      maturity: isValidMaturity(source.maturity) ? source.maturity : "draft",
      createdAt: source.createdAt ?? ts,
      updatedAt: source.updatedAt ?? ts,
      ...(source.screenId ? { screenId: source.screenId } : {}),
      ...(isValidMode(source.mode) ? { mode: source.mode } : { mode: "upstream" }),
      ...(source.apiVersion ? { apiVersion: source.apiVersion } : {}),
      ...(source.sla ? { sla: source.sla } : {}),
    },
    ...(Object.keys(context).length > 0 ? { context } : {}),
    actions: Array.isArray(source.actions) ? source.actions.map(migrateAction) : [],
    ...(Object.keys(authoring).length > 0 ? { authoring } : {}),
  };

  return migrated as unknown as ProcessFlow;
}

export function migrateStep(raw: unknown): Step {
  return migrateStepInPlace(clone(raw));
}

export function isV3ProcessFlowShape(raw: unknown): raw is ProcessFlow {
  return isRecord(raw) && isV3ProcessFlow(raw);
}
