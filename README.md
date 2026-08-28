# Mecanifique MVP

Backend inicial + app Android para una plataforma tipo "Doctoralia para mecánicos on demand", arrancando con servicios **programados**.

## Stack

- Node.js + TypeScript
- Express
- SQLite (`data/mecanifique.db`)
- Zod para validación de payloads
- **Supabase Auth** (nuevo - autenticación JWT escalable)

## Cómo correr

### API backend

```bash
npm install
npm run dev
```

Servidor por defecto en `http://localhost:4000`.

**Nota importante:** Para usar **Supabase Auth** (endpoints v2), necesitas:
1. Crear una cuenta gratuita en [https://supabase.com](https://supabase.com)
2. Copiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` a un archivo `.env`

Ver [SUPABASE_AUTH_SETUP.md](./SUPABASE_AUTH_SETUP.md) para más detalles.

Para producción, configura `NODE_ENV=production`, define `CORS_ORIGINS` con los orígenes web permitidos y nunca uses las credenciales de ejemplo del administrador.

En producción, la API rechaza el arranque si faltan `SUPABASE_URL`, `SUPABASE_ANON_KEY` o `CORS_ORIGINS`, y no permite `localhost` ni `*` en CORS. Usa un archivo `.env` fuera del repositorio y rota cualquier clave que haya sido compartida accidentalmente.

El archivo [render.yaml](./render.yaml) deja preparado un servicio Render con Node 20 y reconstrucción de `sqlite3` desde código fuente para evitar incompatibilidades de GLIBC, además de build (incluyendo `devDependencies` necesarias para TypeScript), start, health check y disco persistente para SQLite. Al crear el servicio desde ese archivo todavía debes introducir manualmente las variables secretas de producción.

### App Android

```bash
cd mobile
npm install
npm run android
```

Si usas un dispositivo físico, define la URL del backend:

```bash
EXPO_PUBLIC_API_BASE_URL=http://TU_IP_LOCAL:4000
```

El repositorio incluye [mobile/eas.json](./mobile/eas.json) con perfiles `development`, `preview` (APK instalable) y `production` (AAB para Google Play). Instala EAS CLI, inicia sesión y configura la variable `EXPO_PUBLIC_API_BASE_URL` en EAS antes de compilar:

```bash
cd mobile
npm install
npm install --global eas-cli
eas login
eas env:create --name EXPO_PUBLIC_API_BASE_URL --value https://api.tu-dominio.com --environment production
eas build --platform android --profile preview
```

Para publicar en Google Play usa `eas build --platform android --profile production`. Verifica permisos de ubicación y notificaciones en un dispositivo físico antes de publicar.

En emulador Android, el backend local por defecto es `http://10.0.2.2:4000`.

La app puede pedir permiso de ubicación para mostrar mecánicos cercanos por GPS y visualizar pines en mapa con refresco automático.

`http://localhost:4000/` sigue mostrando un dashboard web de soporte para pruebas internas.

## Tutorial rápido de uso (app Android)

La app está separada por secciones en la barra inferior:

- **INI**: resumen y propósito de la plataforma.
- **SOL**: gestión de solicitudes (ver, crear y consultar detalle por ID).
- **MEC**: búsqueda de mecánicos por ciudad/zona.
- **MAP**: mecánicos cercanos por GPS y mapa con pines.
- **CFG**: acciones operativas para admin/mecánico.

### Flujo tipo Uber para mecánicos

1. El mecánico inicia sesión.
2. En **INI** usa el botón grande de conexión (**CONECTARME / DESCONECTARME**).
3. Mientras esté conectado puede recibir solicitudes.
4. Clientes pueden ir a **MEC**, abrir un perfil y usar **Solicitar ayuda de este mecánico** aunque aparezca ocupado.
5. En **CFG** puedes crear turnos reales por fecha/hora y luego usarlos desde la solicitud.

Estados de una solicitud on-demand:

`pending` → `assigned` → `en_route` → `on_site` → `diagnosing` → `repairing` → `completed`

`awaiting_parts` puede ocurrir después del diagnóstico o durante la reparación. El cliente o admin puede cancelar mientras la solicitud no esté cerrada; las solicitudes `completed` y `cancelled` no admiten más transiciones.

### Flujo recomendado (primera prueba)

1. Inicia sesión como `admin` (`admin / admin1234`) o crea cuentas de cliente/mecánico.
2. En **MEC**, valida que existan mecánicos activos.
3. En **SOL**, crea una solicitud con datos del vehículo y ubicación.
4. En **MAP**, usa ubicación para ver cercanos y validar pines.
5. En **CFG** (admin), asigna mecánico y actualiza su estado/disponibilidad.
6. En **SOL**, consulta la solicitud por ID y revisa su progreso.

## Endpoints iniciales

### Salud

- `GET /health`

### Mecánicos

- `POST /mechanics`
- `GET /mechanics?city=Aguascalientes&zone=Norte&available=true`
- `PATCH /mechanics/:id/status`
- `PATCH /mechanics/:id/availability`

### Auth (antiguo - SQLite)

- `POST /auth/register/customer`
- `POST /auth/register/mechanic`
- `POST /auth/login`
- `POST /auth/admin/login`
- `GET /auth/me`

### Auth v2 (nuevo - Supabase, recomendado)

**Requiere configuración de Supabase** (ver [SUPABASE_AUTH_SETUP.md](./SUPABASE_AUTH_SETUP.md))

- `POST /auth/v2/register/customer`
- `POST /auth/v2/register/mechanic`
- `POST /auth/v2/login`
- `GET /auth/v2/me`

### API con roles

- `POST /api/service-requests`
- `GET /api/service-requests/mine`
- `POST /api/service-requests/:id/assign`
- `POST /api/service-requests/:id/respond` (mecánico acepta/rechaza hold)
- `POST /api/service-requests/:id/cancel` (cliente/admin cancela)
- `PATCH /api/service-requests/:id/status`
- `POST /api/service-requests/:id/updates`
- `GET /api/mechanics/incoming-request`
- `PATCH /api/mechanics/:id/status`
- `PATCH /api/mechanics/:id/availability`
- `PATCH /api/mechanics/:id/online`
- `POST /api/mechanics/:id/schedule-slots`
- `GET /mechanics/:id/schedule-slots`

### Clientes

- `POST /customers`

### Solicitudes de servicio

- `POST /service-requests`
- `POST /service-requests/:id/assign` (asignación manual o automática por zona/rating)
- `PATCH /service-requests/:id/status`
- `POST /service-requests/:id/updates`
- `GET /service-requests/:id`

## Flujo recomendado de MVP

1. Registrar mecánicos.
2. Activarlos manualmente (`status = active`) como parte de tu validación presencial.
3. Conectar mecánicos disponibles desde la app.
4. Registrar cliente.
5. Crear una solicitud inmediata; el sistema la ofrece al mejor mecánico activo, conectado y disponible de la zona.
6. Opcionalmente elegir una visita programada o un mecánico específico.
7. Registrar updates de avance y cerrar servicio.

## Acceso admin de desarrollo

Por defecto, en local se crea un admin de desarrollo:

- `login`: `admin`
- `password`: `admin1234`

Si quieres cambiarlo:

- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`

## Ejemplo rápido con curl

```bash
curl -X POST http://localhost:4000/mechanics ^
  -H "Content-Type: application/json" ^
  -d "{\"fullName\":\"Juan Perez\",\"phone\":\"4491234567\",\"city\":\"Aguascalientes\",\"zone\":\"Norte\",\"yearsExperience\":8,\"specialties\":[\"Electrico\",\"Motor\"]}"
```
