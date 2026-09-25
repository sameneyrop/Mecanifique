# Mecanifique Android

App Android hecha con Expo (React Native 0.81, Expo SDK 54) para consumir el
backend de Mecanifique.

## Estructura

- `App.tsx` — shell principal: sesión, efectos globales y llamadas a la API.
- `context/AppContext.tsx` — estado compartido entre pantallas.
- `screens/` — una pantalla por archivo (Home, Requests, Mechanics, Map,
  Actions, Account). Ver el README raíz del repo, sección "Inventario de
  pantallas", para la numeración usada en debugging.
- `components/ui.tsx` — componentes reutilizables (Card, Input, botones con
  press-feedback animado, etc.).
- `index.tsx` — punto de entrada: envuelve la app en `SafeAreaProvider`,
  `AppProvider` y `NavigationContainer` (React Navigation está instalado
  pero **todavía no se usa para navegar entre pantallas** — el cambio de
  pantalla hoy es por estado interno, no por stack/tabs nativos).

## Ejecutar

```bash
npm install
npx expo start -c
```

`-c` limpia la caché de Metro; úsalo si cambiaste variables de entorno,
`babel.config.js`, o si ves errores raros después de instalar dependencias
nativas nuevas (p. ej. Reanimated).

## Backend

Por defecto usa:

- emulador Android: `http://10.0.2.2:4000`
- dispositivo físico o backend remoto: configura `EXPO_PUBLIC_API_BASE_URL`

Ejemplo apuntando al backend en producción (Render):

```bash
$env:EXPO_PUBLIC_API_BASE_URL = "https://mecanifique.onrender.com"
npx expo start -c
```

La app pedirá permiso de ubicación para buscar mecánicos cercanos, mostrar pines en mapa y guardar coordenadas cuando estén disponibles.

## Verificar antes de subir cambios

```bash
npx tsc --noEmit
npx expo-doctor
```
