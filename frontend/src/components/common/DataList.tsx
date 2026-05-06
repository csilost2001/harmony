import { useMemo, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ListSelection } from "../../hooks/useListSelection";
import type { ListClipboard } from "../../hooks/useListClipboard";
import type { ListSort } from "../../hooks/useListSort";
import "../../styles/dataList.css";

export interface DataListColumn<T> {
  key: string;
  header: ReactNode;
  render: (item: T, index: number) => ReactNode;
  width?: string;
  align?: "left" | "center" | "right";
  className?: string;
  /** ヘッダクリックでソート可能にする */
  sortable?: boolean;
  /** ソート時の比較キー。sortable=true の場合に必須 */
  sortAccessor?: (item: T) => string | number;
}

export type DataListLayout = "list" | "grid";

interface Props<T> {
  items: T[];
  columns: DataListColumn<T>[];
  getId: (item: T) => string;
  /**
   * No 列に表示する物理順の取得関数 (docs/spec/list-common.md §3.10)。
   * 省略すると表示位置 (index + 1) にフォールバック。
   * 一覧系アイテム (no フィールドを持つ) では `(item) => item.no` を渡すこと。
   */
  getNo?: (item: T) => number;
  selection?: ListSelection<T>;
  clipboard?: ListClipboard<T>;
  sort?: ListSort<T>;
  onActivate?: (item: T, index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /**
   * 行の削除ボタン (行ゴミ箱, docs/spec/list-common.md §3.11 / §4.6)。
   * 指定時のみ各行の右端にホバー表示。ソート中も有効 (削除は §3.9 の例外)
   */
  onRowDelete?: (item: T) => void;
  /**
   * 右クリックメニュー (docs/spec/list-common.md §3.11 / §4.6)。
   * 行または空領域の右クリック時に呼ばれる。item=null は空領域 (背景) の右クリック。
   * 実装側で `<ListContextMenu>` を表示する。
   */
  onContextMenu?: (e: ReactMouseEvent, item: T | null) => void;
  /** "list" = 表 (既定) / "grid" = カード */
  layout?: DataListLayout;
  /** grid レイアウト時のカードレンダラ (columns は使われない) */
  renderCard?: (item: T, index: number) => ReactNode;
  showNumColumn?: boolean;
  emptyMessage?: ReactNode;
  className?: string;
  variant?: "light" | "dark";
  /** 削除マーク等で ghost 表示する項目判定 (clipboard.isItemCut と OR される) */
  isItemGhost?: (id: string) => boolean;
}

export function DataList<T>({
  items, columns, getId, getNo, selection, clipboard, sort,
  onActivate, onReorder, onRowDelete, onContextMenu,
  layout = "list",
  renderCard,
  showNumColumn = true,
  emptyMessage,
  className,
  variant = "light",
  isItemGhost,
}: Props<T>) {
  // docs/spec/list-common.md §3.9: ソート中は「並び替え Read-only モード」
  // D&D ハンドル・ドロップを無効化する
  const sortActive = (sort?.sortKeys.length ?? 0) > 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const tanstackColumns = useMemo<ColumnDef<T>[]>(() => {
    const helper = createColumnHelper<T>();
    return columns.map((col) =>
      helper.display({
        id: col.key,
        header: () => col.header,
        cell: (ctx) => col.render(ctx.row.original, ctx.row.index),
        meta: { align: col.align, className: col.className, width: col.width, sortable: col.sortable },
      }),
    );
  }, [columns]);

  // TanStack Table のフックは React 19 の incompatible-library ルールに引っかかるが、
  // 推奨どおりのトップレベル呼び出しであり、戻り値は同期レンダーでのみ使用する。
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => getId(row),
  });

  const handleDragStart = (e: { active: { id: string | number } }) => {
    setActiveDragId(String(e.active.id));
    setOverId(null);
  };

  const handleDragOver = (e: DragOverEvent) => {
    setOverId(e.over ? String(e.over.id) : null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveDragId(null);
    setOverId(null);
    if (sortActive) return;
    if (!over || !onReorder) return;
    if (active.id === over.id) return;
    const fromIndex = items.findIndex((it) => getId(it) === active.id);
    const toIndex = items.findIndex((it) => getId(it) === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorder(fromIndex, toIndex);
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    setOverId(null);
  };

  const showHandle = !!onReorder && layout === "list";
  const handleDisabled = showHandle && sortActive;
  const ids = items.map(getId);
  const rootClass = [
    "data-list",
    `data-list-layout-${layout}`,
    `data-list-${variant}`,
    items.length === 0 ? "data-list-empty" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  /**
   * 仕様 §3.1「何もない領域のクリック: 選択解除 (一覧コンテナの背景領域に限定)」
   * 行/カード/ヘッダ/インタラクティブ要素の外側クリックで選択解除する。
   */
  const handleRootClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!selection) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-row-id], button, input, select, textarea, th, a')) {
      return;
    }
    selection.clearSelection();
  };

  /**
   * docs/spec/list-common.md §3.11: 空領域右クリック
   * 行の右クリックは DataListRow / DataListCard 側で個別に捕捉。
   * ここでは「行以外の場所 (背景・ヘッダ等)」での右クリックを拾って item=null で呼ぶ。
   */
  const handleRootContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onContextMenu) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-row-id]')) return; // 行の右クリックは行側で拾う
    e.preventDefault();
    onContextMenu(e, null);
  };

  if (items.length === 0) {
    return (
      <div
        className={rootClass}
        onClick={handleRootClick}
        onContextMenu={onContextMenu ? handleRootContextMenu : undefined}
      >
        {emptyMessage ?? <span>データがありません</span>}
      </div>
    );
  }

  const strategy = layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy;

  /** ドロップ位置インジケータ: 対象行が active より下なら bottom-line、上なら top-line */
  const dropIndicatorFor = (rowId: string): "top" | "bottom" | null => {
    if (!activeDragId || !overId) return null;
    if (rowId !== overId) return null;
    if (activeDragId === overId) return null;
    const activeIdx = items.findIndex((it) => getId(it) === activeDragId);
    const overIdx = items.findIndex((it) => getId(it) === overId);
    if (activeIdx < 0 || overIdx < 0) return null;
    return activeIdx < overIdx ? "bottom" : "top";
  };

  const isRowGhost = (id: string): boolean => {
    if (isItemGhost?.(id)) return true;
    if (clipboard?.isItemCut(id)) return true;
    return false;
  };

  return (
    <div
      className={rootClass}
      data-testid="data-list"
      onClick={handleRootClick}
      onContextMenu={onContextMenu ? handleRootContextMenu : undefined}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={ids} strategy={strategy}>
          {layout === "list" ? (
            <table className="data-list-table">
              <thead>
                <tr>
                  {showHandle && <th className="data-list-th-handle" aria-label="並び替えハンドル" />}
                  {showNumColumn && <th className="data-list-th-num">No</th>}
                  {onRowDelete && <th className="data-list-th-row-delete" aria-label="削除" />}
                  {table.getHeaderGroups()[0].headers.map((header) => {
                    const col = columns.find((c) => c.key === header.column.id)!;
                    const dir = sort?.getSortDirection(col.key) ?? null;
                    const rank = sort?.getSortRank(col.key) ?? null;
                    const isSortable = !!col.sortable && !!sort;
                    return (
                      <th
                        key={col.key}
                        className={[col.className, isSortable ? "data-list-th-sortable" : "", dir ? "data-list-th-sorted" : ""].filter(Boolean).join(" ")}
                        style={{ width: col.width, textAlign: col.align }}
                        onClick={isSortable ? (e) => sort!.toggleSort(col.key, { addKey: e.shiftKey }) : undefined}
                      >
                        <span className="data-list-th-content">
                          {rank !== null && <span className="data-list-sort-rank">{toCircled(rank)}</span>}
                          {col.header as ReactNode}
                          {dir && <i className={`bi ${dir === "asc" ? "bi-caret-up-fill" : "bi-caret-down-fill"} data-list-sort-icon`} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const id = getId(item);
                  return (
                    <DataListRow
                      key={id}
                      item={item}
                      index={index}
                      getId={getId}
                      getNo={getNo}
                      columns={columns}
                      selection={selection}
                      ghost={isRowGhost(id)}
                      onActivate={onActivate}
                      onRowDelete={onRowDelete}
                      onContextMenu={onContextMenu}
                      showHandle={showHandle}
                      handleDisabled={handleDisabled}
                      showNumColumn={showNumColumn}
                      dropIndicator={dropIndicatorFor(id)}
                    />
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="data-list-grid">
              {items.map((item, index) => {
                const id = getId(item);
                return (
                  <DataListCard
                    key={id}
                    item={item}
                    index={index}
                    getId={getId}
                    selection={selection}
                    ghost={isRowGhost(id)}
                    onActivate={onActivate}
                    onRowDelete={onRowDelete}
                    onContextMenu={onContextMenu}
                    renderCard={renderCard}
                    draggable={!!onReorder && !sortActive}
                    dropIndicator={dropIndicatorFor(id)}
                  />
                );
              })}
            </div>
          )}
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface RowProps<T> {
  item: T;
  index: number;
  getId: (item: T) => string;
  getNo?: (item: T) => number;
  columns: DataListColumn<T>[];
  selection?: ListSelection<T>;
  ghost: boolean;
  onActivate?: (item: T, index: number) => void;
  onRowDelete?: (item: T) => void;
  onContextMenu?: (e: ReactMouseEvent, item: T | null) => void;
  showHandle: boolean;
  handleDisabled: boolean;
  showNumColumn: boolean;
  dropIndicator: "top" | "bottom" | null;
}

function DataListRow<T>({
  item, index, getId, getNo, columns, selection, ghost, onActivate, onRowDelete, onContextMenu,
  showHandle, handleDisabled, showNumColumn, dropIndicator,
}: RowProps<T>) {
  const id = getId(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: handleDisabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : ghost ? 0.5 : undefined,
  };

  const selected = selection?.isSelected(id) ?? false;
  const indicatorClass = dropIndicator === "top"
    ? " drop-indicator-top"
    : dropIndicator === "bottom"
      ? " drop-indicator-bottom"
      : "";

  const handleProps = handleDisabled ? {} : { ...attributes, ...listeners };

  const handleContextMenu = (e: ReactMouseEvent) => {
    if (!onContextMenu) return;
    e.preventDefault();
    // 右クリックで未選択行ならその行を選択 (エクスプローラ流)
    if (selection && !selection.isSelected(id)) {
      selection.setSelectedIds(new Set([id]));
    }
    onContextMenu(e, item);
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`data-list-row${selected ? " selected" : ""}${ghost ? " ghost" : ""}${indicatorClass}`}
      onClick={(e) => selection?.handleRowClick(id, e)}
      onDoubleClick={() => onActivate?.(item, index)}
      onContextMenu={onContextMenu ? handleContextMenu : undefined}
      data-testid="data-list-row"
      data-row-id={id}
    >
      {showHandle && (
        <td
          className={`data-list-td-handle${handleDisabled ? " disabled" : ""}`}
          {...handleProps}
          aria-label={handleDisabled ? "並び替え (ソート中は無効)" : "並び替え"}
          title={handleDisabled ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
        >
          <i className="bi bi-grip-vertical" />
        </td>
      )}
      {showNumColumn && <td className="data-list-td-num">{getNo ? getNo(item) : index + 1}</td>}
      {onRowDelete && (
        <td className="data-list-td-row-delete-cell">
          <button
            type="button"
            className="data-list-td-row-delete"
            aria-label="この行を削除"
            title="削除"
            onClick={(e) => { e.stopPropagation(); onRowDelete(item); }}
          >
            <i className="bi bi-trash" />
          </button>
        </td>
      )}
      {columns.map((col) => (
        <td
          key={col.key}
          className={col.className}
          style={{ textAlign: col.align }}
        >
          {col.render(item, index)}
        </td>
      ))}
    </tr>
  );
}

interface CardProps<T> {
  item: T;
  index: number;
  getId: (item: T) => string;
  selection?: ListSelection<T>;
  ghost: boolean;
  onActivate?: (item: T, index: number) => void;
  onRowDelete?: (item: T) => void;
  onContextMenu?: (e: ReactMouseEvent, item: T | null) => void;
  renderCard?: (item: T, index: number) => ReactNode;
  draggable: boolean;
  dropIndicator: "top" | "bottom" | null;
}

function DataListCard<T>({
  item, index, getId, selection, ghost, onActivate, onRowDelete, onContextMenu,
  renderCard, draggable, dropIndicator,
}: CardProps<T>) {
  const id = getId(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : ghost ? 0.5 : undefined,
    position: "relative" as const,
  };
  const selected = selection?.isSelected(id) ?? false;
  const indicatorClass = dropIndicator === "top"
    ? " drop-indicator-left"
    : dropIndicator === "bottom"
      ? " drop-indicator-right"
      : "";

  const handleContextMenu = (e: ReactMouseEvent) => {
    if (!onContextMenu) return;
    e.preventDefault();
    if (selection && !selection.isSelected(id)) {
      selection.setSelectedIds(new Set([id]));
    }
    onContextMenu(e, item);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`data-list-card${selected ? " selected" : ""}${ghost ? " ghost" : ""}${indicatorClass}`}
      onClick={(e) => selection?.handleRowClick(id, e)}
      onDoubleClick={() => onActivate?.(item, index)}
      onContextMenu={onContextMenu ? handleContextMenu : undefined}
      data-testid="data-list-card"
      data-row-id={id}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
    >
      {renderCard ? renderCard(item, index) : <span>{id}</span>}
      {onRowDelete && (
        <button
          type="button"
          className="data-list-card-row-delete"
          aria-label="このカードを削除"
          title="削除"
          onClick={(e) => { e.stopPropagation(); onRowDelete(item); }}
          onPointerDown={(e) => e.stopPropagation()} /* カード全体が D&D ハンドルのため伝播を止める */
        >
          <i className="bi bi-trash" />
        </button>
      )}
    </div>
  );
}

function toCircled(n: number): string {
  // ① ② ③ ...
  if (n < 1 || n > 20) return String(n);
  const base = 0x2460; // ①
  return String.fromCharCode(base + n - 1);
}
