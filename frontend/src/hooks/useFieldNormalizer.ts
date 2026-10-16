import { useEffect } from "react";
import { setFieldValue } from "./useGridKeyboard";
import { describeNormalization, normalizeField, normalizePasted } from "../utils/fieldNormalize";
import { showToast } from "../utils/toast";

/**
 * `data-norm="ascii"` を付けた欄 (ID・物理名・コード) の、全角・空白の正規化 (UI 改善提案 第 5 弾 #94)。アプリの上位で 1 回だけ使う。
 * - 貼り付け: 全角を半角にし、前後の空白・改行を除いて入れる。入力欄の標準の挿入を使うので、Ctrl+Z で貼り付ける前に戻せる
 * - 入力が終わったとき (フォーカスが外れたとき): 値に全角・前後の空白が残っていれば直す (日本語入力の変換中は、触らない)
 * どちらも、直したときだけ知らせる。名称の欄 (印の無い欄) は、変換しない。
 */
const isAscii = (t: EventTarget | null): t is HTMLInputElement => t instanceof HTMLInputElement && t.dataset.norm === "ascii";

export function useFieldNormalizer(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!isAscii(e.target) || e.target.readOnly || e.target.disabled) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const r = normalizePasted(text);
      if (!r.changed) return;
      e.preventDefault();
      // 標準の挿入 (元に戻す履歴に載る)。使えない環境では、範囲を置き換えて、入力の知らせを出す
      if (!document.execCommand("insertText", false, r.value)) {
        const el = e.target;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        setFieldValue(el, el.value.slice(0, start) + r.value + el.value.slice(end));
      }
      showToast(`${describeNormalization(text, r.value)} (Ctrl+Z で貼り付ける前に戻せます)`, "info");
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = e.target;
      if (!isAscii(el) || el.readOnly || el.disabled) return;
      if ((e as unknown as { isComposing?: boolean }).isComposing) return;
      const r = normalizeField(el.value);
      if (!r.changed) return;
      const before = el.value;
      setFieldValue(el, r.value);
      showToast(describeNormalization(before, r.value), "info");
    };
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => { document.removeEventListener("paste", onPaste, true); document.removeEventListener("focusout", onFocusOut, true); };
  }, []);
}
