import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { onFindReferences, onGoToReference, type ReferenceTarget } from "../../utils/referenceTarget";
import { ReferencesDialog } from "./ReferencesButton";
import { showToast } from "../../utils/toast";

/**
 * 入力欄の参照 (@screen.cart など) の「定義へ移動」(Ctrl+クリック / F12) を受けて、定義の画面を開く。
 * 参照元の一覧 (Shift+F12) のダイアログも、ここで開く。ヘッダーに 1 つだけ置く。
 */
export function ReferenceNavigator() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [refs, setRefs] = useState<ReferenceTarget | null>(null);
  // 参照元を調べる (Shift+F12)。調べられる設計 (画面・テーブルなど) 以外は、案内だけ出す
  useEffect(() => onFindReferences((t) => {
    if (t.entity) setRefs(t);
    else showToast(`${t.label} は、参照元を調べられない種類です (画面・テーブル・処理フローなどが対象)`, "info");
  }), []);
  useEffect(() => onGoToReference((t) => {
    navigate(wsPath(t.route));
    showToast(`定義を開きました: ${t.label}`, "info");
  }), [navigate, wsPath]);
  return refs?.entity ? <ReferencesDialog entityType={refs.entity.type} id={refs.entity.id} name={refs.label} onClose={() => setRefs(null)} /> : null;
}
