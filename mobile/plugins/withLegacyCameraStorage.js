// En Android 9 o anterior, expo-image-picker pide WRITE_EXTERNAL_STORAGE además
// de la cámara para tomar una foto; sin ese permiso la cámara no abre. Se
// declara solo hasta Android 9 (maxSdkVersion 28): en Android 10 o más nuevo no
// existe y Play no lo cuenta. READ_EXTERNAL_STORAGE sigue bloqueado en app.json.
const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.WRITE_EXTERNAL_STORAGE';

module.exports = function withLegacyCameraStorage(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const others = (manifest['uses-permission'] || []).filter((item) => item.$['android:name'] !== PERMISSION);
    // tools:node="replace": reemplaza la declaración sin límite de la librería.
    others.push({
      $: { 'android:name': PERMISSION, 'android:maxSdkVersion': '28', 'tools:node': 'replace' },
    });
    manifest['uses-permission'] = others;
    return mod;
  });
};
