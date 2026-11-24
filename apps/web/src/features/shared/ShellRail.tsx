import { UrHint, useI18n, type MessageKey } from '../../i18n';
import { NavIcon, type NavIconName } from './NavIcons';

export type RailItem<V extends string> = {
  view: V;
  labelKey: MessageKey;
  icon: NavIconName;
};

export type RailSection<V extends string> = {
  id: string;
  headingKey?: MessageKey;
  items: RailItem<V>[];
};

type Props<V extends string> = {
  ariaLabel: string;
  sections: RailSection<V>[];
  /** Pinned to the bottom of the rail, above sign out / collapse. */
  footSection?: RailSection<V>;
  view: V;
  collapsed: boolean;
  onNavigate: (view: V) => void;
  onToggleCollapsed: () => void;
  onSignOut: () => void;
};

export function ShellRail<V extends string>({
  ariaLabel,
  sections,
  footSection,
  view,
  collapsed,
  onNavigate,
  onToggleCollapsed,
  onSignOut,
}: Props<V>) {
  const { t } = useI18n();

  function renderSection(section: RailSection<V>) {
    const headingId = section.headingKey ? `rail-heading-${section.id}` : undefined;
    return (
      <div
        key={section.id}
        className="shell__rail-group"
        role="group"
        aria-labelledby={headingId}
      >
        {section.headingKey ? (
          <div id={headingId} className="shell__rail-heading">
            <span className="shell__rail-heading-text">{t(section.headingKey)}</span>
          </div>
        ) : null}
        {section.items.map((item) => {
          const active = view === item.view;
          const label = t(item.labelKey);
          return (
            <button
              key={item.view}
              type="button"
              className={['shell__nav-item', active ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? label : undefined}
              onClick={() => onNavigate(item.view)}
            >
              <NavIcon name={item.icon} />
              <span className="shell__nav-label">
                {label}
                <UrHint k={item.labelKey} short />
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  const toggleLabel = collapsed ? t('expandNav') : t('collapseNav');

  return (
    <nav
      className={['shell__rail', collapsed ? 'shell__rail--collapsed' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label={ariaLabel}
    >
      <div className="shell__rail-main">{sections.map(renderSection)}</div>
      <div className="shell__rail-foot">
        {footSection ? renderSection(footSection) : null}
        <div className="shell__rail-group shell__rail-group--actions">
          {/* Dark Mode toggle removed (G11, light theme only); theme.ts keeps the code. */}
          <button
            type="button"
            className="shell__nav-item"
            title={collapsed ? t('signOut') : undefined}
            onClick={onSignOut}
          >
            <NavIcon name="signOut" />
            <span className="shell__nav-label">{t('signOut')}</span>
          </button>
          <button
            type="button"
            className="shell__nav-item shell__nav-item--toggle"
            aria-expanded={!collapsed}
            aria-controls="shell-main"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggleCollapsed}
          >
            <NavIcon name={collapsed ? 'railExpand' : 'railCollapse'} />
            <span className="shell__nav-label">{toggleLabel}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
