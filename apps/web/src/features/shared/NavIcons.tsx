import type { ReactNode } from 'react';
/** Simple 20×20 line icons for the left rail. Stroke uses currentColor (chai/teal via CSS). */
export type NavIconName =
  | 'catalog'
  | 'stockCount'
  | 'sell'
  | 'parties'
  | 'analytics'
  | 'expenses'
  | 'suppliers'
  | 'purchases'
  | 'tax'
  | 'backup'
  | 'staff'
  | 'settings'
  | 'today'
  | 'signOut'
  | 'moon'
  | 'sun'
  | 'railCollapse'
  | 'railExpand'
  // Analytics card icons (same 20×20 line set and stroke).
  | 'cash'
  | 'khata'
  | 'stock'
  | 'trendDown'
  | 'trendUp'
  | 'receipt'
  | 'returns'
  | 'warning'
  | 'till'
  | 'repack'
  // Sell screen controls (same line set).
  | 'scan'
  | 'plus'
  | 'minus'
  | 'close';

type Props = { name: NavIconName; className?: string };

function SvgBase({
  children,
  flip,
  className,
}: {
  children: ReactNode;
  flip?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={['shell__nav-icon', flip ? 'shell__nav-icon--flip' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function NavIcon({ name, className }: Props) {
  const Svg = (p: { children: ReactNode; flip?: boolean }) => (
    <SvgBase {...p} className={className} />
  );
  switch (name) {
    case 'catalog':
      return (
        <Svg>
          <path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7Z" {...stroke} />
          <path d="M10 10v7M3.5 6.5 10 10l6.5-3.5" {...stroke} />
        </Svg>
      );
    case 'stockCount':
      return (
        <Svg>
          <rect x="4" y="3.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" {...stroke} />
          <path d="M7 7.5l1 1 2-2.5" {...stroke} />
        </Svg>
      );
    case 'sell':
      return (
        <Svg>
          <path
            d="M5 7.5h10l-.8 7.2a1.5 1.5 0 0 1-1.5 1.3H7.3a1.5 1.5 0 0 1-1.5-1.3L5 7.5Z"
            {...stroke}
          />
          <path d="M7.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5" {...stroke} />
        </Svg>
      );
    case 'parties':
      return (
        <Svg>
          <circle cx="7.5" cy="7" r="2.25" {...stroke} />
          <path d="M3.5 15.5c.4-2.4 2-3.75 4-3.75s3.6 1.35 4 3.75" {...stroke} />
          <circle cx="13.25" cy="7.25" r="1.75" {...stroke} />
          <path d="M12 11.75c1.35.2 2.45 1.1 2.75 2.75" {...stroke} />
        </Svg>
      );
    case 'suppliers':
      return (
        <Svg>
          <path d="M2.75 12.25h8.5V6.75h-8.5v5.5Z" {...stroke} />
          <path d="M11.25 12.25h2.1l2.4-3H11.25v3Z" {...stroke} />
          <circle cx="6" cy="14.6" r="1.35" {...stroke} />
          <circle cx="13.6" cy="14.6" r="1.35" {...stroke} />
          <path d="M7.35 14.6h4.9" {...stroke} />
        </Svg>
      );
    case 'purchases':
      return (
        <Svg>
          <path
            d="M5 3.5h6.2L15.5 8v8.5A1.5 1.5 0 0 1 14 18H5A1.5 1.5 0 0 1 3.5 16.5v-11.5A1.5 1.5 0 0 1 5 3.5Z"
            {...stroke}
          />
          <path d="M11 3.5V8h4.5" {...stroke} />
          <path d="M6.5 11.5h6M6.5 14.5h4" {...stroke} />
        </Svg>
      );
    case 'analytics':
      return (
        <Svg>
          <path d="M3.5 16.5h13" {...stroke} />
          <path d="M5.5 16.5V10" {...stroke} />
          <path d="M10 16.5V5.5" {...stroke} />
          <path d="M14.5 16.5v-4" {...stroke} />
        </Svg>
      );
    case 'expenses':
      return (
        <Svg>
          <rect x="3.5" y="5" width="13" height="10" rx="1.5" {...stroke} />
          <path d="M3.5 8.5h13" {...stroke} />
          <path d="M7 12.5h2.5M12.5 12.5h1" {...stroke} />
        </Svg>
      );
    case 'tax':
      return (
        <Svg>
          <path
            d="M5 3.5h10v13l-1.65-1.1-1.65 1.1-1.7-1.1-1.7 1.1-1.65-1.1L5 16.5v-13Z"
            {...stroke}
          />
          <path d="M12.25 7.25 7.75 11.75" {...stroke} />
          <circle cx="8" cy="7.5" r="0.9" {...stroke} />
          <circle cx="12" cy="11.5" r="0.9" {...stroke} />
        </Svg>
      );
    case 'backup':
      return (
        <Svg>
          <ellipse cx="10" cy="5.25" rx="5.5" ry="1.75" {...stroke} />
          <path d="M4.5 5.25v9.5c0 .97 2.46 1.75 5.5 1.75s5.5-.78 5.5-1.75v-9.5" {...stroke} />
          <path d="M4.5 10c0 .97 2.46 1.75 5.5 1.75s5.5-.78 5.5-1.75" {...stroke} />
        </Svg>
      );
    case 'staff':
      return (
        <Svg>
          <circle cx="10" cy="7" r="2.5" {...stroke} />
          <path d="M5 16c.5-2.8 2.4-4.25 5-4.25S14.5 13.2 15 16" {...stroke} />
          <path d="M14.5 5.5 16 7l-1.5 1.5" {...stroke} />
        </Svg>
      );
    case 'settings':
      return (
        <Svg>
          <circle cx="10" cy="10" r="2.25" {...stroke} />
          <path
            d="M10 3.5v1.75M10 14.75V16.5M3.5 10h1.75M14.75 10H16.5M5.4 5.4l1.24 1.24M13.36 13.36l1.24 1.24M14.6 5.4l-1.24 1.24M6.64 13.36l-1.24 1.24"
            {...stroke}
          />
        </Svg>
      );
    case 'today':
      return (
        <Svg>
          <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" {...stroke} />
          <path d="M3.5 8h13M7 3.5v2.5M13 3.5v2.5M7.5 12h2M11.5 12h1" {...stroke} />
        </Svg>
      );
    case 'signOut':
      return (
        <Svg flip>
          <path d="M8.5 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h3" {...stroke} />
          <path d="M11 10h5.5M14 7l2.5 3L14 13" {...stroke} />
        </Svg>
      );
    case 'moon':
      return (
        <Svg>
          <path d="M15.5 12.5A6 6 0 0 1 7.5 4.5a6 6 0 1 0 8 8Z" {...stroke} />
        </Svg>
      );
    case 'sun':
      return (
        <Svg>
          <circle cx="10" cy="10" r="3.2" {...stroke} />
          <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" {...stroke} />
        </Svg>
      );
    case 'railCollapse':
      return (
        <Svg flip>
          <path d="M12.5 4.5 7 10l5.5 5.5" {...stroke} />
        </Svg>
      );
    case 'railExpand':
      return (
        <Svg flip>
          <path d="M7.5 4.5 13 10l-5.5 5.5" {...stroke} />
        </Svg>
      );
    case 'cash':
      return (
        <Svg>
          <rect x="2.5" y="5.5" width="15" height="9" rx="1.5" {...stroke} />
          <circle cx="10" cy="10" r="2" {...stroke} />
          <path d="M5.5 10h.01M14.5 10h.01" {...stroke} />
        </Svg>
      );
    case 'khata':
      return (
        <Svg>
          <rect x="4.5" y="3" width="11" height="14" rx="1.5" {...stroke} />
          <path d="M7.5 3v14M10 7h3M10 10h3M10 13h2" {...stroke} />
        </Svg>
      );
    case 'stock':
      return (
        <Svg>
          <path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7Z" {...stroke} />
          <path d="M10 10v7M3.5 6.5 10 10l6.5-3.5" {...stroke} />
        </Svg>
      );
    case 'trendDown':
      return (
        <Svg>
          <path d="M3.5 6.5l5 5 3-3 5 5" {...stroke} />
          <path d="M16.5 9.5v4h-4" {...stroke} />
        </Svg>
      );
    case 'trendUp':
      return (
        <Svg>
          <path d="M3.5 13.5l5-5 3 3 5-5" {...stroke} />
          <path d="M12.5 6.5h4v4" {...stroke} />
        </Svg>
      );
    case 'returns':
      return (
        <Svg>
          <path d="M7.5 5.5 4.5 8.5l3 3" {...stroke} />
          <path d="M4.5 8.5h7.25a3.75 3.75 0 0 1 0 7.5H9" {...stroke} />
        </Svg>
      );
    case 'receipt':
      return (
        <Svg>
          <path
            d="M5 3.5h10v13l-1.65-1.1-1.65 1.1-1.7-1.1-1.7 1.1-1.65-1.1L5 16.5v-13Z"
            {...stroke}
          />
          <path d="M7.5 7.5h5M7.5 10.5h5" {...stroke} />
        </Svg>
      );
    case 'warning':
      return (
        <Svg>
          <path d="M10 3.5 17 16H3l7-12.5Z" {...stroke} />
          <path d="M10 8.5v3M10 13.75h.01" {...stroke} />
        </Svg>
      );
    case 'repack':
      return (
        <Svg>
          <path d="M3.5 4.5h7l1 4h-9l1-4Z" {...stroke} />
          <path d="M3 8.5h9.5v8H3z" {...stroke} />
          <path d="M14 10.5h3v6h-3zM14.5 10.5V9h2v1.5" {...stroke} />
        </Svg>
      );
    case 'till':
      return (
        <Svg>
          <rect x="3" y="9.5" width="14" height="7" rx="1.5" {...stroke} />
          <path d="M5.5 9.5V4.5h9v5M8 13h4M8 7h4" {...stroke} />
        </Svg>
      );
    case 'scan':
      return (
        <Svg>
          <path d="M3.5 6.5v-2a1 1 0 0 1 1-1h2M13.5 3.5h2a1 1 0 0 1 1 1v2M16.5 13.5v2a1 1 0 0 1-1 1h-2M6.5 16.5h-2a1 1 0 0 1-1-1v-2" {...stroke} />
          <path d="M6.5 7v6M9 7v6M11.5 7v6M13.5 7v6" {...stroke} />
        </Svg>
      );
    case 'plus':
      return (
        <Svg>
          <path d="M10 4.5v11M4.5 10h11" {...stroke} />
        </Svg>
      );
    case 'minus':
      return (
        <Svg>
          <path d="M4.5 10h11" {...stroke} />
        </Svg>
      );
    case 'close':
      return (
        <Svg>
          <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" {...stroke} />
        </Svg>
      );
    default:
      return null;
  }
}
