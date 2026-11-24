'use strict';
const codec = require('./codec');
const machine = require('./machine');
const stores = require('./stores');
const state = require('./state');
const pub = require('./public-key');
const manifest = require('./manifest');
const buildInfo = require('./build-info');

/** Embedded public key only (no env override: that would let anyone swap in their own key). */
function publicKeyPem() {
  return pub.PUBLIC_KEY_PEM;
}

/**
 * One-call check for this machine. db optional (API passes its SQLite handle).
 * addUsageMinutes: active-use minutes to add (trial usage cap). dataNewest: newest record time
 * in the shop data (clock check). integrityOk: false when the signed build manifest failed.
 */
function checkThisMachine({ db, newKey, now, publicKey, addUsageMinutes, dataNewest, integrityOk, buildDate } = {}) {
  return state.evaluate({
    stores: stores.defaultStores(db),
    machineCode: machine.getMachineCode(),
    publicKeyPem: publicKey || publicKeyPem(),
    newKey,
    now,
    addUsageMinutes,
    dataNewest,
    integrityOk,
    buildDate: buildDate !== undefined ? buildDate : buildInfo.BUILD_DATE,
  });
}

function hasFeature(status, feature) {
  return !!(status && status.state === 'licensed' && status.licence && status.licence.features.includes(feature));
}

module.exports = { ...codec, ...machine, ...stores, ...state, ...manifest, publicKeyPem, checkThisMachine, hasFeature, KEY_ID: pub.KEY_ID, TEST_KEY: !!pub.TEST_ONLY, BUILD_DATE: buildInfo.BUILD_DATE };
