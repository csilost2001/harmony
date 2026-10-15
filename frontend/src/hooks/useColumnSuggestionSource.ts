import { useEffect, useState } from "react";
import { loadAllTables } from "../store/tableStore";
import { loadConventions } from "../store/conventionsStore";
import { buildTermIndex, parseNamingConvention, type NamingConvention, type TermIndex } from "../utils/columnSuggestion";

/**
 * カラムの物理名・型の提案に使う材料 (ほかのテーブルの列から作る索引と、規約の命名表記) を、開いたときに 1 回読む。
 * 読めなければ、辞書だけで提案する (失敗は黙って無視する: 補助なので、編集は止めない)。
 */
export function useColumnSuggestionSource(tableId: string): { index: TermIndex | undefined; convention: NamingConvention } {
  const [index, setIndex] = useState<TermIndex | undefined>(undefined);
  const [convention, setConvention] = useState<NamingConvention>("snake_case");

  useEffect(() => {
    let alive = true;
    loadAllTables()
      .then((tables) => {
        if (alive) setIndex(buildTermIndex(tables.filter((t) => t.id !== tableId).map((t) => t.columns)));
      })
      .catch(() => { /* 辞書だけで提案する */ });
    loadConventions()
      .then((conv) => {
        const db = (conv as unknown as { db?: Record<string, { namingConvention?: string }> } | null)?.db ?? {};
        const found = Object.values(db).find((e) => e?.namingConvention)?.namingConvention;
        if (alive && found) setConvention(parseNamingConvention(found));
      })
      .catch(() => { /* 既定 (snake_case) */ });
    return () => { alive = false; };
  }, [tableId]);

  return { index, convention };
}
