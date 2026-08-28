# Mecanifique - Resumen completo del proyecto

## Qué es

Mecanifique es una app Android + backend para conectar clientes con mecánicos, mezclando:

- **Doctoralia**: perfil público, búsqueda, solicitud por mecánico, agenda/turnos.
- **Uber Driver**: mecánico se conecta y recibe solicitudes mientras esté online.

La meta es que un cliente encuentre un mecánico, vea su perfil, consulte turnos, solicite ayuda y siga el servicio hasta cerrarlo.

## Lo que ya construimos

### Backend

- API en Node.js + TypeScript + Express.
- SQLite como base de datos local.
- Auth con:
  - registro de cliente
  - registro de mecánico
  - login
  - admin de desarrollo
- Roles:
  - `customer`
  - `mechanic`
  - `admin`
- Manejo de sesiones por token.
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

### Auth

- `POST /auth/register/customer`
- `POST /auth/register/mechanic`
- `POST /auth/login`
- `POST /auth/admin/login`
- `GET /auth/me`

### Mecánicos

- `GET /mechanics`
- `GET /mechanics/:id/schedule-slots`
- `POST /mechanics`
- `PATCH /mechanics/:id/status`
- `PATCH /mechanics/:id/availability`

### API protegida

- `PATCH /api/mechanics/:id/online`
- `POST /api/mechanics/:id/schedule-slots`
- `GET /api/mechanics/incoming-request`
- `POST /api/service-requests`
- `GET /api/service-requests/mine`
- `POST /api/service-requests/:id/assign`
- `POST /api/service-requests/:id/respond`
- `POST /api/service-requests/:id/cancel`
- `PATCH /api/service-requests/:id/status`
- `POST /api/service-requests/:id/updates`

### Solicitudes públicas

- `GET /service-requests/:id`

## Base de datos

Tablas principales:

- `mechanics`
- `customers`
- `service_requests`
- `service_request_updates`
- `users`
- `sessions`
- `mechanic_schedule_slots`

## Estado actual

### Ya funcionando

- Login y registro.
- Perfiles de mecánicos.
- Búsqueda por zona y GPS.
- Solicitud directa a mecánico.
- Hold y respuesta del mecánico.
- Turnos de agenda.
- Perfil público de mecánico.
- Notificaciones push y centro de notificaciones.
- Scroll normal en la app.
- Fondo personalizado.

### Pendiente para versión más completa

- Pago / anticipo / retención real.
- Estado de servicio más fino:
  - asignado
  - en camino
  - en sitio
  - diagnóstico
  - reparando
  - terminado

## Próximos pasos recomendados

1. **Calendario visual**
   - mostrar turnos por día y hora
   - elegir slot desde una vista clara

2. **Perfil público completo**
   - descripción
   - fotos
   - servicios
   - reseñas

3. **Tiempo real**
   - sockets o notificaciones push
   - solicitudes entrantes sin polling

4. **Flujo operativo del servicio**
   - estado más detallado
   - llegada del mecánico
   - inicio de trabajo
   - cierre con precio final

5. **Mejor UX móvil**
   - inputs más cortos
   - menos texto en pantalla
   - acciones más visuales

6. **Producto final**
   - publicar en Android
   - branding final
   - onboarding

## Nota final

La app ya no es solo una idea: ya tiene base real de backend, auth, mecánicos, solicitudes, mapa, agenda y flujo tipo Uber + Doctoralia.  
El siguiente salto es convertir la agenda en calendario visual y luego llevar la app a producción.
