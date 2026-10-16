/**
 * 参照の付け替え (UI 改善提案 第 3 弾 #60)。「参照元」のダイアログの中で、この設計を参照している設計のうち選んだものを、
 * 別の設計の参照に付け替える (改名とは別: この設計は残る)。予行 (何件・何か所) を見てから実行し、5 分以内なら元に戻せる。
 */
import { useEffect, useMemo, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";
import type { ReferenceTargetType } from "../../utils/references";
import { SearchableSelect } from "./SearchableSelect";

interface ReplaceFile { filePath: string; entityKind: string; entityId: string; count: number }
interface ReplacePreview {
  fromExists: boolean; toExists: boolean; files: ReplaceFile[]; totalRefs: number; candidates: string[];
  warnings: string[]; concurrentEditRefs: Array<{ entityKind: string; entityId: string }>;
}

const KIND_LABELS: Record<string, string> = {
  processFlow: "処理フロー", screen: "画面", table: "テーブル", view: "ビュー", viewDefinition: "ビュー定義",
  pageLayout: "ページレイアウト", sequence: "シーケンス", genericDefinition: "汎用定義",
};

export function ReplaceReferencesPanel({ entityType, id, onChanged }: { entityType: ReferenceTargetType; id: string; onChanged: () => void }) {
  const [toId, setToId] = useState("");
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = すべて
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ operationId: string; files: number; refs: number } | null>(null);

  // 付け替え先を選ぶ前から、参照元と候補を出す (付け替え先を選ぶと、止める理由もここに出る)
  useEffect(() => {
    let cancelled = false;
    mcpBridge.request("previewReplaceReferences", { entityType, fromId: id, toId: toId || id })
      .then((r) => { if (!cancelled) { setPreview(r as ReplacePreview); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [entityType, id, toId, done]);

  const files = useMemo(() => preview?.files ?? [], [preview]);
  const chosen = useMemo(() => files.filter((f) => !picked || picked.has(f.filePath)), [files, picked]);
  const refCount = chosen.reduce((a, f) => a + f.count, 0);
  const blockers = [
    ...(toId && preview && !preview.toExists ? ["付け替え先が見つかりません"] : []),
    ...((preview?.concurrentEditRefs.length ?? 0) > 0 ? [`参照元を編集中の人がいます: ${preview!.concurrentEditRefs.map((c) => `${KIND_LABELS[c.entityKind] ?? c.entityKind} ${c.entityId}`).join(", ")}`] : []),
  ];
  const toggle = (path: string) => setPicked((cur) => {
    const base = cur ?? new Set(files.map((f) => f.filePath));
    const next = new Set(base);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const run = async () => {
    setBusy(true);
    try {
      const r = await mcpBridge.request("replaceEntityReferences", { entityType, fromId: id, toId, only: chosen.map((f) => f.filePath) }) as { operationId: string; replaced: ReplaceFile[] };
      setDone({ operationId: r.operationId, files: r.replaced.length, refs: r.replaced.reduce((a, f) => a + f.count, 0) });
      setPicked(null);
      showToast(`${r.replaced.length} 件の設計の参照を、${toId} に付け替えました (参照元のダイアログから、5 分以内なら元に戻せます)`);
      onChanged();
    } catch (e) { reportFailure(e, "参照の付け替え"); } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!done) return;
    setBusy(true);
    try {
      await mcpBridge.request("undoReplaceReferences", { operationId: done.operationId });
      setDone(null);
      showToast("付け替えを元に戻しました");
      onChanged();
    } catch (e) { reportFailure(e, "付け替えの取り消し"); } finally { setBusy(false); }
  };

  return (
    <section className="references-replace" aria-label="参照の付け替え" data-testid="replace-panel">
      <h3><i className="bi bi-arrow-left-right" /> 別の対象へ付け替える</h3>
      <p className="references-muted">選んだ参照元の、<code>{id}</code> への参照を、別の対象に付け替えます。<code>{id}</code> そのものは残ります (改名とは別の操作)。</p>
      {error && <p className="references-error" role="alert">{error}</p>}
      <label className="references-replace-to">
        付け替え先
        <SearchableSelect value={toId} onChange={setToId} emptyLabel="選んでください" options={(preview?.candidates ?? []).map((c) => ({ value: c, label: c }))} ariaLabel="付け替え先" data-testid="replace-to" />
      </label>
      {files.length === 0 && preview && <p className="references-muted">付け替えられる参照元がありません。</p>}
      {files.length > 0 && (
        <ul className="references-replace-files">
          {files.map((f) => (
            <li key={f.filePath}>
              <label><input type="checkbox" checked={!picked || picked.has(f.filePath)} onChange={() => toggle(f.filePath)} data-testid={`replace-file-${f.entityId}`} /> {KIND_LABELS[f.entityKind] ?? f.entityKind} <code>{f.entityId}</code> <span className="references-n">{f.count} か所</span></label>
            </li>
          ))}
        </ul>
      )}
      {(preview?.warnings ?? []).map((w, i) => <p key={i} className="references-muted" role="note">{w}</p>)}
      {blockers.map((b, i) => <p key={i} className="references-error" role="alert">{b}</p>)}
      <div className="references-replace-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || !toId || toId === id || chosen.length === 0 || blockers.length > 0} onClick={() => { void run(); }} data-testid="replace-run">
          {chosen.length} 件の設計 ({refCount} か所) を {toId || "…"} に付け替える
        </button>
        {done && (
          <span className="references-replace-done" data-testid="replace-done">
            {done.files} 件の設計 ({done.refs} か所) を付け替えました。
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => { void undo(); }} data-testid="replace-undo">元に戻す</button>
          </span>
        )}
      </div>
    </section>
  );
}
