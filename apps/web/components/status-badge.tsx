type StatusBadgeProps = {
  status: "Live" | "Building" | "Blocked";
};

const CLASS_BY_STATUS = {
  Live: "badge badge-live",
  Building: "badge badge-building",
  Blocked: "badge badge-blocked",
} as const;

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={CLASS_BY_STATUS[status]}>{status}</span>;
}

