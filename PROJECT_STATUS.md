# Mecanifique - Estado actual del proyecto

Fecha: 26 de agosto de 2026

## ✅ Completado

### Backend (Node.js + Express + TypeScript)
- ✅ Autenticación manual con SQLite (v1)
- ✅ **Autenticación con Supabase JWT (v2)** - NUEVO
- ✅ Gestión de mecánicos (alta, búsqueda, perfil)
- ✅ Solicitudes de servicio (crear, asignar, actualizar estado)
- ✅ Agenda / turnos de mecánicos
- ✅ Notificaciones push con Expo
- ✅ Centro de notificaciones persistente
- ✅ Sistema de reseñas y ratings
- ✅ Chat por solicitud
- ✅ Búsqueda geolocalizada (GPS)
- ✅ Rate limiting en auth

### Supabase Auth - Novedad
- ✅ Endpoints v2 de registro/login con Supabase
- ✅ JWT verification
- ✅ Middleware de autenticación
- ✅ Backward compatibility con auth v1
- ✅ Documentación completa
- ✅ Ejemplos de uso (curl)

### App Android (React Native + Expo)
- ✅ Pantalla de inicio
- ✅ Pantalla de solicitudes
- ✅ Pantalla de búsqueda de mecánicos
- ✅ Pantalla de mapa con GPS
- ✅ Pantalla de acciones (admin/config)
- ✅ Login y registro básicos
- ✅ Barra de navegación inferior fija
- ✅ Fondo personalizado
- ✅ Centro de notificaciones

---

## 📋 Pendiente (Roadmap)

### Fase 1: Supabase Foundation (INICIADA)
- ✅ **Autenticación con Supabase** - HECHO
- ⏳ Migración de BD a Supabase Postgres (tablas principales)
- ⏳ Supabase Storage para fotos de mecánicos
- ⏳ Real-time subscriptions con Supabase

### Fase 2: Tiempo Real (sin Supabase realtime, ver fase 1)
- ⏳ WebSocket para solicitudes entrantes en vivo
- ⏳ Push notifications sin polling
- ⏳ Actualización de estado en tiempo real

### Fase 3: Autenticación Avanzada
- ⏳ Email verification requerida antes de usar
- ⏳ Password reset por email
- ⏳ OAuth (Google, Facebook)

### Fase 4: Features faltantes
- ⏳ Perfil público completo del mecánico (fotos, servicios)
- ⏳ Calendario visual de turnos (no solo lista)
- ⏳ Pago / anticipo / retención real
- ⏳ Estados de servicio más finos (en camino, en sitio, diagnóstico, etc.)
- ⏳ Mejor UX móvil (inputs cortos, menos texto)

### Fase 5: Producción
- ⏳ Publicación en Google Play Store
- ⏳ Branding final
- ⏳ Onboarding completo
- ⏳ Testing de carga
- ⏳ Documentación de API final

---

## 🔧 Cómo empezar con Supabase Auth

### 1. Setup (5 minutos)
```bash
# 1. Ir a https://supabase.com y crear proyecto gratuito
# 2. Copiar SUPABASE_URL y SUPABASE_ANON_KEY
# 3. Crear .env en la raíz:
cat > .env << EOF
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
PORT=4000
EOF
```

### 2. Correr servidor
```bash
npm run dev
```

### 3. Probar endpoints
```bash
bash examples-auth-v2.sh
```

### 4. Actualizar app Android
- Cambiar endpoints de `/auth/register/` a `/auth/v2/register/`
- Cambiar login a `/auth/v2/login`
- Guardar accessToken en lugar de token manual
- Incluir `Authorization: Bearer <token>` en requests

---

## 📊 Estadísticas del código

### Backend
- **TypeScript**: ~3000 líneas
- **Endpoints**: 40+
- **Tablas SQLite**: 12
- **Auth methods**: 2 (v1 manual + v2 Supabase)

### App Android
- **React Native**: ~2000 líneas
- **Pantallas**: 5
- **Components**: 20+

---

## 🎯 Prioridades actuales

1. **AHORA**: Probar Supabase Auth (registrar usuario, login, obtener token)
2. **DESPUÉS**: Migrar app Android a v2 endpoints
3. **LUEGO**: Agregar Supabase Postgres para realtime
4. **SIGUIENTE**: OAuth y email verification
5. **FINAL**: Features adicionales y publicación

---

## 📚 Documentación generada

- [SUPABASE_AUTH_SETUP.md](./SUPABASE_AUTH_SETUP.md) - Guía de configuración
- [SUPABASE_IMPLEMENTATION_SUMMARY.md](./SUPABASE_IMPLEMENTATION_SUMMARY.md) - Cambios implementados
- [.env.example](./.env.example) - Variables de entorno
- [examples-auth-v2.sh](./examples-auth-v2.sh) - Scripts de prueba
- [README.md](./README.md) - README actualizado

---

## 💡 Notas importantes

- ✅ Los endpoints v1 siguen funcionando (no es breaking change)
- ✅ Supabase es gratuito hasta 50k usuarios
- ✅ No necesitas credenciales para correr servidor (fallback local)
- ✅ Puedes migrar usuarios gradualmente de v1 a v2
- ✅ JWT de Supabase dura 1 hora (configurable)
- ⚠️ Email verification aún se configura manual en Supabase console
- ⚠️ OAuth requiere setup adicional (clientID, secret) en Supabase

---

## 🚀 Próxima sesión

Cuando retomes:
1. Crear proyecto Supabase
2. Probar endpoints v2 con curl
3. Integrar en app Android
4. Comenzar con migración de BD a Postgres (si decides pasar a Fase 1 completa)

Toda la estructura está lista. Solo necesitas las credenciales de Supabase.
