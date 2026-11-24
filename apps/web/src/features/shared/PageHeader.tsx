import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  /** Ignored: the signed-in name already shows in the header chip. */
  subtitle?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Module main-view title row, rendered as the first child of the view's
 * `.card` (same look as Catalog / Sell / Customers). Actions sit inline-end.
 */
export function PageHeader({ title, note, actions, className }: Props) {
  return (
    <header className={`page-head${className ? ` ${className}` : ''}`}>
      <div className="page-head__text">
        <h2 className="page-head__title">{title}</h2>
        {note ? <p className="muted page-head__note">{note}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}
