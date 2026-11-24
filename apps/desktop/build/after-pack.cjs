/**
 * electron-builder afterPack: flip Electron fuses on the packed DukaanDesk.exe (@electron/fuses, MIT).
 * - RunAsNode stays ON: the app runs its own server with the Electron binary as Node.
 * - NODE_OPTIONS and --inspect are turned OFF (no injecting code / attaching a debugger that way).
 * - The app is only loaded from app.asar; cookies are encrypted.
 * - Embedded asar integrity validation is left OFF until it has been tried on a Windows test
 *   build (set DD_ASAR_INTEGRITY=1 to switch it on for such a build).
 */
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const name = context.electronPlatformName === 'linux' ? context.packager.executableName : context.packager.appInfo.productFilename;
  const ext = { win32: '.exe', darwin: '.app', linux: '' }[context.electronPlatformName] ?? '';
  const exe = path.join(context.appOutDir, `${name}${ext}`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: process.env.DD_ASAR_INTEGRITY === '1',
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log('[after-pack] fuses set on', exe);
};
