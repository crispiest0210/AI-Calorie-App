// The bundled food catalog ships as a .sqlite asset (spec 2.3), and the
// workspace packages are consumed as TypeScript source, so Metro watches the
// repo root rather than just this app.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.assetExts = [...config.resolver.assetExts, 'sqlite', 'db'];
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
