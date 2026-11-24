import { useI18n } from '../../i18n';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  disabled?: boolean;
  onPage: (page: number) => void;
};

/** Previous / next. Hidden when everything fits on one page. */
export function Pager({ page, pageSize, total, disabled, onPage }: Props) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const label = t('pageStatus')
    .replace('{page}', String(page))
    .replace('{pages}', String(pages));
  return (
    <div className="pager" role="navigation" aria-label={label}>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t('pagePrev')}
      </button>
      <span className="pager__status ltr-isolate">{label}</span>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={disabled || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t('pageNext')}
      </button>
    </div>
  );
}
