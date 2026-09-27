'use strict'

const QvacForgePlugin = require('@qvac/sdk/electron-forge')

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
  plugins: [new QvacForgePlugin({ logLevel: 'info' })]
}
