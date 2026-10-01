'use strict'

const QvacForgePlugin = require('@qvac/sdk/electron-forge')
const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

// QVAC's plugin bundles the Bare worker, prunes non-target prebuilds and forces
// asar off (native addons can't load from inside an ASAR archive). Build one
// arch at a time: `npm run make` targets darwin/arm64.
module.exports = {
  packagerConfig: {
    name: 'Local Image',
    executableName: 'local-image',
    appBundleId: 'com.fabc241.local-image',
    icon: 'build/icon'
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'] }
  ],
  plugins: [
    new QvacForgePlugin({ logLevel: 'info' }),
    // Hardened Electron binary: it can't be reused as a general Node.js runtime
    // or debugged/instrumented through environment variables or CLI flags.
    // The QVAC worker runs on its own Bare binary, so it's unaffected.
    // ASAR fuses stay off because the QVAC plugin disables ASAR.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      // Must stay on: the UI is loaded from file:// as ES modules, which this
      // fuse would block (the window would render empty).
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false
    })
  ]
}
