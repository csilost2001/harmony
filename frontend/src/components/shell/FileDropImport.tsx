/**
 * 画面のどこへでも、ファイルをドロップして取り込みを始める (UI 改善提案 第 3 弾 #46)。
 * .sql / .ddl = DDL → テーブル、.json = OpenAPI → 処理フローの骨組み。「連携と運用 → 取り込み」を開き、内容を入れる (予行の確認が出る。まだ何も作らない)。
 * .xlsx は、カラム・項目の「貼り付け」ダイアログの「Excel ファイルを読む」から。
 * ファイルを受ける欄 (ファイル選択・文の入力欄) の上へのドロップは、その欄に任せる。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { importKindOf, setPendingImport } from "../../store/pendingImport";
import { readFileBytes } from "../../utils/inflate";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
const ownsFiles = (t: EventTarget | null) => t instanceof Element && !!t.closest('input[type="file"], textarea, [data-file-drop="own"]');

export const OPS_TAB_EVENT = "harmony:ops-tab";

export function FileDropImport() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => { if (hasFiles(e) && !ownsFiles(e.target)) { depth++; setOver(true); } };
    const onOver = (e: DragEvent) => { if (hasFiles(e) && !ownsFiles(e.target)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const onLeave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (depth === 0) setOver(false); } };
    const onDrop = (e: DragEvent) => {
      depth = 0; setOver(false);
      if (!hasFiles(e) || ownsFiles(e.target)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const kind = importKindOf(file.name);
      if (!kind) { showToast("取り込めるファイルは、.sql / .ddl (DDL)、.json (OpenAPI) です", "info"); return; }
      if (kind === "xlsx") { showToast("Excel の表は、テーブルの「カラムを貼り付け」・画面項目の「項目を貼り付け」の「Excel ファイルを読む」から取り込めます", "info"); return; }
      readFileBytes(file).then((bytes) => {
        setPendingImport(kind, new TextDecoder("utf-8").decode(bytes));
        try { localStorage.setItem("harmony.operations.tab", "import"); } catch { /* 保存できなくても、イベントで切り替わる */ }
        navigate(wsPath("/operations"));
        window.dispatchEvent(new CustomEvent(OPS_TAB_EVENT, { detail: "import" }));
        showToast(`${file.name} を読み込みました。内容を確認して、取り込むものを選んでください`, "info");
      }).catch((err) => reportFailure(err, "ファイルのドロップ"));
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragenter", onEnter); window.removeEventListener("dragover", onOver); window.removeEventListener("dragleave", onLeave); window.removeEventListener("drop", onDrop); };
  }, [navigate, wsPath]);

  if (!over) return null;
  return (
    <div className="file-drop-overlay" aria-hidden="true" data-testid="file-drop-overlay">
      <div><i className="bi bi-box-arrow-in-down" /> ここへ放すと、取り込みを始めます<small>.sql / .ddl (DDL → テーブル) / .json (OpenAPI → 処理フロー)</small></div>
    </div>
  );
}
