// The app shares its sync logic with the repository's packages/mobile-core, which sits outside this folder.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../packages/mobile-core")];
module.exports = config;
