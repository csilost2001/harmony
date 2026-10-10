/**
 * ドラッグ & ドロップで並べ替えられる縦のリスト (業務フロー・帳票の編集画面の左の一覧)。
 * つかむ場所は左端の持ち手だけ (行のクリックは選択のまま)。持ち手にフォーカスして Space で持ち上げ、↑↓ で動かし、
 * Space で置く (Esc で取りやめ)。各行の上へ / 下へのボタンでも動かせる。
 */
import type { ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ListProps {
  ids: string[];
  /** `activeId` を `overId` の位置へ動かした */
  onReorder: (activeId: string, overId: string) => void;
  className?: string;
  testId?: string;
  /** 閲覧のみのときは、持ち手を出さず並べ替えもできない */
  disabled?: boolean;
  children: ReactNode;
}

export function SortableList({ ids, onReorder, className, testId, disabled, children }: ListProps) {
  // 数 px 動かすまでは「クリック」のまま (行の選択を妨げない)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) onReorder(String(e.active.id), String(e.over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={`${className ?? ""}${disabled ? " bfe-sort-disabled" : ""}`.trim()} data-testid={testId}>{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

interface RowProps { id: string; className?: string; label: string; disabled?: boolean; children: ReactNode }

export function SortableRow({ id, className, label, disabled, children }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      className={`${className ?? ""}${isDragging ? " bfe-dragging" : ""}`.trim()}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="bfe-grip" {...attributes} {...listeners} role="button" aria-label={`${label}をドラッグして並べ替え`} title="ドラッグして並べ替え" data-testid={`sortable-grip-${id}`}>
        <i className="bi bi-grip-vertical" />
      </span>
      {children}
    </li>
  );
}
