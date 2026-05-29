// harmony-externals/puck.mjs — 外部 component 用 @measured/puck shim (#1409 P-1)
//
// host 共有の Puck namespace を re-export。DropZone / Render 等 (slot 連携は P-3 で拡充)。
const m = (window.__HARMONY_SHARED_DEPS__ ?? {})["@measured/puck"];
if (!m) {
  throw new Error(
    "[harmony-externals] @measured/puck bridge 未設置。main.tsx の bridge 設置を確認してください。",
  );
}
export default m;
export const { DropZone, Puck, Render } = m;
