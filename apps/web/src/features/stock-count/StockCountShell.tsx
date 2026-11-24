import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { setNavGuard } from '../shared/navGuard';
import { StockCountDashboard } from './StockCountDashboard';
import { StockCountExecution } from './StockCountExecution';
import { StockCountReview } from './StockCountReview';
import type { ExecutionFocus } from './stockCountModel';

type Props = {
  displayName: string;
  onOpenCatalog?: () => void;
};

/**
 * Stock Count v2 (D29): Dashboard → Execution → Review → Approve.
 * Approve is only reachable from Review; Execution never posts.
 */
type View =
  | { kind: 'dashboard'; flash: string | null; key: number }
  | { kind: 'execution'; sessionId: string; focus: ExecutionFocus | null; fromReview: boolean; key: number }
  | { kind: 'review'; sessionId: string; key: number }
  | { kind: 'report'; sessionId: string; key: number };

let viewSeq = 0;
const nextKey = () => (viewSeq += 1);

export function StockCountShell({ displayName, onOpenCatalog }: Props) {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: 'dashboard', flash: null, key: nextKey() });
  /** True while Execution has counts queued or saving. */
  const dirtyRef = useRef(false);

  useEffect(() => {
    setNavGuard(() => {
      if (!dirtyRef.current) return true;
      return window.confirm(t('stockCountDiscardDirty'));
    });
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      setNavGuard(null);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [t]);

  useEffect(() => {
    if (view.kind !== 'execution') dirtyRef.current = false;
    document.getElementById('shell-main')?.scrollTo?.({ top: 0 });
  }, [view]);

  const toDashboard = useCallback((flash?: string) => {
    setView({ kind: 'dashboard', flash: flash ?? null, key: nextKey() });
  }, []);

  const toExecution = useCallback(
    (sessionId: string, focus: ExecutionFocus | null = null, fromReview = false) => {
      setView({ kind: 'execution', sessionId, focus, fromReview, key: nextKey() });
    },
    [],
  );

  const toReview = useCallback((sessionId: string) => {
    setView({ kind: 'review', sessionId, key: nextKey() });
  }, []);

  const toReport = useCallback((sessionId: string) => {
    setView({ kind: 'report', sessionId, key: nextKey() });
  }, []);

  switch (view.kind) {
    case 'dashboard':
      return (
        <StockCountDashboard
          key={view.key}
          displayName={displayName}
          flash={view.flash}
          onOpenCatalog={onOpenCatalog}
          onOpenExecution={(id) => toExecution(id)}
          onOpenReport={toReport}
        />
      );
    case 'execution':
      return (
        <StockCountExecution
          key={view.key}
          sessionId={view.sessionId}
          focus={view.focus}
          fromReview={view.fromReview}
          dirtyRef={dirtyRef}
          onOpenCatalog={onOpenCatalog}
          onDashboard={toDashboard}
          onReview={() => toReview(view.sessionId)}
        />
      );
    case 'review':
      return (
        <StockCountReview
          key={view.key}
          sessionId={view.sessionId}
          onBackToCounting={() => toExecution(view.sessionId)}
          onRecount={(focus) => toExecution(view.sessionId, focus, true)}
          onDashboard={toDashboard}
          onViewReport={toReport}
        />
      );
    case 'report':
      return (
        <StockCountReview
          key={view.key}
          sessionId={view.sessionId}
          readOnly
          onBackToCounting={() => toDashboard()}
          onRecount={() => undefined}
          onDashboard={toDashboard}
          onViewReport={toReport}
        />
      );
  }
}
