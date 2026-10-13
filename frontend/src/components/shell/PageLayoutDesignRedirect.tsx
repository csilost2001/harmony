import { Navigate, useParams } from "react-router-dom";

export function PageLayoutDesignRedirect() {
  const { pageLayoutId } = useParams<{ pageLayoutId: string }>();
  const targetId = pageLayoutId ? encodeURIComponent(decodeURIComponent(pageLayoutId)) : "";
  return <Navigate to={`../edit/${targetId}`} replace relative="path" />;
}
