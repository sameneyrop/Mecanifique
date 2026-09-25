# Mecanifique - Resumen completo del proyecto

> ⚠️ Este documento es una introducción narrativa al proyecto, pensada para
> quien llega por primera vez. **No es la fuente de verdad.** Para el estado
> de implementación real, actualizado y vivo, ver [README.md](./README.md).
> Este archivo se corrigió el 25/09/2026 para quitar referencias a la auth
> v1 (eliminada) y features que ya pasaron de "pendiente" a "implementado".

## Qué es

Mecanifique es una app Android + backend para conectar clientes con mecánicos, mezclando:

- **Doctoralia**: perfil público, búsqueda, solicitud por mecánico, agenda/turnos.
- **Uber Driver**: mecánico se conecta y recibe solicitudes mientras esté online.

La meta es que un cliente encuentre un mecánico, vea su perfil, consulte turnos, solicite ayuda y siga el servicio hasta cerrarlo.

## Lo que ya construimos

### Backend

- API en Node.js + TypeScript + Express, desplegada en Render.
- SQLite como base de datos operativa (con disco persistente en Render).
  Supabase Postgres solo se usa hoy para autenticación; existe un esquema
  espejo en `migrations/supabase/` para una futura migración de datos, pero
  no está activo.
- Auth **exclusivamente vía Supabase JWT (v2)**. La auth manual v1
  (password_hash local, tabla `sessions`, `/auth/register`, `/auth/login`)
  se eliminó por completo — nunca la usó la app móvil.
- Roles:
  - `customer`
  - `mechanic`
  - `admin`
- Validación con Zod.

### Mecánicos

- Alta de mecánicos.
- Estado:
  - `pending_verification`
  - `active`
  - `suspended`
- Disponibilidad:
  - disponible / ocupado
- Conexión online/offline:
  - mecánico se activa con botón grande
  - cuando está online puede recibir solicitudes
- Ubicación GPS:
  - latitude / longitude
- Búsqueda por ciudad/zona y por cercanía.
- Perfil público con bio, foto principal y galería.
- Reseñas con promedio visible.

### Solicitudes

- Crear solicitud de servicio.
- Asignación manual o automática.
- Solicitud dirigida a un mecánico específico.
- Hold temporal antes de comprometer al mecánico.
- Aceptar / rechazar solicitud entrante.
- Cancelación por cliente o admin.
- Updates de avance.
- Chat básico por solicitud.
- Consulta de solicitud por ID.
- Mis solicitudes por usuario autenticado.

### Agenda / turnos

- Turnos por mecánico:
  - fecha
  - hora inicio
  - hora fin
  - nota
- Los turnos pueden reservarse al crear una solicitud.
- Si se cancela o rechaza, el turno se libera.
- La pantalla de mecánicos muestra turnos públicos.

### App Android

- Hecha con Expo.
- Pantallas separadas:
  - inicio
  - solicitudes
  - mecánicos
  - mapa
  - acciones
- Barra inferior fija.
- Fondo personalizado con la imagen subida.
- Scroll reactivado para evitar cortes.
- UI con cards, perfil público y flujo por pasos.

## Flujo actual de uso

### Cliente

1. Inicia sesión o crea cuenta.
2. Ve mecánicos.
3. Abre perfil público.
4. Puede solicitar ayuda.
5. Puede usar turno específico si quiere.
6. Ve estado, hold y progreso.

### Mecánico

1. Inicia sesión.
2. Se conecta con el botón grande.
3. Recibe solicitudes entrantes.
4. Puede aceptar o rechazar.
5. Puede crear turnos de agenda.
6. Puede publicar updates.

### Admin

1. Inicia sesión.
2. Asigna mecánicos.
3. Cambia estado y disponibilidad.
4. Puede crear solicitudes.
5. Puede gestionar turnos.

## Endpoints principales

### Auth (Supabase v2 — la única auth vigente)

- `POST /auth/v2/register/customer`
- `POST /auth/v2/register/mechanic`
- `POST /auth/v2/login`
- `GET /auth/v2/google`
- `GET /auth/v2/me`

### Mecánicos

- `GET /mechanics`
- `GET /mechanics/:id/schedule-slots`
- `GET /mechanics/:id/reviews`

### API protegida

- `PATCH /api/mechanics/:id/online`
- `PATCH /api/mechanics/:id/availability`
- `PATCH /api/mechanics/:id/status`
- `PATCH /api/mechanics/:id/location`
- `PATCH /api/mechanics/:id/public-profile`
- `POST /api/mechanics/:id/reviews`
- `POST /api/mechanics/:id/schedule-slots`
- `GET /api/mechanics/incoming-request`
- `POST /api/service-requests`
- `GET /api/service-requests/mine`
- `POST /api/service-requests/:id/assign`
- `POST /api/service-requests/:id/respond`
- `POST /api/service-requests/:id/cancel`
- `PATCH /api/service-requests/:id/status`
- `POST /api/service-requests/:id/updates`
- `GET/POST /api/service-requests/:id/messages`
- `GET/POST /api/vehicles`
- `GET/POST /api/notifications`, `POST /api/push-tokens`
- `GET/POST /api/identity-verification`, `POST /api/identity-verification/didit-session`
- `POST /api/disputes`, `GET /api/admin/disputes`, `PATCH /api/admin/disputes/:id`
- `POST /api/alerts/panic`

> Nota: los endpoints legacy sin `/api` y sin autenticación
> (`POST /mechanics`, `PATCH /mechanics/:id/availability`,
> `PATCH /mechanics/:id/status`, `POST /customers`, `POST /service-requests`,
> `POST /service-requests/:id/assign`) se **eliminaron** por ser una
> superficie de ataque sin uso real (ver `PROJECT_STATUS.md`).

### Solicitudes públicas

- `GET /service-requests/:id`

## Base de datos

Tablas principales (SQLite, operativa hoy):

- `mechanics`, `customers`, `users`
- `service_requests`, `service_request_updates`, `service_request_messages`
- `mechanic_schedule_slots`, `mechanic_reviews`
- `vehicles`, `notifications`, `push_tokens`
- `identity_verifications`, `disputes`, `payments`, `panic_alerts`

(La tabla `sessions` de la auth v1 ya no existe — la sesión ahora es un JWT
de Supabase, sin estado en el servidor.)

## Estado actual

### Ya funcionando

- Login y registro (Supabase, incluyendo Google OAuth).
- Perfiles públicos de mecánicos (bio, galería, tarifa, reseñas).
- Búsqueda por zona y GPS.
- Solicitud directa a mecánico y turnos de agenda.
- Hold y respuesta (aceptar/rechazar) del mecánico.
- Estado de servicio fino: pendiente → asignada → en camino → en sitio →
  diagnóstico → reparación → espera de refacciones → terminada/cancelada.
- Chat por solicitud, reseñas, disputas.
- Notificaciones push y centro de notificaciones.
- Verificación de identidad (Didit) — implementado localmente, ver
  README.md para qué está publicado vs. pendiente de desplegar.
- Botón de emergencia (911) con registro de auditoría.
- Vehículos guardados reutilizables al crear solicitud.

### Pendiente (ver README.md → "Roadmap pendiente" para el detalle vivo)

- Pago / anticipo / retención real: el modelo está **diseñado** (ver
  README.md → "Modelo de pagos y apartado") y el esquema de datos existe,
  pero **ningún endpoint mueve dinero real todavía**.
- Verificación telefónica por SMS.
- Seguimiento GPS compartido en vivo para contactos de confianza.
- Panel administrativo completo de identidad.
- Calendario visual de turnos (hoy es lista simple filtrable por fecha).

## Próximos pasos recomendados

Ver README.md → "Roadmap pendiente", que es la lista viva y priorizada.
A alto nivel, lo más urgente sigue siendo cerrar el modelo de pagos: sin
cobro real dentro de la app, el flujo de negocio (evitar fuga a trato
directo) no se sostiene por mucho tiempo.

## Nota final

La app ya no es solo una idea: tiene base real de backend, auth, mecánicos,
solicitudes con ciclo de estado completo, mapa, agenda, chat, reseñas,
disputas y flujo tipo Uber + Doctoralia. El siguiente salto grande es cerrar
el modelo de pagos y decidir la migración de datos operativos a Supabase
Postgres.
