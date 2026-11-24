import { useState } from 'react';
import { useI18n } from '../../i18n';

type Props = {
  code: string;
  storeName?: string;
  busy?: boolean;
  onDone: () => void;
};

function printCode(code: string, storeName?: string) {
  const f = document.createElement('iframe');
  f.style.position = 'fixed';
  f.style.width = '0';
  f.style.height = '0';
  f.style.border = '0';
  document.body.appendChild(f);
  const d = f.contentDocument;
  if (!d) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  d.open();
  d.write(`<!DOCTYPE html><html><head><title>Recovery code</title><style>
    body{font-family:system-ui,sans-serif;padding:24px;text-align:center}
    .c{font:700 28px ui-monospace,Consolas,monospace;letter-spacing:.12em;margin:16px 0}
  </style></head><body>
  <div>${esc(storeName ?? 'DukaanDesk')}</div>
  <div>Owner recovery code</div>
  <div class="c">${esc(code)}</div>
  <div>${new Date().toLocaleDateString('en-PK')}</div>
  </body></html>`);
  d.close();
  setTimeout(() => {
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 1000);
  }, 50);
}

/** Shows a freshly issued recovery code once; must be acknowledged to close. */
export function RecoveryCodeModal({ code, storeName, busy, onDone }: Props) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="pos-modal-backdrop">
      <div className="pos-modal recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h3 id="recovery-title">{t('recoveryTitle')}</h3>
        <p className="recovery-code ltr-isolate" dir="ltr" data-testid="recovery-code">
          {code}
        </p>
        <div className="recovery-modal__tools">
          <button type="button" className="btn btn--ghost" onClick={() => void copy()}>
            {copied ? t('recoveryCopied') : t('recoveryCopy')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => printCode(code, storeName)}>
            {t('recoveryPrint')}
          </button>
        </div>
        <label className="recovery-modal__ack">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>{t('recoverySaved')}</span>
        </label>
        <div className="pos-modal__actions">
          <button type="button" className="btn btn--teal" disabled={!saved || busy} onClick={onDone}>
            {t('recoveryDone')}
          </button>
        </div>
      </div>
    </div>
  );
}
