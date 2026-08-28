# Mecanifique Android

App Android hecha con Expo para consumir el backend de Mecanifique.

## Ejecutar

```bash
npm install
npm run android
```

## Backend

Por defecto usa:

- emulador Android: `http://10.0.2.2:4000`
- dispositivo físico: configura `EXPO_PUBLIC_API_BASE_URL`

Ejemplo:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50:4000 npm run android
```

La app pedirá permiso de ubicación para buscar mecánicos cercanos, mostrar pines en mapa y guardar coordenadas cuando estén disponibles.
