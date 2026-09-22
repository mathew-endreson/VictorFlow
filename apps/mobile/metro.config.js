// Expo's default config already understands pnpm workspaces (it watches the monorepo root and resolves symlinked
// workspace packages such as @victorflow/types). Keep this file so it is obvious where to customise Metro.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
