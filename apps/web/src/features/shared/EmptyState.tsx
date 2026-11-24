import type { ReactNode } from 'react';

type Props = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/** Shared empty-state pattern: title + one sentence + optional primary CTA. */
export function EmptyState({ title, description, action, className }: Props) {
  return (
    <div
      className={`empty-state${className ? ` ${className}` : ''}`}
      role="status"
    >
      <h3 className="empty-state__title">{title}</h3>
      {description ? <p className="empty-state__desc">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
