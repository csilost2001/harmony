export type DraftResourceType =
  | "screen"
  | "puck-data"  // #806: Puck 画面データ (screens/<id>/puck-data.json)
  | "table"
  | "process-flow"
  | "view"
  | "view-definition"
  | "screen-item"
  | "sequence"
  | "extension"
  | "convention"
  | "flow";  // #690 PR-7: 画面遷移図用
