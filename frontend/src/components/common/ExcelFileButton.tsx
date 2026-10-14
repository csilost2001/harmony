/** 「Excel ファイルを読む」: .xlsx の表を、貼り付けと同じタブ区切りの文にして、貼り付けの入力欄へ入れる (予行と重複の確認は、貼り付けの画面が行う) */
import { useRef, useState } from "react";
import { readXlsx, rowsToTsv, type XlsxSheetData } from "@harmony/shared";
import { inflateRaw, readFileBytes } from "../../utils/inflate";
import { reportFailure } from "../../utils/failureToast";

export function ExcelFileButton({ onText }: { onText: (tsv: string) => void }) {
  const [sheets, setSheets] = useState<XlsxSheetData[] | null>(null);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (s: XlsxSheetData) => onText(rowsToTsv(s.rows));
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const list = (await readXlsx(await readFileBytes(f), inflateRaw)).filter((s) => s.rows.some((r) => r.some((c) => c !== "")));
      if (!list.length) throw new Error("表のあるシートが見つかりませんでした");
      setName(f.name); setSheets(list); pick(list[0]);
    } catch (e) { reportFailure(e, "Excel ファイルの読み込み"); } finally { if (inputRef.current) inputRef.current.value = ""; }
  };
  return (
    <div className="paste-cols-excel" data-testid="excel-file">
      <label className="btn btn-sm btn-secondary">
        <i className="bi bi-file-earmark-excel" /> Excel ファイルを読む
        <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="excel-file-input" />
      </label>
      {sheets && sheets.length > 1 && (
        <label> シート ({name})
          <select onChange={(e) => pick(sheets[Number(e.target.value)])} data-testid="excel-file-sheet" aria-label="読み込むシート">{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select>
        </label>
      )}
      {sheets && sheets.length === 1 && <small> {name} の「{sheets[0].name}」を読みました</small>}
    </div>
  );
}
