const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/**
 * Metro does not follow npm workspace symlinks or resolve modules above the app
 * directory by default. Without these two settings the app compiles in your IDE
 * and then fails at bundle time with "Unable to resolve @sklum/events" — the
 * classic monorepo React Native trap.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
