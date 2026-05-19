import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StepCard } from "./StepCard";
// #1186 Phase 2-B: types/action → types/v3 移行 (StepCard.tsx と整合)
import type { ProcessFlow, Step, StepKind as StepType } from "../../types/v3";
import type { ValidationError } from "../../utils/actionValidation";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";

interface SortableStepCardProps {
  step: Step;
  index: number;
  label: string;
  allSteps: Step[];
  tables: { id: string; physicalName: string; name: string }[];
  screens: { id: string; name: string }[];
  commonGroups: { id: string; name: string }[];
  onChange: (changes: Partial<Step>) => void;
  onCommit?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddSubStep: (type: StepType) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onNavigateCommon: (refId: string) => void;
  defaultExpanded?: boolean;
  selected?: boolean;
  onHeaderClick?: (e: React.MouseEvent) => void;
  onIndent?: () => void;
  onOutdentSubStep?: (subStepId: string) => void;
  validationErrors?: ValidationError[];
  onAddMarker?: (body: string, kind?: "todo" | "question" | "attention" | "chat") => void;
  markerCount?: number;
  markerTooltip?: string;
  markerKinds?: { todo: number; question: number; attention: number; chat: number };
  conventions?: ConventionsCatalog | null;
  group?: ProcessFlow | null;
  /** #1076 編集レベル (rough / detail / implementation) */
  editLevel?: "rough" | "detail" | "implementation";
  /** #1076 AI 依頼ボタン押下時のコールバック */
  onAskAi?: () => void;
  readOnly?: boolean;
}

export function SortableStepCard({ step, readOnly = false, ...props }: SortableStepCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id, disabled: readOnly });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <StepCard
        step={step}
        {...props}
        dragHandleListeners={readOnly ? undefined : listeners}
        dragHandleAttributes={readOnly ? undefined : attributes}
        readOnly={readOnly}
        depth={0}
      />
    </div>
  );
}
