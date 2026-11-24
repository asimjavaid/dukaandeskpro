/**
 * Embedded Ed25519 PUBLIC key used to verify activation keys.
 * Written by tools/keygen/keygen.mjs init. The private key NEVER lives in this repo.
 */
module.exports = {
  // TEST KEY ONLY. Installer builds refuse to run while TEST_ONLY is true.
  TEST_ONLY: true,
  KEY_ID: "32BF160BD223",
  PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA/mOSVnIH17gRJMJ6Ptv5TgaxvsO+blYZ83AaXffvUsg=\n-----END PUBLIC KEY-----\n",
};
