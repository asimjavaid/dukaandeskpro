#!/usr/bin/env node
// Demo shop for the Lite test copy. Skips when the shop is already set up.
const base = process.argv[2] ?? 'http://127.0.0.1:3947';
const call = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-dd-session': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.ok === false) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const st = await call('GET', '/auth/status');
if (st.needsSetup === false) { console.log('shop already set up: demo seed skipped'); process.exit(0); }
const owner = (await call('POST', '/auth/setup', { displayName: 'Asim Javaid', pin: '2468', storeName: 'Asim Test Store' })).sessionToken;
await call('POST', '/owner/staff/cashiers', { displayName: 'Bilal', pin: '5678' }, owner);
await call('POST', '/owner/staff/cashiers', { displayName: 'Sara', pin: '4321' }, owner);
await call('POST', '/owner/staff', { name: 'Mona Manager', role: 'manager', pin: '1357' }, owner);
const sup = (await call('POST', '/suppliers', { name: 'Haji Traders' }, owner)).supplier;
const items = [
  ['Sunny Atta 5 kg', 1480, 1300, 40], ['Dalda Cooking Oil 1 L', 610, 540, 60], ['Lux Soap 100 g', 120, 95, 5],
  ['Tapal Danedar 190 g', 450, 400, 50], ['Nestle Milkpak 1 L', 290, 260, 80], ['Shan Biryani Masala', 150, 120, 30],
];
for (const [name, priceRs, cost, qty] of items) {
  const p = (await call('POST', '/catalog/products', { name, priceRs, unit: 'piece', piecesPerCarton: 1 }, owner)).product;
  await call('POST', '/stock/receive', { productId: p.id, qty, unit: 'piece', amountRs: cost * qty, supplierId: sup.id }, owner);
}
await call('POST', '/parties', { name: 'Rashid Bhai', phone: '0300-1234567' }, owner);
console.log('demo shop ready: owner Asim 2468, manager Mona 1357, cashiers Bilal 5678 / Sara 4321');
