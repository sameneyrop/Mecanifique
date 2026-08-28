# Supabase Auth Integration

Mecanifique ahora soporta **Supabase Auth** para autenticación de usuarios. Esto es una alternativa moderna y escalable a la autenticación manual basada en SQLite.

## Ventajas de Supabase Auth

✅ Autenticación JWT segura  
✅ Email verification automática  
✅ Password reset por email  
✅ OAuth (Google, Facebook, GitHub, etc.)  
✅ Manejo de sesiones escalable  
✅ Row-level security (RLS) para la base de datos  
✅ Realtime subscriptions  

## Configuración

### 1. Crear un proyecto Supabase (Gratuito)

1. Ve a [https://supabase.com](https://supabase.com)
2. Haz clic en "Start your project"
3. Inicia sesión o crea una cuenta
4. Crea un nuevo proyecto (elige región más cercana a tus usuarios)
5. Espera a que se inicialice (~1 minuto)

### 2. Obtener credenciales

Una vez en tu proyecto Supabase:

1. Ve a **Settings** → **API**
2. Copia:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_REDIRECT_URL=https://mecanifique.onrender.com/auth/callback
SUPABASE_MOBILE_REDIRECT_URL=mecanifique://auth/callback
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

PORT=4000
ADMIN_LOGIN=admin
ADMIN_PASSWORD=admin1234
```

### 4. Iniciar servidor

```bash
npm run dev
```

## Nuevos Endpoints (v2)

### Registro de Cliente

```bash
POST /auth/v2/register/customer
Content-Type: application/json

{
  "fullName": "Juan Pérez",
  "email": "juan@example.com",
  "phone": "4491234567",
  "password": "MiPassword123!"
}
```

**Respuesta:**
```json
{
  "userId": "user-uuid-from-supabase",
  "customerId": 1,
  "email": "4491234567@mecanifique.local",
  "message": "Cuenta creada exitosamente. Verifica tu correo electrónico."
}
```

### Registro de Mecánico

```bash
POST /auth/v2/register/mechanic
Content-Type: application/json

{
  "fullName": "Carlos López",
  "phone": "4491234568",
  "password": "MiPassword123!",
  "city": "Aguascalientes",
  "zone": "Norte",
  "yearsExperience": 8,
  "specialties": ["Eléctrico", "Motor"]
}
```

**Respuesta:**
```json
{
  "userId": "user-uuid-from-supabase",
  "mechanicId": 2,
  "email": "4491234568@mecanifique.local",
  "message": "Cuenta creada exitosamente. Verifica tu correo electrónico."
}
```

### Login

```bash
POST /auth/v2/login
Content-Type: application/json

{
  "email": "4491234567@mecanifique.local",
  "password": "MiPassword123!"
}
```

**Respuesta:**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "4491234567@mecanifique.local",
    "role": "customer",
    "customerId": 1
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

### Obtener usuario actual

```bash
GET /auth/v2/me
Authorization: Bearer <accessToken>
```

**Respuesta:**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "4491234567@mecanifique.local",
    "role": "customer",
    "customerId": 1
  }
}
```

### Login con Google

La app usa `GET /auth/v2/google` para abrir el flujo OAuth y volver a
`mecanifique://auth/callback`.

Configuración necesaria:

1. En Google Cloud Console crea credenciales OAuth de tipo **Web application**.
2. En Supabase ve a **Authentication** → **Providers** → **Google**, activa el
   proveedor y copia allí el Client ID y Client Secret.
3. En Supabase ve a **Authentication** → **URL Configuration** y añade:
   - `https://mecanifique.onrender.com/auth/callback`
   - `mecanifique://auth/callback`
4. En la APK, pulsa **Continuar con Google**. La cuenta se crea o inicia sesión
   automáticamente como cliente.

## Endpoints antiguos (aún funcionales)

La autenticación anterior sigue funcionando:

- `POST /auth/register/customer`
- `POST /auth/register/mechanic`
- `POST /auth/login`
- `POST /auth/admin/login`
- `GET /auth/me`

Puedes usar cualquiera de las dos versiones. Recomendamos migrar gradualmente a v2.

## Flujo completo para la app Android

1. **Registro**: Usuario llena formulario → POST `/auth/v2/register/customer`
2. **Verificación de email**: Supabase envía email (configurable en Supabase Console)
3. **Login**: Usuario ingresa email/password → POST `/auth/v2/login`
4. **Guardar token**: App almacena `accessToken` en secure storage
5. **API calls**: Incluye `Authorization: Bearer <token>` en cada request
6. **Refresh**: Token expira cada hora (configurable en Supabase)

## Próximos pasos

- [ ] Configurar templates de email en Supabase
- [x] Agregar OAuth (Google)
- [ ] Migrar tabla `users` a Supabase Postgres
- [ ] Implementar email verification requerida antes de usar
- [ ] Agregar password reset flow en la app

## Troubleshooting

### Error: "SUPABASE_URL is empty"
- Comprueba que `.env` tiene `SUPABASE_URL` con el valor correcto
- Reinicia el servidor

### Error: "Invalid token"
- El token puede haber expirado (duración: 1 hora por defecto)
- Pide uno nuevo con login

### Usuario no encontrado en SQLite
- Supabase Auth y la BD local pueden desincronizarse
- El código fallback usa metadata de Supabase si no lo encuentra en SQLite

## Recursos

- [Supabase Docs](https://supabase.com/docs)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [JWT Tokens](https://jwt.io)
