import { getUserName } from "../../utils/userIdentity";
import type { LastEdit } from "../../utils/designHistory";

/** 一覧の更新日の下に、最終編集者を小さく出す (続編 第 9 弾 #171)。自分が最後に編集したものは、印 (自分) を付ける */
export function LastEditor({ edit }: { edit: LastEdit | undefined }) {
  if (!edit) return null;
  const mine = edit.actor === getUserName();
  return (
    <small className={`last-editor${mine ? " is-me" : ""}`} data-testid="last-editor" title={`最後に編集した人: ${edit.actor}${edit.via === "ai" ? " (AI)" : ""}`}>
      {edit.actor}{edit.via === "ai" ? " (AI)" : ""}{mine ? " (自分)" : ""}
    </small>
  );
}
