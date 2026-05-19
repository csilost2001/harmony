// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145) で StepCard.tsx から各 kind 別 body sub-component を抽出する際の共通 props 型。
// 各 sub-component は本 `StepCardBodyBaseProps` を拡張せず使い回す (1 sub = 1 kind 専用)。

import type { ProcessFlow, Step } from "../../../../types/v3";
import type { ValidationError } from "../../../../utils/actionValidation";

export interface StepCardBodyBaseProps {
  /** 対象 step (kind discriminator は各 sub-component 側で検査済) */
  step: Step;
  /** trail (subSteps の親含む) の全 step (jumpTarget / outputBinding 参照解決用) */
  allSteps: Step[];
  /** 部分更新 patch を親 StepCard に通知 */
  onChange: (changes: Partial<Step>) => void;
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
