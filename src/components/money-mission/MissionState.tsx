export function MissionState({
  status,
  title,
  detail,
  actionLabel,
  onAction
}: {
  status: 'loading' | 'empty' | 'error' | 'offline';
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="mission-state" data-status={status} role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
      {actionLabel && onAction ? <button type="button" className="mission-secondary" onClick={onAction}>{actionLabel}</button> : null}
    </section>
  );
}
