import { UrHint, useI18n } from '../../i18n';
import { PageHeader } from '../shared/PageHeader';
import { RepackPanel, type RepackIntent } from './RepackPanel';

/** Repack screen (menu → Repack, or Repack on a bulk item in Catalog). */
export function RepackShell({
  displayName,
  isOwner,
  intent,
  onIntentUsed,
}: {
  displayName: string;
  isOwner: boolean;
  intent: RepackIntent;
  onIntentUsed: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card repack-shell" data-repack-shell>
      <PageHeader title={<>{t('repackTitle')}<UrHint k="repackTitle" /></>} subtitle={displayName} />
      <RepackPanel isOwner={isOwner} intent={intent} onDone={onIntentUsed} />
    </div>
  );
}
