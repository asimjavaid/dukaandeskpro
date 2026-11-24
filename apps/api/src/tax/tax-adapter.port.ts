/**
 * Tax authority adapter port (D23).
 * P1: simulate + queue only. Live FBR path OPEN — do not invent fields or accept codes.
 * Product-side outcomes only: accepted | rejected | pending.
 */
export type TaxDocumentPayload = Record<string, unknown>;

export type TaxSimulateOutcome = 'accepted' | 'rejected';

export type TaxAdapterSubmitResult = {
  /** Opaque stub ref — never an invented FBR invoice/accept code. */
  providerRef?: string;
  /** Opaque reason stub when rejected (e.g. sim_reject). */
  reasonStub?: string;
  raw?: unknown;
};

export interface TaxAdapterPort {
  readonly name: string;
  submit(
    doc: TaxDocumentPayload,
    opts?: { outcome?: TaxSimulateOutcome },
  ): Promise<TaxAdapterSubmitResult>;
  mapStatus(raw: unknown): TaxSimulateOutcome | 'pending';
}

export const TAX_ADAPTER = Symbol('TAX_ADAPTER');
