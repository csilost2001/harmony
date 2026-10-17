/** 設定の書き出し・読み込み (続編 第 10 弾 #191)。このブラウザにだけある設定を、1 つのファイルにして持ち出す。読み込みは、種類を選んで、確認してから */
import { useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { reportFailure } from "../../utils/failureToast";
import { SETTINGS_CATEGORIES, applySettings, exportSettings, parseSettingsFile, type ImportPreview } from "../../utils/settingsBackup";
import { showToast } from "../../utils/toast";
import { saveTextFile } from "../analysis/fileIo";
import "../../styles/pasteColumns.css";

export function SettingsBackupDialog({ onClose }: { onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const doExport = () => {
    try {
      const file = exportSettings(localStorage);
      const n = Object.keys(file.items).length;
      saveTextFile("harmony-settings.json", JSON.stringify(file, null, 2), "application/json");
      showToast(`設定 ${n} 項目を書き出しました`);
    } catch (e) { reportFailure(e, "設定の書き出し"); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setPreview(null);
    try {
      const r = parseSettingsFile(await f.text());
      if (!r.ok) { setError(r.error); return; }
      setPreview(r.preview);
      setPicked(new Set(r.preview.counts.map((c) => c.category.id)));
    } catch (e) { reportFailure(e, "設定ファイルの読み込み"); }
  };

  const doImport = () => {
    if (!preview) return;
    const r = applySettings(localStorage, preview, picked);
    if (r.failed > 0) showToast(`${r.written} 項目を読み込みました (${r.failed} 項目は、ブラウザの保存領域が足りず、書けませんでした)`, "error");
    else showToast(`${r.written} 項目を読み込みました。画面を読み込み直します`);
    // 表示の設定などは、起動時に読むので、読み込み直して反映する
    if (r.written > 0) setTimeout(() => window.location.reload(), 700);
    onClose();
  };

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div ref={trapRef} className="paste-cols-modal" style={{ width: "min(640px, 96vw)" }} role="dialog" aria-modal="true" aria-label="設定の書き出し・読み込み" data-testid="settings-backup">
        <div className="paste-cols-head">
          <h2><i className="bi bi-arrow-left-right" /> 設定の書き出し・読み込み</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <section>
            <h3 style={{ fontSize: "0.95rem" }}>書き出し</h3>
            <p style={{ margin: "0 0 8px", color: "var(--hm-fg-muted)", fontSize: "0.85rem" }}>表示の設定・通知の受け取り方・お気に入り・スニペット・一覧の設定・個人メモなどを、1 つのファイルにします。接続トークン・開いているタブ・下書きは含みません。</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={doExport} data-testid="settings-export"><i className="bi bi-download" /> 設定を書き出す</button>
          </section>
          <section style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: "0.95rem" }}>読み込み</h3>
            <label className="btn btn-secondary btn-sm">設定のファイルを選ぶ<input type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="settings-file" /></label>
            {error && <p role="alert" style={{ color: "var(--hm-danger)" }} data-testid="settings-error">{error}</p>}
            {preview && (
              <div data-testid="settings-preview" style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 6px", fontSize: "0.85rem" }}>読み込む種類を選んでください。同じ名前の設定は、上書きされます (元に戻せません)。{preview.skipped > 0 ? ` 読み込めない項目が ${preview.skipped} 件あり、除きました。` : ""}</p>
                {preview.counts.length === 0 ? <p>読み込める設定が、ファイルにありません。</p> : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {preview.counts.map((c) => (
                      <li key={c.category.id}>
                        <label style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                          <input type="checkbox" checked={picked.has(c.category.id)} onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(c.category.id)) n.delete(c.category.id); else n.add(c.category.id); return n; })} data-testid={`settings-pick-${c.category.id}`} />
                          <span>{c.category.label} <small style={{ color: "var(--hm-fg-muted)" }}>({c.keys.length} 項目{c.category.note ? `。${c.category.note}` : ""})</small></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={picked.size === 0} onClick={doImport} data-testid="settings-import"><i className="bi bi-box-arrow-in-down" /> 選んだ設定を読み込む</button>
              </div>
            )}
          </section>
          <p style={{ marginTop: 14, color: "var(--hm-fg-muted)", fontSize: "0.8rem" }}>設定の種類: {SETTINGS_CATEGORIES.map((c) => c.label.replace(/ \(.*\)$/, "")).join(" / ")}</p>
        </div>
      </div>
    </div>
  );
}
