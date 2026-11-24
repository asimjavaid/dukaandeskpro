'use strict';
/** Cross-edition licence isolation test for dukaandeskpro: keys from sibling editions must NEVER unlock dukaandeskpro. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const self = require('../src/codec.js');

const kp = self.generateKeyPair();
const mc = 'ABCD1234EFGH5678';
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('dukaandeskpro key carries product=dukaandeskpro and prefix=DR2', () => {
  const k = self.signKey({ type: 'full', machineCode: mc, shop: 'Test Shop', tills: 3 }, kp.privateKeyPem);
  const r = self.verifyLicense(k, { publicKeyPem: kp.publicKeyPem, machineCode: mc });
  assert.ok(r.ok && r.payload.product === 'dukaandeskpro' && k.startsWith(self.PREFIX2 + '.'));
});

for (const sib of ["dukaandesklite","dukaandeskplus"]) {
  const sibPath = path.resolve(__dirname, '../../../../' + sib + '/packages/license/src/codec.js');
  if (!fs.existsSync(sibPath)) continue;
  const other = require(sibPath);
  t(sib + ' v2 key signed with same key is rejected by dukaandeskpro', () => {
    const k = other.signKey({ type: 'full', machineCode: mc, shop: 'X', tills: 2 }, kp.privateKeyPem);
    assert.strictEqual(self.verifyLicense(k, { publicKeyPem: kp.publicKeyPem, machineCode: mc }).ok, false);
  });
  t(sib + ' v1 key signed with same key is rejected by dukaandeskpro', () => {
    const k = other.signLicense({ machineCode: mc, shop: 'X' }, kp.privateKeyPem);
    assert.strictEqual(self.verifyLicense(k, { publicKeyPem: kp.publicKeyPem, machineCode: mc }).ok, false);
  });
  t(sib + ' v2 key relabelled with ' + self.PREFIX2 + ' prefix is rejected by dukaandeskpro (product claim mismatch)', () => {
    const k = other.signKey({ type: 'full', machineCode: mc, shop: 'X', tills: 2 }, kp.privateKeyPem).replace(/^[^.]+/, self.PREFIX2);
    assert.strictEqual(self.verifyLicense(k, { publicKeyPem: kp.publicKeyPem, machineCode: mc }).ok, false);
  });
}

console.log('\n' + n + ' dukaandeskpro licence-separation tests passed');
