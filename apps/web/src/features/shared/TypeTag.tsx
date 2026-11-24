export type ProductType = 'normal' | 'bulk' | 'packed';

/** Small "Bulk" / "Packed" tag after a product name. Normal shows nothing. */
export function TypeTag({ type }: { type?: ProductType | string | null }) {
  if (type !== 'bulk' && type !== 'packed') return null;
  return (
    <span className={`pt-tag pt-tag--${type}`} data-type-tag={type}>
      {type === 'bulk' ? 'Bulk' : 'Packed'}
    </span>
  );
}
