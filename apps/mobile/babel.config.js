module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Reanimated's plugin must stay last.
    plugins: ['react-native-reanimated/plugin'],
  };
};
