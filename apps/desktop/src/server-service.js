/**
 * DukaanDesk Pro main PC background server (Windows service "DukaanDeskProServer", run by
 * WinSW with the bundled Electron binary as Node: ELECTRON_RUN_AS_NODE=1).
 * Keeps the API up for the tills when nobody has the app open on the main PC.
 * Reads server.json, then starts resources/api/dist/main.js in this process.
 */
const path = require('node:path');
const { serverEnv } = require('./server-config');

Object.assign(process.env, serverEnv());
process.env.DD_LICENSE_ENFORCE = '1';
process.env.DD_LICENSE_PACKAGED = '1';
delete process.env.DD_LICENSE_TEST_DAYS;
delete process.env.DD_LICENSE_TEST_USAGE_MIN;
const apiMain = process.env.DD_API_MAIN || path.join(process.resourcesPath || path.join(__dirname, '..', '..'), 'api', 'dist', 'main.js');
require(apiMain);
