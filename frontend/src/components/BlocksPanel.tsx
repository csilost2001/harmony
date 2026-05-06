import { useMemo, useState, useCallback } from "react";
import type { BlocksResultProps } from "@grapesjs/react";
import { useEditorMaybe } from "@grapesjs/react";
import type { Block } from "grapesjs";
import { CUSTOM_BLOCK_CATEGORY } from "./design/DesignSubToolbar";
import { deleteCustomBlock } from "../store/customBlockStore";
import { SharedBlockSyncModal } from "./SharedBlockSyncModal";

export function BlocksPanel({ mapCategoryBlocks, dragStart, dragStop }: BlocksResultProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const editor = useEditorMaybe();

  const [syncModal, setSyncModal] = useState<{
    open: boolean;
    blockId: string;
    blockLabel: string;
    content: string;
  }>({ open: false, blockId: "", blockLabel: "", content: "" });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: [string, Block[]][] = [];
    mapCategoryBlocks.forEach((blocks, cat) => {
      const matched = q
        ? blocks.filter((b) =>
            (b.get("label") || "").toString().toLowerCase().includes(q)
          )
        : blocks;
      if (matched.length) result.push([cat, matched]);
    });
    return result;
  }, [mapCategoryBlocks, query]);

  const toggle = (cat: string) =>
    setCollapsed((s) => ({ ...s, [cat]: !s[cat] }));

  const handleDeleteBlock = useCallback(async (block: Block, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!editor) return;
    const id = block.getId();
    const label = block.get("label") || id;
    if (!confirm(`「${label}」を削除しますか？`)) return;
    editor.BlockManager.remove(id);
    await deleteCustomBlock(id);
  }, [editor]);

  const handleOpenSyncModal = useCallback((block: Block, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSyncModal({
      open: true,
      blockId: block.getId(),
      blockLabel: String(block.get("label") || block.getId()),
      content: String(block.get("content") || ""),
    });
  }, []);

  return (
    <div className="blocks-panel">
      <div className="blocks-search">
        <i className="bi bi-search" />
        <input
          type="text"
          placeholder="ブロックを検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="clear-btn" onClick={() => setQuery("")}>
            <i className="bi bi-x-circle-fill" />
          </button>
        )}
      </div>

      <div className="blocks-list">
        {filtered.length === 0 && (
          <div className="blocks-empty">
            <i className="bi bi-inbox" />
            <p>該当するブロックがありません</p>
          </div>
        )}
        {filtered.map(([cat, blocks]) => {
          const isCollapsed = query.trim() ? false : !!collapsed[cat];
          const isCustomCategory = cat === CUSTOM_BLOCK_CATEGORY;
          return (
            <section key={cat} className="blocks-category">
              <header
                className="blocks-category-header"
                onClick={() => toggle(cat)}
              >
                <i
                  className={`bi bi-chevron-${isCollapsed ? "right" : "down"}`}
                />
                <span>{cat}</span>
                <span className="count">{blocks.length}</span>
              </header>
              {!isCollapsed && (
                <div className="blocks-grid">
                  {blocks.map((block) => {
                    const isShared = isCustomCategory && (block as unknown as { get(k: string): unknown }).get("shared") === true;
                    return (
                      <div
                        key={block.getId()}
                        className={`block-item${isCustomCategory ? " custom-block" : ""}${isShared ? " shared-block" : ""}`}
                        draggable
                        onDragStart={(ev) => dragStart(block, ev.nativeEvent)}
                        onDragEnd={() => dragStop(false)}
                        title={block.get("label") || ""}
                      >
                        <div
                          className="block-icon"
                          dangerouslySetInnerHTML={{
                            __html: (block.get("media") as string) || "",
                          }}
                        />
                        <div className="block-label">{block.get("label")}</div>
                        {isShared && (
                          <span className="block-shared-badge" title="共有ブロック">
                            <i className="bi bi-share-fill" />
                          </span>
                        )}
                        {isCustomCategory && (
                          <div className="block-action-btns">
                            {isShared && (
                              <button
                                className="block-propagate-btn"
                                onClick={(e) => handleOpenSyncModal(block, e)}
                                title="全画面に反映"
                              >
                                <i className="bi bi-arrow-repeat" />
                              </button>
                            )}
                            <button
                              className="block-delete-btn"
                              onClick={(e) => handleDeleteBlock(block, e)}
                              title="削除"
                            >
                              <i className="bi bi-trash3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <SharedBlockSyncModal
        open={syncModal.open}
        blockId={syncModal.blockId}
        blockLabel={syncModal.blockLabel}
        content={syncModal.content}
        onClose={() => setSyncModal((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}
