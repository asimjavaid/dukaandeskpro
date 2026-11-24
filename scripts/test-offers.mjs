#!/usr/bin/env node
/** WhatsApp offers API: owner-only audience filters + campaign log in activity. SKIP_BUILD=1 node scripts/test-offers.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('offers', Number(process.env.API_PORT ?? 3888));
const R = api.request;
const j = (r) => r.raw.slice(0, 240);
try {
  const s = await seed(api);
  const { owner, cashier, soap, rashid } = s;
  const mk = async (name, phone) => (await R('POST', '/parties', { token: owner, body: { name, phone } })).json.party;
  const sana = await mk('Sana Baji', '03211234567');
  const nophone = await mk('No Phone', '');
  const bad = await mk('Bad Number', '12');
  await R('POST', '/sales', { token: owner, body: { paymentMethod: 'udhaar', partyId: rashid.id, lines: [{ productId: soap.id, qty: 2 }] } });
  await R('POST', '/sales', { token: owner, body: { paymentMethod: 'cash', partyId: sana.id, lines: [{ productId: soap.id, qty: 5 }] } });

  let r = await R('GET', '/parties/offers/audience', { token: cashier });
  ok(r.status === 403, `cashier blocked (${r.status})`);
  r = await R('GET', '/parties/offers/audience?filter=all', { token: owner });
  const names = (r.json?.items ?? []).map((x) => x.name);
  ok(r.json?.ok && names.includes('Rashid Bhai') && names.includes('Sana Baji') && names.includes('Bad Number') && names.includes('No Phone'), `all incl. no phone ${j(r)}`);
  r = await R('GET', '/parties/offers/audience?filter=khata', { token: owner });
  ok(r.json.items.length === 1 && r.json.items[0].id === rashid.id, `khata ${j(r)}`);
  r = await R('GET', '/parties/offers/audience?filter=recent', { token: owner });
  ok(r.json.items.length === 2, `recent ${j(r)}`);
  r = await R('GET', '/parties/offers/audience?filter=top', { token: owner });
  ok(r.json.items[0].id === sana.id && r.json.items[0].spent_30d_paisa === 60000, `top buyers ${j(r)}`);

  r = await R('POST', '/parties/offers/campaign', { token: owner, body: { message: '' } });
  ok(r.status === 400, 'empty message refused');
  r = await R('POST', '/parties/offers/campaign', { token: cashier, body: { message: 'x' } });
  ok(r.status === 403, 'cashier cannot log');
  r = await R('POST', '/parties/offers/campaign', { token: owner, body: { message: 'Eid offer {name}', selected: 3, opened: 2, skipped: 0, invalidPhones: 1 } });
  ok(r.json?.ok && r.json.opened === 2, `campaign logged ${j(r)}`);
  r = await R('GET', '/activity', { token: owner });
  ok(JSON.stringify(r.json).includes('offers.campaign') && JSON.stringify(r.json).includes('Eid offer'), 'campaign in activity');
  void bad; void nophone;
  console.log(`offers: all ${c.passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
