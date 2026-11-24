import {
  TaxAdapterPort,
  TaxDocumentPayload,
  TaxSimulateOutcome,
  TaxAdapterSubmitResult,
} from './tax-adapter.port';

/**
 * Working offline path (D23). Deterministic accepted|rejected.
 * Does NOT invent FBR field payloads or accept codes — opaque provider_ref / reason stubs only.
 */
export class SimulateTaxAdapter implements TaxAdapterPort {
  readonly name = 'simulate';

  async submit(
    doc: TaxDocumentPayload,
    opts?: { outcome?: TaxSimulateOutcome },
  ): Promise<TaxAdapterSubmitResult> {
    const saleId =
      typeof doc.sale_id === 'string'
        ? doc.sale_id
        : typeof doc.id === 'string'
          ? doc.id
          : 'unknown';
    const short = String(saleId).replace(/-/g, '').slice(0, 8);
    const envForce = (process.env.TAX_SIMULATE_OUTCOME ?? '')
      .toLowerCase()
      .trim();
    let outcome: TaxSimulateOutcome = 'accepted';
    if (opts?.outcome === 'accepted' || opts?.outcome === 'rejected') {
      outcome = opts.outcome;
    } else if (envForce === 'rejected' || envForce === 'reject') {
      outcome = 'rejected';
    } else if (envForce === 'accepted' || envForce === 'accept') {
      outcome = 'accepted';
    }

    const providerRef = `sim-${short}-${Date.now()}`;
    if (outcome === 'rejected') {
      return {
        providerRef,
        reasonStub: 'sim_reject',
        raw: { simulate: true, status: 'rejected', providerRef },
      };
    }
    return {
      providerRef,
      raw: { simulate: true, status: 'accepted', providerRef },
    };
  }

  mapStatus(raw: unknown): TaxSimulateOutcome | 'pending' {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (r.status === 'rejected') return 'rejected';
    if (r.status === 'accepted') return 'accepted';
    if (r.simulate === true) return 'accepted';
    return 'pending';
  }
}
