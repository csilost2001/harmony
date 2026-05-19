// Phase-2 (#1145) で StepCard.tsx から各 kind 別 body sub-component を抽出する際の共通 props 型。
// #1016 follow-up (2026-05-20): generic 化により step を specific variant で narrow 可能に。
// 各 sub-component は `StepCardBodyBaseProps<XxxStep>` で固有 step 型を指定する。

import type { ProcessFlow, Step } from "../../../../types/v3";
import type { ValidationError } from "../../../../utils/actionValidation";

export interface StepCardBodyBaseProps<S extends Step = Step> {
  /** 対象 step (kind discriminator narrow 済の specific variant) */
  step: S;
  /** trail (subSteps の親含む) の全 step (jumpTarget / outputBinding 参照解決用) */
  allSteps: Step[];
  /** 部分更新 patch を親 StepCard に通知 */
  onChange: (changes: Partial<S>) => void;
  /** edit-commit (blur 時 persistence flush) */
  onCommit?: () => void;
  /** read-only mode で input を disable */
  readOnly?: boolean;
}

export interface StepCardBodyCatalogProps {
  /** convention catalog (式補完 / バリデーション参照用) */
  conventions?: import("../../../../schemas/conventionsValidator").ConventionsCatalog | null;
  /** parent group (TX scope などで context.catalogs.errors 参照に必要、#415) */
  group?: ProcessFlow | null;
  /** ValidationError (kind body 側で利用しないが、子 InlineStepList へ pass-through 用) */
  validationErrors?: ValidationError[];
}

export interface StepCardBodyTableProps {
  tables: { id: string; physicalName: string; name: string }[];
}

export interface StepCardBodyScreenProps {
  screens: { id: string; name: string }[];
}

export interface StepCardBodyCommonGroupsProps {
  commonGroups: { id: string; name: string }[];
}

export interface StepCardBodyNavigationProps {
  onNavigateCommon: (refId: string) => void;
}
