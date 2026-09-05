# Mecanifique - Estado actual del proyecto

Fecha: 5 de septiembre de 2026 (auditoría de punta a punta)

> Este documento es un snapshot puntual. Para el detalle vivo y siempre
> actualizado de features, riesgos y roadmap, la fuente de verdad es
> [README.md](./README.md) — este archivo solo resume el estado al momento
> de la última auditoría y qué se corrigió en ella.

## ✅ Completado (confirmado en código, no solo planeado)

### Backend (Node.js + Express + TypeScript, `src/server.ts` ~3000 líneas)
- ✅ Autenticación exclusivamente con Supabase JWT (v2). **La auth manual v1
  (password_hash local, tabla `sessions`, `/auth/register`, `/auth/login`)
  se eliminó por completo** (commit `366a6d1`): la app móvil nunca la usó y
  solo agregaba superficie de ataque.
- ✅ Gestión de mecánicos (alta vía registro Supabase, búsqueda, perfil
  público con bio/galería/tarifa de mano de obra).
- ✅ Solicitudes de servicio: creación, hold temporal, asignación
  automática/manual, respuesta aceptar/rechazar, ciclo de estados completo
  (pendiente → asignada → en camino → en sitio → diagnóstico → reparación →
  espera de refacciones → terminada/cancelada).
- ✅ Agenda / turnos de mecánicos.
- ✅ Notificaciones push con Expo + centro de notificaciones persistente.
- ✅ Reseñas y calificaciones post-servicio.
- ✅ Chat por solicitud.
- ✅ Búsqueda geolocalizada (GPS) y actualización de ubicación del mecánico.
- ✅ Verificación de identidad con Didit (consentimiento, documentos,
  webhook, revisión administrativa).
- ✅ Disputas de clientes (categoría, descripción, revisión y resolución
  admin, con registro contable opcional de reembolso).
- ✅ Botón de emergencia (911): la llamada real siempre pasa por el marcador
  nativo del teléfono; el backend solo deja auditoría (`panic_alerts`) y
  notifica a administradores con ubicación y solicitud asociadas.
- ✅ Rate limiting en auth, cabeceras de seguridad básicas, CORS restringido
  en producción.

### Supabase
- ✅ Auth (registro/login/roles/JWT) es la única vía de autenticación.
- ⚠️ **Supabase Postgres NO es la base de datos operativa todavía.** Todos
  los datos de negocio viven en SQLite con disco persistente en Render.
  Las migraciones en `migrations/supabase/` (001 a 005) son un esquema
  espejo preparado para una futura migración, no una BD activa.

### App Android (React Native + Expo, `mobile/App.tsx` ~4100 líneas)
- ✅ Inicio, solicitudes, búsqueda/mapa de mecánicos, acciones (mecánico/
  admin), cuenta — con navegación inferior fija.
- ✅ Login/registro con Supabase, incluyendo botón de Google OAuth.
- ✅ Vehículos guardados por el cliente, reutilizables al crear solicitud.
- ✅ Verificación de identidad (Didit) vía navegador seguro + deep link.
- ✅ Chat, reseñas, disputas y botón de emergencia integrados en el detalle
  de solicitud.
- ✅ Sesión persistida de forma **cifrada** con `expo-secure-store` (con
  migración automática desde el `AsyncStorage` sin cifrar de versiones
  anteriores).
- ✅ Onboarding, indicadores de carga, feedback de botones, modo seguro de
  mapa cuando no hay clave de Google Maps configurada.

---

## 🔧 Hallazgos y correcciones de esta auditoría (5 sep 2026)

Se hizo una revisión completa de backend y app móvil. Resultado y acciones:

1. **[Corregido] Endpoints legacy sin autenticación.** Existían rutas
   duplicadas sin `/api` y sin ningún middleware de auth (`POST /mechanics`,
   `PATCH /mechanics/:id/availability`, `PATCH /mechanics/:id/status`,
   `POST /customers`, `POST /service-requests`, `POST
   /service-requests/:id/assign`) que permitían, por ejemplo, activar un
   mecánico sin verificación. Confirmado que la app móvil no las usa;
   **se eliminaron del código**.
2. **[Corregido] Migraciones de Supabase incompletas.** Faltaban `disputes`
   y `panic_alerts` en el esquema Postgres espejo. Se agregaron
   (`004_disputes.sql`, `005_panic_alerts.sql`) y se documentó explícitamente
   que Supabase hoy solo cubre autenticación, no datos operativos.
3. **[Corregido] Tokens de sesión sin cifrar.** El JWT y el usuario se
   guardaban en `AsyncStorage` plano. Se migró a `expo-secure-store`.
4. **[Corregido] Copy engañoso sobre pagos.** La pantalla de perfil del
   mecánico decía "el cliente lo paga al solicitarte" sobre la tarifa de
   mano de obra, cuando **ningún endpoint de la API lee ni escribe** los
   campos de apartado/extra/reembolso (existen en el esquema, sin lógica de
   negocio conectada). Se corrigió el texto y se documentó el estado real en
   el README.
5. **[Agregado] Botón de pánico ahora deja registro.** Antes solo abría el
   marcador del teléfono sin ningún rastro. Ahora, en paralelo (sin
   bloquear ni retrasar la llamada real), se registra quién presionó el
   botón, desde qué solicitud y con qué ubicación, y se notifica a los
   administradores.
6. **[Agregado] Tests de autenticación y regresión de concurrencia.** El
   backend solo tenía 3 tests triviales (health, 404, JSON inválido). Se
   agregaron tests de: rutas protegidas sin token (401), token inválido
   contra Supabase real (401), y una prueba de regresión directa sobre
   `ensureLocalUser` para el bug de condición de carrera del rol de mecánico
   (commit `366a6d1`) — hoy 10 tests, todos en verde.
7. **[Documentado, no implementado]** Pagos reales (Stripe) y refuerzo
   adicional del botón de pánico (seguimiento GPS compartido en vivo)
   siguen siendo roadmap: requieren cuenta/credenciales de un procesador de
   pagos y decisiones de producto que no se pueden resolver solo con
   cambios de código. Ver README, sección "Modelo de pagos y apartado" y
   "Riesgos operativos identificados".

Validación tras los cambios: `npm run build`, `npm test` (10/10) y
`npx tsc --noEmit` / `npx expo-doctor` (18/18) en `mobile`, todos en verde.

---

## 📋 Pendiente (ver README.md → "Roadmap pendiente" para el detalle vivo)

- Migrar datos operativos de SQLite a Supabase Postgres (o decidir
  formalmente no hacerlo y retirar las migraciones espejo).
- Integración real de pagos (Stripe u otro PSP): autorización, captura
  parcial, reembolso — hoy solo existe el esquema de datos.
- Verificación telefónica por SMS, panel administrativo completo de
  identidad, seguimiento GPS compartido para contactos de confianza.
- Mejoras de UX pendientes: `maxLength` y contador de caracteres en
  descripciones largas (falla, disputas, bio), menos texto para usuarios
  mayores.
- Ampliar cobertura de tests (roles/403, flujo completo de disputas,
  websockets).

---

## 📚 Documentación relacionada

- [README.md](./README.md) — estado de implementación, modelo de pagos,
  riesgos operativos y roadmap (fuente de verdad).
- [SUPABASE_AUTH_SETUP.md](./SUPABASE_AUTH_SETUP.md) — guía de
  configuración de Supabase Auth.
- [migrations/supabase/](./migrations/supabase) — esquema Postgres espejo
  (no activo todavía).
