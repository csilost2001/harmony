import "../../styles/validation.css";

interface Props {
  severity: "error" | "warning";
  count: number;
}

export function ValidationBadge({ severity, count }: Props) {
  if (count <= 0) return null;

  const icon = severity === "error"
    ? "bi-x-circle-fill"
    : "bi-exclamation-triangle-fill";

  return (
    <span className={`validation-badge ${severity}`}>
      <i className={`bi ${icon}`} />
      {count}
    </span>
  );
}
