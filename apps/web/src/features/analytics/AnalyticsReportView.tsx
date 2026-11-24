import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import {
  formatCellForPrint,
  type AnalyticsReport,
  type ReportPaper,
} from './reportModel';

/** Print-ready report page (A4 or Letter from Settings → Reports paper). */
export function ReportSheet({
  report,
  paper,
}: {
  report: AnalyticsReport;
  paper: ReportPaper;
}) {
  const { t } = useI18n();
  return (
    <article className="report-sheet" data-paper={paper}>
      <header className="report-sheet__head">
        <div className="report-sheet__store">
          <p className="report-sheet__store-name">{report.storeName}</p>
          {report.storeLine ? (
            <p className="report-sheet__store-line">{report.storeLine}</p>
          ) : null}
        </div>
        <h2 className="report-sheet__title">{report.title}</h2>
        <dl className="report-sheet__meta">
          {report.meta.map((m) => (
            <div key={m.label} className="report-sheet__meta-row">
              <dt>{m.label}</dt>
              <dd className="ltr-isolate">{m.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {report.tables.map((table) => (
        <section key={table.id} className="report-sheet__section">
          <h3 className="report-sheet__section-title">{table.title}</h3>
          {table.rows.length === 0 ? (
            <p className="report-sheet__empty">{table.empty}</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  {table.columns.map((col) => (
                    <th
                      key={col.label}
                      scope="col"
                      className={col.numeric ? 'report-table__num' : undefined}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, colIdx) => {
                      const numeric = table.columns[colIdx]?.numeric ?? false;
                      const classes = [
                        numeric ? 'report-table__num' : '',
                        cell.kind === 'unknown' ? 'report-table__unknown' : '',
                        cell.kind === 'money' && cell.paisa < 0 ? 'report-table__neg' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      const content = formatCellForPrint(cell);
                      return colIdx === 0 ? (
                        <th key={colIdx} scope="row" className={classes || undefined}>
                          {content}
                        </th>
                      ) : (
                        <td key={colIdx} className={classes || undefined}>
                          {numeric ? <span className="ltr-isolate">{content}</span> : content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {report.notes.map((note) => (
        <p key={note} className="report-sheet__note">
          {note}
        </p>
      ))}

      <footer className="report-sheet__foot">{t('reportFooter')}</footer>
    </article>
  );
}

/**
 * Report preview + print, same pattern as Catalog stickers: a modal preview
 * on screen, and a body-level copy that is the only thing printed.
 */
export function AnalyticsReportPreview({
  report,
  paper,
  onClose,
  onExcel,
}: {
  report: AnalyticsReport;
  paper: ReportPaper;
  onClose: () => void;
  onExcel: () => void;
}) {
  const { t } = useI18n();
  const printRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.body.classList.add('analytics-report-print');
    printRef.current?.focus();
    return () => document.body.classList.remove('analytics-report-print');
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pos-modal-backdrop" onClick={onClose}>
      <div
        className="pos-modal analytics-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="analytics-report-title">{report.title}</h3>
        <p className="muted analytics-report-modal__hint">
          {t('reportsPaper')}: {paper === 'letter' ? t('reportsPaperLetter') : t('reportsPaperA4')}
          {' · '}
          {t('reportPdfHint')}
        </p>
        <div className="analytics-report-modal__preview">
          <ReportSheet report={report} paper={paper} />
        </div>
        <div className="pos-modal__actions">
          <button
            ref={printRef}
            type="button"
            className="btn btn--teal"
            onClick={() => window.print()}
          >
            {t('reportPrintAction')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExcel}>
            {t('reportExcel')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('reportClose')}
          </button>
        </div>
      </div>
      {createPortal(
        <div className="analytics-report-portal">
          <ReportSheet report={report} paper={paper} />
        </div>,
        document.body,
      )}
    </div>
  );
}
