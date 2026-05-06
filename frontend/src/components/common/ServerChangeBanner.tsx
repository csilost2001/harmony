import "../../styles/serverChangeBanner.css";

interface Props {
  onReload: () => void;
  onDismiss: () => void;
}

export function ServerChangeBanner({ onReload, onDismiss }: Props) {
  return (
    <div className="server-change-banner" role="alert">
      <i className="bi bi-exclamation-triangle-fill" />
      <span>別のクライアントでデータが変更されました</span>
      <button className="scb-btn scb-btn-reload" onClick={onReload}>再読み込み</button>
      <button className="scb-btn scb-btn-dismiss" onClick={onDismiss}>無視</button>
    </div>
  );
}
