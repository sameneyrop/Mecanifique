# Mecanifique — guía para Claude Code

Monorepo con tres partes independientes: backend en la raíz, app Android en
`mobile/` y sitio web estático en `web/` (mecanifique.vercel.app). Vercel
publica solo `web/`, sin instalar ni compilar, por el `vercel.json` de la
raíz; Render ignora `web/`. No volver a poner archivos del sitio en la raíz
ni crear `public/`: Vercel publicaría esa carpeta. Lee primero `README.md` (fuente de verdad del estado de
implementación) antes de asumir que algo falta o existe.

## Comandos

### Backend (raíz)

```bash
npm run dev     # tsx src/server.ts, con recarga
npm run build   # tsc -p tsconfig.json
npm start       # node dist/server.js (requiere build previo)
npm test        # tsx --test tests/api.test.js
```

### App Android (`mobile/`)

```bash
npx expo start -c        # -c limpia caché Metro; usar tras cambiar env vars o deps nativas
npx tsc --noEmit         # type-check, obligatorio antes de dar por terminado un cambio
npx expo-doctor          # valida config nativa/Expo, debe dar 18/18
```

Backend remoto para probar en emulador/dispositivo:

```bash
$env:EXPO_PUBLIC_API_BASE_URL = "https://mecanifique.onrender.com"
```

## Arquitectura y reglas estrictas

- **Backend**: Node.js + TypeScript + Express (`src/server.ts`, ~3000
  líneas) + SQLite como base de datos operativa vía libSQL: **Turso** en
  producción (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) y el archivo
  `data/mecanifique.db` en desarrollo y tests (`src/db.ts`). Render está en
  plan gratis: **su disco no persiste** (se borra en cada deploy y al
  dormirse), así que nada se guarda en archivos del servidor — ni la base
  ni las fotos (van en la tabla `uploaded_photos`). Validación con Zod. **Auth exclusivamente vía Supabase JWT v2**
  (`/auth/v2/*`) — la auth manual v1 se eliminó por completo; no reintroducir
  password_hash local, tabla `sessions`, ni endpoints `/auth/register` o
  `/auth/login` sin prefijo `v2`.
- **Supabase Postgres NO es la base de datos operativa.** Solo se usa para
  auth. Las migraciones en `migrations/supabase/` son un esquema espejo para
  una futura migración, no una BD activa — no asumir que escribir ahí tiene
  efecto en producción.
- **Nunca reintroducir endpoints sin `/api` y sin middleware de auth**
  (existieron y se eliminaron por ser superficie de ataque sin uso real:
  `POST /mechanics`, `PATCH /mechanics/:id/availability`, `PATCH
  /mechanics/:id/status`, `POST /customers`, `POST /service-requests`, `POST
  /service-requests/:id/assign`).
- **App móvil**: Expo SDK 54, React Native 0.81, React 19, TypeScript
  estricto (`tsconfig.json` con `strict: true`). Estado compartido en
  `mobile/context/AppContext.tsx`, UI reutilizable en
  `mobile/components/ui.tsx`, una pantalla por archivo en `mobile/screens/`.
  Animaciones con `react-native-reanimated` (ya instalado y configurado en
  `babel.config.js` — no tocar el plugin sin entender el orden de presets).
- **React Navigation está instalado pero NO se usa para navegar todavía**
  — el cambio de pantalla es por estado (`currentScreen`) y render
  condicional dentro de `App.tsx`. Si vas a cablear navegación real, es un
  cambio arquitectónico grande: avisar antes de tocarlo a medias.
- **Pagos: solo existe el esquema de datos, cero lógica de negocio.** No
  asumir que `deposit_amount`, `extra_amount`, `refund_amount` en
  `service_requests` hacen algo — ningún endpoint los lee ni escribe. Ver
  README.md → "Modelo de pagos y apartado" antes de tocar esto.
- **Textos de UI en español** (México). Mantener el tono y vocabulario ya
  usado en la app (ej. "solicitud", no "pedido"; "mecánico", no "técnico").
- No usar `--no-verify` ni saltar hooks. No hacer `git push --force` a
  `main`.

## Inventario de pantallas móviles (para debugging)

Ver README.md → "Inventario de pantallas (app móvil)" para la tabla
completa numerada (0-7). Úsala para ubicar rápido a qué archivo corresponde
un bug reportado como "Pantalla N".

## Cómo leer este proyecto sin gastar contexto de más

- **No leas `src/server.ts` completo salvo que el cambio lo requiera** —
  son ~3000 líneas. Usa Grep para ubicar la ruta/handler exacto antes de
  abrir el archivo, y lee con `offset`/`limit` acotado alrededor del match.
- **`README.md` es la fuente de verdad de features**; `README_COMPLETO.md`
  es narrativo/introductorio (no autoritativo) y `PROJECT_STATUS.md` es un
  snapshot puntual de una auditoría pasada — no lo trates como estado
  actual sin cruzarlo contra el código.
- Antes de asumir que un endpoint o tabla no existe, greppear en
  `src/server.ts` y `src/routes/` en vez de asumir por lo que dice un doc.
- Para cambios de UI, no hace falta leer los 6 archivos de `screens/` de
  entrada — identificar primero cuál pantalla (por el inventario numerado)
  y leer solo esa, más `components/ui.tsx` y `styles.ts` si el cambio toca
  estilos o componentes compartidos.
- Verificar siempre con `npx tsc --noEmit` en `mobile/` antes de dar un
  cambio de UI por terminado — Metro no type-checkea, así que un error de
  tipos puede pasar desapercibido hasta que crashea en runtime (pasó con
  `identityBusy` en `AppContext.tsx`).
