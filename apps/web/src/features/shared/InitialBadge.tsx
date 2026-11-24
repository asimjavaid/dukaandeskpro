/** Round initial badge with a stable colour per name (products have no images). */
export function InitialBadge({ name, className }: { name: string; className?: string }) {
  const trimmed = name.trim();
  const initial = trimmed ? Array.from(trimmed)[0].toUpperCase() : '?';
  let h = 0;
  for (const ch of trimmed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return (
    <span
      className={`initial-badge initial-badge--${h % 6}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
