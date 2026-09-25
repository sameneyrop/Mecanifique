const appJson = require('./app.json');

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  scheme: 'mecanifique',
  plugins: [...(appJson.expo.plugins || []), 'expo-web-browser'],
});
