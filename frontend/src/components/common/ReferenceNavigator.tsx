import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { onGoToReference } from "../../utils/referenceTarget";
import { showToast } from "../../utils/toast";

/**
 * 入力欄の参照 (@screen.cart など) の「定義へ移動」(Ctrl+クリック / F12) を受けて、定義の画面を開く。
 * 画面には何も描かない (ヘッダーに 1 つだけ置く)。
 */
export function ReferenceNavigator() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  useEffect(() => onGoToReference((t) => {
    navigate(wsPath(t.route));
    showToast(`定義を開きました: ${t.label}`, "info");
  }), [navigate, wsPath]);
  return null;
}
