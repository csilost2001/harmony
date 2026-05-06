/**
 * リソース詳細 URL (/screen/design/:id 等) にヒットしたが
 * 対応するタブがまだ解決されていない短い時間に表示するプレースホルダ。
 *
 * URL→タブ同期 effect が非同期で loadProject/loadTable/loadProcessFlow を
 * 叩くため、1〜数フレームこの UI が出る可能性がある。
 * 以前は element={null} だったため、この間コンテンツ領域が完全に空になって
 * 「真っ白」の症状を招いていた (#124)。
 */
import "../../styles/resourceLoading.css";

interface Props {
  kind: "screen" | "table" | "process-flow";
}

const LABEL: Record<Props["kind"], string> = {
  "screen": "画面",
  "table": "テーブル",
  "process-flow": "処理フロー",
};

export function ResourceLoading({ kind }: Props) {
  return (
    <div className="resource-loading" role="status" aria-live="polite">
      <div className="resource-loading-inner">
        <div className="resource-loading-spinner" aria-hidden="true" />
        <p>{LABEL[kind]}を読み込んでいます…</p>
      </div>
    </div>
  );
}
