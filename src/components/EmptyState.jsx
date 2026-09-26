export default function EmptyState({ title, children, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <span className="empty-mark" aria-hidden="true" />
      <div className="empty-body">
        {title && <p className="empty-title">{title}</p>}
        {children && <p className="empty-text">{children}</p>}
        {action && <div className="empty-action">{action}</div>}
      </div>
    </div>
  );
}
