/**
 * Pure path + mode helpers for the Electron shell.
 * No Electron import — Slice 17 smoke can require this headlessly.
 *
 * Unpackaged production (DUKAANDESK_PROD=1 or a future packaged app):
 *   web  → apps/web/dist
 *   api  → apps/api/dist/main.js (cwd apps/api, system Node)
 * Packaged (electron-builder extraResources):
 *   web  → resources/web
 *   api  → resources/api  (pnpm deploy output: dist + node_modules)
 */
const path = require('node:path');

function repoRootFromMainDir(mainDir) {
  return path.resolve(mainDir, '../../..');
}

/**
 * @param {{ isPackaged: boolean, resourcesPath?: string, mainDir: string }} opts
 */
function productionLayout(opts) {
  if (opts.isPackaged) {
    const resources = opts.resourcesPath;
    if (!resources) throw new Error('resourcesPath required when packaged');
    const webDir = path.join(resources, 'web');
    const apiCwd = path.join(resources, 'api');
    return {
      webDir,
      webIndex: path.join(webDir, 'index.html'),
      apiCwd,
      apiEntry: path.join(apiCwd, 'dist', 'main.js'),
    };
  }
  const repo = repoRootFromMainDir(opts.mainDir);
  const webDir = path.join(repo, 'apps', 'web', 'dist');
  const apiCwd = path.join(repo, 'apps', 'api');
  return {
    webDir,
    webIndex: path.join(webDir, 'index.html'),
    apiCwd,
    apiEntry: path.join(apiCwd, 'dist', 'main.js'),
  };
}

/**
 * Built UI (not Vite) when packaged, or when DUKAANDESK_PROD=1.
 * DUKAANDESK_DEV=1 forces the Vite URL even if packaged.
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} isPackaged
 */
function uiUsesBuiltWeb(env, isPackaged) {
  if (env.DUKAANDESK_PROD === '1') return true;
  if (env.DUKAANDESK_DEV === '1') return false;
  return !!isPackaged;
}

module.exports = {
  repoRootFromMainDir,
  productionLayout,
  uiUsesBuiltWeb,
};
