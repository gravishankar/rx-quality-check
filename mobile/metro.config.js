const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * The app bundles the versioned drug catalog and exclusion policy from the repository's data/
 * folder (the same files the tests validate), so Metro watches it. Nothing else outside mobile/.
 */
const config = {
  watchFolders: [path.resolve(__dirname, '..', 'data')],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
