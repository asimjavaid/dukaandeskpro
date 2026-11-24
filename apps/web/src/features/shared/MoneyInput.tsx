import { forwardRef, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { sanitizeMoneyInput, sanitizeWholeInput } from './amount';

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>;

type Props = Base & {
  value: string;
  /** Called with the cleaned text (digits and at most one "."). */
  onValueChange: (value: string) => void;
  /** Digits allowed after "." (default 2, paisa). Ignored when `whole` is set. */
  maxDecimals?: number;
  /** Whole numbers only (pieces, cartons): no "." at all. */
  whole?: boolean;
};

/** Keys a number pad sends that never belong in a money field. */
const BLOCKED = new Set(['-', '+', 'e', 'E', ',', ' ']);

/**
 * Text input for rupee amounts and counts. Only digits (and one "." for money) get in,
 * whether typed or pasted; "-" is never accepted. Use instead of a bare <input> for amounts.
 */
export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { value, onValueChange, maxDecimals = 2, whole = false, onKeyDown, className, ...rest },
  ref,
) {
  const clean = (raw: string) => (whole ? sanitizeWholeInput(raw) : sanitizeMoneyInput(raw, maxDecimals));

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (BLOCKED.has(e.key) || (whole && e.key === '.')) {
        e.preventDefault();
      } else if (e.key === '.' && value.includes('.')) {
        e.preventDefault();
      }
    }
    onKeyDown?.(e);
  }

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode={whole ? 'numeric' : 'decimal'}
      autoComplete={rest.autoComplete ?? 'off'}
      className={['ltr-isolate', className].filter(Boolean).join(' ')}
      value={value}
      onChange={(e) => onValueChange(clean(e.target.value))}
      onKeyDown={handleKeyDown}
    />
  );
});
