import type { ProcessFlow } from "../../types/v3";

export interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

export function computeDiff(current: ProcessFlow, proposed: ProcessFlow): DiffEntry[] {
  const entries: DiffEntry[] = [];

  const currentMeta = (current.meta ?? {}) as Record<string, unknown>;
  const proposedMeta = (proposed.meta ?? {}) as Record<string, unknown>;
  const metaKeys = new Set([...Object.keys(currentMeta), ...Object.keys(proposedMeta)]);
  for (const key of metaKeys) {
    if (key === "updatedAt") continue;
    const before = JSON.stringify(currentMeta[key]);
    const after = JSON.stringify(proposedMeta[key]);
    if (before !== after) {
      entries.push({
        path: `meta.${key}`,
        kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
        before,
        after,
      });
    }
  }

  const currentActions = ((current.actions ?? []) as Array<Record<string, unknown>>);
  const proposedActions = ((proposed.actions ?? []) as Array<Record<string, unknown>>);
  const currentActionMap = new Map(currentActions.map((a) => [String(a.id), a]));
  const proposedActionMap = new Map(proposedActions.map((a) => [String(a.id), a]));

  for (const [id, action] of proposedActionMap) {
    const cur = currentActionMap.get(id);
    if (!cur) {
      entries.push({
        path: `actions[${id}]`,
        kind: "added",
        after: JSON.stringify(action, null, 2),
      });
    } else {
      const beforeStr = JSON.stringify(cur, null, 2);
      const afterStr = JSON.stringify(action, null, 2);
      if (beforeStr !== afterStr) {
        entries.push({
          path: `actions[${id}]`,
          kind: "changed",
          before: beforeStr,
          after: afterStr,
        });
      }
    }
  }
  for (const [id, action] of currentActionMap) {
    if (!proposedActionMap.has(id)) {
      entries.push({
        path: `actions[${id}]`,
        kind: "removed",
        before: JSON.stringify(action, null, 2),
      });
    }
  }

  const currentCtx = JSON.stringify(current.context ?? {});
  const proposedCtx = JSON.stringify(proposed.context ?? {});
  if (currentCtx !== proposedCtx) {
    entries.push({
      path: "context",
      kind: "changed",
      before: JSON.stringify(current.context, null, 2),
      after: JSON.stringify(proposed.context, null, 2),
    });
  }

  return entries;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function hasOwn(obj: object | undefined, key: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function replaceObjectContents<T extends object>(target: T, source: T): void {
  const targetRecord = target as Record<string, unknown>;
  const sourceRecord = source as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) {
    if (!hasOwn(sourceRecord, key)) delete targetRecord[key];
  }
  Object.assign(targetRecord, cloneValue(sourceRecord));
}

export function replaceProcessFlowContents(target: ProcessFlow, proposed: ProcessFlow): void {
  replaceObjectContents(target, proposed);
}

export function applyProcessFlowDiffSelection(
  target: ProcessFlow,
  proposed: ProcessFlow,
  selectedPaths: Iterable<string>,
): void {
  const selected = new Set(selectedPaths);

  for (const path of selected) {
    if (path.startsWith("meta.")) {
      const key = path.slice("meta.".length);
      const targetMeta = target.meta as Record<string, unknown>;
      const proposedMeta = proposed.meta as Record<string, unknown>;
      if (hasOwn(proposedMeta, key)) {
        targetMeta[key] = cloneValue(proposedMeta[key]);
      } else {
        delete targetMeta[key];
      }
      continue;
    }

    const actionMatch = path.match(/^actions\[(.+)]$/);
    if (actionMatch) {
      const actionId = actionMatch[1];
      const proposedActions = (proposed.actions ?? []) as Array<Record<string, unknown>>;
      const targetActions = target.actions as Array<Record<string, unknown>>;
      const proposedAction = proposedActions.find((a) => String(a.id) === actionId);
      const targetIndex = targetActions.findIndex((a) => String(a.id) === actionId);
      if (proposedAction) {
        const nextAction = cloneValue(proposedAction);
        if (targetIndex >= 0) {
          targetActions[targetIndex] = nextAction;
        } else {
          targetActions.push(nextAction);
        }
      } else if (targetIndex >= 0) {
        targetActions.splice(targetIndex, 1);
      }
      continue;
    }

    if (path === "context") {
      if (hasOwn(proposed as object, "context")) {
        target.context = cloneValue(proposed.context);
      } else {
        delete target.context;
      }
    }
  }
}
