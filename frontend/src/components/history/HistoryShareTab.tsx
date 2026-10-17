/**
 * 共有・書き出し: この設計 1 件だけの設計書 (HTML / Word / Markdown) の書き出し (#169) と、原本ファイルの場所のコピー (#179)。
 * 場所は、AI (MCP・コーディングエージェント) や Git で扱うときに渡せる。ファイルを開く操作は、ブラウザからはできないので持たない。
 */
import { useEffect, useState } from "react";
import { buildDesignDocument, blocksToMarkdown, htmlToBlocks, renderStandaloneDesignDoc } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { reportFailure } from "../../utils/failureToast";
import { HISTORY_KIND_LABELS, type TabDesign } from "../../utils/designHistory";
import { inputForDesign, singleDesignFileStem, supportsSingleDesign } from "../../utils/singleDesign";
import { writeClipboardText } from "../../utils/tableExport";
import { showToast } from "../../utils/toast";
import { saveBytesFile, saveTextFile } from "../analysis/fileIo";
import { loadDesignInput } from "../document/loadDesignInput";
import { designDocx, DOCX_MIME } from "../document/officeExport";

interface Located { relPath: string; absPath: string; exists: boolean }

export function HistoryShareTab({ design, label }: { design: TabDesign; label: string }) {
  const [loc, setLoc] = useState<Located | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    mcpBridge.request("fileVersions.locate", { resourceType: design.versionType ?? "screen", resourceId: design.id })
      .then((r) => { if (alive) setLoc(r as Located); })
      .catch((e) => { if (alive) setLocError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [design.versionType, design.id]);

  const copy = (text: string, what: string) => { writeClipboardText(text).then(() => showToast(`${what}をコピーしました`)).catch((e) => reportFailure(e, `${what}のコピー`)); };
  const kindLabel = HISTORY_KIND_LABELS[design.kind];
  const aiPrompt = loc ? `Harmony の設計ファイルを読んで、次の依頼に答えてください。\n- 設計: ${kindLabel}「${label}」 (id: ${design.id})\n- ファイル: ${loc.relPath} (ワークスペースからの相対パス)\n\n依頼: ` : "";

  const exportOne = async (format: "html" | "docx" | "md") => {
    setBusy(true);
    try {
      const { input } = await loadDesignInput();
      const sub = inputForDesign(input, design.kind, design.id);
      if (!sub) { showToast("この設計は、設計書に載っていません (読み込みに失敗しているか、削除されています)", "error"); return; }
      const withDate = { ...sub, generatedAt: new Date().toISOString() };
      const stem = singleDesignFileStem(input.project.id, design.kind, design.id);
      if (format === "html") saveTextFile(`${stem}.html`, renderStandaloneDesignDoc(withDate), "text/html");
      else if (format === "docx") saveBytesFile(`${stem}.docx`, designDocx(withDate), DOCX_MIME);
      else saveTextFile(`${stem}.md`, blocksToMarkdown(htmlToBlocks(buildDesignDocument(withDate).html)), "text/markdown");
      showToast(`${kindLabel}「${label}」の設計書を保存しました`);
    } catch (e) { reportFailure(e, "この設計だけの書き出し"); } finally { setBusy(false); }
  };

  return (
    <div data-testid="dh-share">
      <section>
        <h3 className="dh-h">この設計だけを書き出す</h3>
        {supportsSingleDesign(design.kind) ? (
          <>
            <div className="dh-copy-row">
              <button type="button" className="an-btn" disabled={busy} onClick={() => void exportOne("html")} data-testid="dh-export-html"><i className="bi bi-filetype-html" /> HTML</button>
              <button type="button" className="an-btn" disabled={busy} onClick={() => void exportOne("docx")} data-testid="dh-export-docx"><i className="bi bi-file-earmark-word" /> Word</button>
              <button type="button" className="an-btn" disabled={busy} onClick={() => void exportOne("md")} data-testid="dh-export-md"><i className="bi bi-markdown" /> Markdown</button>
            </div>
            <p className="an-hint">表紙・基本情報・この設計の内容だけの設計書です (体裁と改訂履歴の設定は、設計書と同じものを使います)。1 件に絞るため、ほかの設計への参照 (遷移先・参照先テーブルなど) は、設計書の中で「見つからない」要確認として出ることがあります。図と画面の見本は、Word・Markdown には含みません。</p>
          </>
        ) : <p className="an-hint">{kindLabel}は、設計書に章がないため、1 件だけの書き出しには対応していません。</p>}
      </section>
      <section>
        <h3 className="dh-h">原本ファイルの場所</h3>
        {locError ? <p className="an-alert" role="alert">{locError}</p> : !loc ? <p className="an-hint">調べています…</p> : (
          <>
            <p><code className="dh-path" data-testid="dh-path-rel">{loc.relPath}</code>{!loc.exists && <small className="an-hint"> (まだファイルになっていません。保存すると作られます)</small>}</p>
            <div className="dh-copy-row">
              <button type="button" className="an-btn" onClick={() => copy(loc.relPath, "相対パス")} data-testid="dh-copy-rel"><i className="bi bi-clipboard" /> 相対パスをコピー</button>
              <button type="button" className="an-btn" onClick={() => copy(loc.absPath, "絶対パス")} data-testid="dh-copy-abs"><i className="bi bi-clipboard" /> 絶対パスをコピー</button>
              <button type="button" className="an-btn" onClick={() => copy(aiPrompt, "AI への依頼文")} data-testid="dh-copy-ai"><i className="bi bi-robot" /> AI への依頼文の出だしをコピー</button>
            </div>
            <p className="an-hint">相対パスは、ワークスペースのフォルダからの位置です。ブラウザからは、フォルダを開く操作はできないので、パスをコピーして、エクスプローラーや端末で開いてください。</p>
          </>
        )}
      </section>
    </div>
  );
}
