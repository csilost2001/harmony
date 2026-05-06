import type { ProcessFlow, StructuredField } from "../types/action";
import type { Screen } from "../types/v3/screen";
import type { ScreenItem, ScreenItemEvent } from "../types/v3/screen-item";

export type ScreenItemFieldTypeIssueCode =
  | "OPTIONS_NOT_SUBSET_OF_ENUM"
  | "PATTERN_DIVERGENCE"
  | "RANGE_DIVERGENCE"
  | "LENGTH_DIVERGENCE"
  | "DOMAIN_KEY_MISMATCH"
  | "TYPE_MISMATCH";

export interface ScreenItemFieldTypeIssue {
  path: string;
  code: ScreenItemFieldTypeIssueCode;
  severity: "error" | "warning";
  screenId: string;
  itemId: string;
  flowId: string;
  inputId: string;
  message: string;
}

interface MappedPair {
  screenId: string;
  itemId: string;
  eventId: string;
  flowId: string;
  inputName: string;
  screenItem: ScreenItem;
  flowInput: StructuredField;
  argExpression: string;
  path: string;
}

const SELF_ITEM_REF = /^@self\.([a-zA-Z_][\w-]*)$/;

function getFlowId(flow: ProcessFlow): string | null {
  return (flow as { id?: string }).id ?? flow.meta?.id ?? null;
}

function getScreenId(screen: Screen): string | null {
  return (screen as { id?: string }).id ?? (screen as { meta?: { id: string } }).meta?.id ?? null;
}

function getPrimaryInputs(flow: ProcessFlow): StructuredField[] {
  return flow.actions?.[0]?.inputs ?? [];
}

function collectMappedPairs(flows: ProcessFlow[], screens: Screen[]): MappedPair[] {
  const pairs: MappedPair[] = [];
  const flowById = new Map<string, ProcessFlow>();

  for (const flow of flows) {
    const flowId = getFlowId(flow);
    if (flowId) flowById.set(flowId, flow);
  }

  screens.forEach((screen, si) => {
    const screenId = getScreenId(screen) ?? `screens[${si}]`;
    const screenItems = screen.items ?? [];

    screenItems.forEach((item: ScreenItem, ii: number) => {
      item.events?.forEach((event: ScreenItemEvent, ei: number) => {
        const targetFlow = flowById.get(event.handlerFlowId);
        if (!targetFlow) return;

        const argMapping = event.argumentMapping ?? {};
        const inputs = getPrimaryInputs(targetFlow);

        Object.entries(argMapping).forEach(([inputName, argExpression]) => {
          const flowInput = inputs.find((input) => input.name === inputName);
          if (!flowInput) return;

          const expression = String(argExpression);
          const selfRef = expression.match(SELF_ITEM_REF);
          const mappedScreenItem = selfRef ? screenItems.find((screenItem) => screenItem.id === selfRef[1]) : undefined;

          pairs.push({
            screenId,
            itemId: item.id ?? String(ii),
            eventId: event.id ?? (event as { type?: string }).type ?? String(ei),
            flowId: event.handlerFlowId,
            inputName,
            screenItem: mappedScreenItem ?? item,
            flowInput,
            argExpression: expression,
            path: `screens[si=${screenId}].items[ii=${item.id ?? ii}].events[ei=${
              event.id ?? ei
            }].argumentMapping.${inputName}`,
          });
        });
      });
    });
  });

  return pairs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getDomain(field: StructuredField): Record<string, unknown> | null {
  const type = asRecord(field.type);
  const typeDomain = asRecord(type?.domain);
  if (typeDomain) return typeDomain;
  return asRecord((field as { domain?: unknown }).domain);
}

function getEnumValues(field: StructuredField): unknown[] | null {
  const values = asRecord(getDomain(field)?.enum)?.values;
  return Array.isArray(values) ? values : null;
}

function getItemPattern(item: ScreenItem): string | undefined {
  const validation = asRecord((item as { validation?: unknown }).validation);
  return (typeof validation?.pattern === "string" ? validation.pattern : undefined) ?? item.pattern;
}

function getItemMin(item: ScreenItem): number | undefined {
  const validation = asRecord((item as { validation?: unknown }).validation);
  const minimum = validation?.minimum;
  const min = validation?.min;
  return (typeof minimum === "number" ? minimum : undefined) ?? (typeof min === "number" ? min : undefined) ?? item.min;
}

function getItemMax(item: ScreenItem): number | undefined {
  const validation = asRecord((item as { validation?: unknown }).validation);
  const maximum = validation?.maximum;
  const max = validation?.max;
  return (typeof maximum === "number" ? maximum : undefined) ?? (typeof max === "number" ? max : undefined) ?? item.max;
}

function getItemMinLength(item: ScreenItem): number | undefined {
  const validation = asRecord((item as { validation?: unknown }).validation);
  const minLength = validation?.minLength;
  return (typeof minLength === "number" ? minLength : undefined) ?? item.minLength;
}

function getItemMaxLength(item: ScreenItem): number | undefined {
  const validation = asRecord((item as { validation?: unknown }).validation);
  const maxLength = validation?.maxLength;
  return (typeof maxLength === "number" ? maxLength : undefined) ?? item.maxLength;
}

function getDomainKey(type: unknown): string | undefined {
  const record = asRecord(type);
  return typeof record?.domainKey === "string" ? record.domainKey : undefined;
}

function normalizeTypeForComparison(type: unknown): string | null {
  if (typeof type === "string") return type;

  const record = asRecord(type);
  if (typeof record?.kind === "string") return record.kind;

  return null;
}

function addIssue(
  issues: ScreenItemFieldTypeIssue[],
  pair: MappedPair,
  code: ScreenItemFieldTypeIssueCode,
  severity: "error" | "warning",
  message: string,
): void {
  issues.push({
    path: pair.path,
    code,
    severity,
    screenId: pair.screenId,
    itemId: pair.itemId,
    flowId: pair.flowId,
    inputId: pair.inputName,
    message,
  });
}

function checkOptionsSubset(issues: ScreenItemFieldTypeIssue[], pair: MappedPair): void {
  const optionValues = pair.screenItem.options?.map((option) => option.value);
  const enumValues = getEnumValues(pair.flowInput);
  if (!optionValues?.length || !enumValues?.length) return;

  const enumSet = new Set(enumValues);
  const extras = optionValues.filter((value) => !enumSet.has(value));
  if (extras.length > 0) {
    addIssue(
      issues,
      pair,
      "OPTIONS_NOT_SUBSET_OF_ENUM",
      "error",
      `Screen item '${pair.itemId}' options contain values outside flow input '${pair.inputName}' enum: ${extras.join(
        ", ",
      )}`,
    );
  }
}

function checkDomainKeyMismatch(issues: ScreenItemFieldTypeIssue[], pair: MappedPair): void {
  const itemDomainKey = getDomainKey(pair.screenItem.type);
  const inputDomainKey = getDomainKey(pair.flowInput.type);
  if (itemDomainKey === undefined || inputDomainKey === undefined) return;

  if (itemDomainKey !== inputDomainKey) {
    addIssue(
      issues,
      pair,
      "DOMAIN_KEY_MISMATCH",
      "error",
      `Screen item '${pair.itemId}' domainKey does not match flow input '${pair.inputName}'.`,
    );
  }
}

function checkTypeMismatch(issues: ScreenItemFieldTypeIssue[], pair: MappedPair): void {
  if (!SELF_ITEM_REF.test(pair.argExpression)) return;

  const itemType = normalizeTypeForComparison(pair.screenItem.type);
  const inputType = normalizeTypeForComparison(pair.flowInput.type);
  if (itemType === null || inputType === null) return;

  if (itemType !== inputType) {
    addIssue(
      issues,
      pair,
      "TYPE_MISMATCH",
      "error",
      `Mapped screen item '${pair.screenItem.id}' type '${itemType}' does not match flow input '${pair.inputName}' type '${inputType}'.`,
    );
  }
}

function checkPatternDivergence(issues: ScreenItemFieldTypeIssue[], pair: MappedPair): void {
  const itemPattern = getItemPattern(pair.screenItem);
  const inputPattern = getDomain(pair.flowInput)?.pattern;
  if (itemPattern === undefined || inputPattern === undefined) return;

  if (itemPattern !== inputPattern) {
    addIssue(
      issues,
      pair,
      "PATTERN_DIVERGENCE",
      "warning",
      `Screen item '${pair.itemId}' pattern does not match flow input '${pair.inputName}' pattern.`,
    );
  }
}

function checkRangeDivergence(issues: ScreenItemFieldTypeIssue[], pair: MappedPair): void {
  const domain = getDomain(pair.flowInput);
  if (!domain) return;

  const itemMin = getItemMin(pair.screenItem);
  const itemMax = getItemMax(pair.screenItem);
  const minDiffers = itemMin !== undefined && domain.minimum !== undefined && itemMin !== domain.minimum;
  const maxDiffers = itemMax !== undefined && domain.maximum !== undefined && itemMax !== domain.maximum;

  if (minDiffers || maxDiffers) {
    addIssue(
      issues,
      pair,
      "RANGE_DIVERGENCE",
      "warning",
      `Screen item '${pair.itemId}' numeric range does not match flow input '${pair.inputName}' range.`,
    );
  }
}

function checkLengthDivergence(issues: ScreenItemFieldTypeIssue[], pair: MappedPair): void {
  const domain = getDomain(pair.flowInput);
  if (!domain) return;

  const itemMinLength = getItemMinLength(pair.screenItem);
  const itemMaxLength = getItemMaxLength(pair.screenItem);
  const minLengthDiffers =
    itemMinLength !== undefined && domain.minLength !== undefined && itemMinLength !== domain.minLength;
  const maxLengthDiffers =
    itemMaxLength !== undefined && domain.maxLength !== undefined && itemMaxLength !== domain.maxLength;

  if (minLengthDiffers || maxLengthDiffers) {
    addIssue(
      issues,
      pair,
      "LENGTH_DIVERGENCE",
      "warning",
      `Screen item '${pair.itemId}' text length does not match flow input '${pair.inputName}' length.`,
    );
  }
}

export function checkScreenItemFieldTypeConsistency(flows: ProcessFlow[], screens: Screen[]): ScreenItemFieldTypeIssue[] {
  const issues: ScreenItemFieldTypeIssue[] = [];

  for (const pair of collectMappedPairs(flows ?? [], screens ?? [])) {
    checkOptionsSubset(issues, pair);
    checkDomainKeyMismatch(issues, pair);
    checkTypeMismatch(issues, pair);
    checkPatternDivergence(issues, pair);
    checkRangeDivergence(issues, pair);
    checkLengthDivergence(issues, pair);
  }

  return issues;
}
