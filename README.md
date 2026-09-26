# Mecanifique

Aplicación Android y API para solicitar mecánicos, gestionar el servicio y
mantener informadas a ambas partes.

> Estado: existe una versión publicada y un conjunto de mejoras locales
> verificadas que aún no se han publicado. Esta distinción evita confundir lo
> instalado en el APK actual con el trabajo que todavía debe desplegarse.

## Estado de implementación

### Publicado y disponible en el último APK

- API TypeScript/Express desplegada en `https://mecanifique.onrender.com`.
- Registro e inicio de sesión con Supabase mediante email y contraseña.
- Flujo preparado para Google OAuth: botón móvil, deep link
  `mecanifique://auth/callback` y endpoint `GET /auth/v2/google`.
- Registro de clientes y mecánicos, con roles `customer`, `mechanic` y `admin`.
- Mecánicos con disponibilidad, conexión/desconexión y búsqueda por ciudad,
  zona y cercanía GPS.
- Perfil público de mecánico: especialidades, experiencia, foto principal,
  galería, bio, calificación y reseñas.
- Solicitudes inmediatas o programadas, solicitud a un mecánico específico y
  turnos de agenda.
- Ciclo del servicio: pendiente, asignada, en camino, en sitio, diagnóstico,
  reparación, espera de refacciones, terminada o cancelada.
- Hold temporal y respuesta de aceptar/rechazar para solicitudes entrantes.
- Dirección textual del servicio, además de coordenadas cuando hay permiso de
  ubicación.
- Actualizaciones de avance, chat entre las partes, notificaciones push y
  centro de notificaciones.
- Reseña posterior a un servicio terminado.
- Perfiles de vehículos: marca, modelo, año, color, kilometraje, alias y fotos
  mediante URL. Las placas se devuelven parcialmente ocultas.
- La app permite guardar un vehículo y reutilizarlo al crear una solicitud.
- Onboarding, sesión persistente, indicadores de carga, botones con feedback,
  diseño de tarjetas y navegación inferior.
- Navegación tipo inDrive/Rappi: la app no dibuja mapas ni rutas propias —
  muestra la dirección/distancia y un botón "Cómo llegar" que abre Waze o
  Google Maps con el destino ya cargado. No requiere clave de Google Maps
  ni el SDK de mapas nativo.
- **Dual-rol**: una misma cuenta puede operar como cliente y como mecánico.
  `POST /api/account/switch-role` cambia el rol activo (`users.role`, que es
  lo que ya lee cada endpoint y cada pantalla — no hubo que tocar las 22
  verificaciones de rol existentes ni la navegación). Si el usuario todavía
  no tiene perfil del rol destino, se crea uno mínimo en el mismo momento
  (para mecánico: ciudad/zona/experiencia/especialidades pedidas en la app;
  para cliente: solo nombre/teléfono, ya conocidos). `admin` no participa.
  Botón "Cambiar a modo profesional" en Cuenta, "Cambiar a modo cliente" en
  Acciones (solo mecánicos, no admin).

### Inventario de pantallas (app móvil)

Numeración de referencia para reportar bugs o pedir cambios ("Pantalla 3,
veo este bug"):

| # | Nombre | Archivo | Quién la ve |
| --- | --- | --- | --- |
| 0 | Onboarding | `mobile/screens/OnboardingScreen.tsx` | Usuarios no logueados, primera vez |
| 1 | Login/Registro | `mobile/screens/LoginScreen.tsx` | Usuarios no logueados |
| 2 | Home | `mobile/screens/HomeScreen.tsx` | Todos (búsqueda/agendar para cliente, conectar/desconectar para mecánico) |
| 3 | Solicitudes | `mobile/screens/RequestsScreen.tsx` | Todos (lista/crear/detalle) |
| 4 | Mecánicos | `mobile/screens/MechanicsScreen.tsx` | Customer/Admin |
| 5 | Mapa | `mobile/screens/MapScreen.tsx` | Todos |
| 6 | Acciones | `mobile/screens/ActionsScreen.tsx` | Mechanic/Admin |
| 7 | Cuenta | `mobile/screens/AccountScreen.tsx` | Customer |
| 8 | Vehículos | `mobile/screens/VehiclesScreen.tsx` | Customer |

**Pendiente de UX conocido:** React Navigation está instalado
(`mobile/index.tsx`) pero no se usa para navegar — el cambio entre
pantallas ocurre por estado interno (`currentScreen`) y render
condicional, sin transición nativa entre ellas. Ver `mobile/README.md`.

### Implementado localmente y validado, pendiente de publicar

- Canal WebSocket básico para eventos en tiempo real y endpoints de salud de
  tiempo real/Supabase.
- Las pruebas cierran correctamente el servidor WebSocket al terminar.
- Flujo interno de verificación de identidad:
  - consentimiento explícito;
  - estado `draft`, `submitted`, `under_review`, `approved` o `rejected`;
  - requisitos: INE frontal, INE trasera y selfie para clientes; más
    comprobante de domicilio y antecedentes no penales para mecánicos;
  - registro de claves privadas de almacenamiento, nunca binarios ni URLs
    públicas de documentos;
  - envío a revisión y endpoints de revisión administrativa.
- Migración SQL equivalente para una futura base de datos Supabase/Postgres
  (`migrations/supabase/001_core_schema.sql` a `005_panic_alerts.sql`). Hoy
  Supabase solo se usa en producción para autenticación (Supabase Auth); todos
  los datos de negocio (mecánicos, solicitudes, pagos, disputas, etc.) viven
  en SQLite con disco persistente en Render. Estas migraciones son el
  esquema preparado para el día que se decida mover esos datos a Postgres,
  no una base de datos activa todavía.
- Disputas de clientes sobre un servicio ya realizado (categoría,
  descripción, revisión y resolución administrativa, con registro contable
  opcional de reembolso).
- Botón de emergencia (911) para clientes y mecánicos con registro de
  auditoría y notificación a administradores (`panic_alerts`, `POST
  /api/alerts/panic`).
- Actualización de ubicación del mecánico en primer plano cada 15 segundos o
  50 metros, solo mientras está conectado y tiene un servicio activo.
- Flujo más directo para mecánicos: desde una solicitud o al aceptarla, la app
  abre Acciones con el ID ya cargado y muestra vehículo, falla y destino.

Validación local realizada: `npm run build`, `npm test`, `npx tsc --noEmit` en
`mobile` y `npx expo-doctor` (18/18).

## Qué requiere configuración externa

Estas funciones están preparadas parcialmente o planificadas, pero no pueden
estar completas sin una cuenta, credenciales o decisión operativa:

| Función | Falta para activarla |
| --- | --- |
| Google OAuth | Activar Google en Supabase y registrar Client ID/Secret creados en Google Cloud. |
| Correos de producción | Configurar SMTP propio en Supabase. En pruebas se puede desactivar temporalmente Confirm email. |
| SMS | Configurar Supabase Phone Auth, Twilio o Vonage. |
| Documentos de identidad | Almacenamiento privado cifrado, carga de archivos, proveedor de prueba de vida y proceso legal de privacidad/retención. |
| Ubicación continua | Consentimiento adicional y configuración nativa para ubicación en segundo plano. |
| Pagos | Cuenta de Stripe Connect u otro PSP compatible con México, requisitos fiscales y política de reembolsos. |
| CLABE y liquidaciones | Onboarding bancario del proveedor de pagos y calendario comercial de dispersión. |

## Modelo de pagos y apartado (decidido, pendiente de construir)

Sin capital para financiar un fondo de refacciones prepagado, se decidió este
modelo de "apartado + ajuste":

1. Cada mecánico define su propia tarifa de mano de obra en su perfil. El
   **apartado mínimo es el 40% de esa tarifa** (`DEPOSIT_PERCENTAGE` en
   `src/payments.ts`). Si el mecánico todavía no configuró su tarifa, la
   solicitud se crea igual sin apartado calculado.
2. El cliente paga/autoriza el apartado al crear la solicitud con un mecánico
   específico.
3. El mecánico diagnostica en sitio:
   - Costo real = apartado → se cobra el apartado completo.
   - Costo real > apartado → el mecánico registra el monto extra en la app;
     el cliente recibe notificación con el desglose y **debe aceptar
     explícitamente** antes de que el mecánico compre refacciones o
     continúe. Si el cliente rechaza, el mecánico decide si termina ahí
     (cobrando solo el apartado) o se retira.
   - Costo real < apartado → se **reembolsa la diferencia** al cliente (no
     se queda el mecánico con el excedente, por reputación/confianza).

### Comisión de Mecanifique

Porcentaje del monto final del servicio, escalonado por volumen histórico
del mecánico (`getCommissionRate` en `src/payments.ts`) — mitigación a la
fuga a trato directo (ver "Riesgos operativos" más abajo):

| Servicios completados | Comisión |
| --- | --- |
| 0-19 | 15% |
| 20-49 | 12% |
| 50-99 | 10% |
| 100+ | 8% |

### Implicación técnica
Este modelo requiere **pre-autorización con captura manual/parcial y
reembolso parcial** en el procesador de pagos — no es un cobro simple de una
sola vez. En Stripe esto corresponde a `PaymentIntent` con
`capture_method: manual`, seguido de una captura por el monto final (que
puede ser menor al autorizado) o un `refund` parcial si aplica. Confirmar
que el procesador elegido para México soporte este flujo antes de
comprometerse a él.

### Estado real de implementación (actualizado)

- ✅ Fórmulas de apartado y comisión decididas e implementadas como
  funciones puras y testeadas en `src/payments.ts`.
- ✅ `deposit_amount` se calcula y guarda automáticamente al crear una
  solicitud con un mecánico ya resuelto (directo, por turno, o auto-match)
  que tenga tarifa de mano de obra configurada.
- ✅ Scaffold de Stripe (`src/stripe.ts`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` en `.env.example`) siguiendo el mismo patrón que
  `src/didit.ts` — `getStripeConfig()` devuelve `null` si no hay cuenta
  configurada. **Sin cuenta de Stripe todavía, así que ningún endpoint lo
  usa de verdad.**
- ⬜ Falta: cuenta de Stripe (Connect, para México) con cuentas conectadas
  por mecánico; `PaymentIntent` con `capture_method: manual` al crear la
  solicitud; captura/reembolso parcial al cerrar el servicio; webhook de
  Stripe para confirmar el estado del cobro; pantallas en la app móvil para
  autorizar el apartado, aceptar el extra y ver el reembolso.
- `extra_amount`, `extra_status`, `refund_amount` en `service_requests` y la
  tabla `payments` siguen siendo solo esquema — ningún endpoint los conecta
  a lógica de negocio real todavía (la única excepción es el registro
  contable manual desde `PATCH /api/admin/disputes/:id`, que no mueve
  dinero real).

En otras palabras: el modelo de pagos está **diseñado, con las fórmulas
decididas y el cálculo del apartado ya funcionando**, pero el cobro real
(mover dinero) sigue pendiente de que exista una cuenta de Stripe.

## Riesgos operativos identificados (sin resolver aún en código)

- **Fuga a trato directo ("te lo hago por fuera para evitar la comisión de
  la app")**: mitigaciones consideradas — pago debe completarse dentro de la
  app antes de marcar servicio como iniciado/completado; comisión que baja
  con volumen/antigüedad del mecánico; valor real a cambio de la comisión
  (seguro, más clientes, protección legal); histórico de reseñas como
  candado (se pierde si el mecánico se sale del sistema); detección de
  patrones de cancelación sospechosos. Ninguna de estas elimina el problema
  por completo, solo lo reduce.
- **Seguridad del mecánico y del cliente frente a la otra parte**: existe un
  botón de emergencia (llamar al 911 directo desde el teléfono, disponible
  para ambos roles en el detalle de una solicitud activa) que además deja un
  registro (`panic_alerts`) y notifica a los administradores con la última
  ubicación conocida y la solicitud asociada, para dar seguimiento humano
  después. La llamada real al 911 nunca depende de este registro ni se
  retrasa por él. Sigue pendiente evaluar seguimiento GPS compartido en vivo
  para contactos de confianza.
- **Responsabilidad si el mecánico daña el vehículo**: verificar identidad
  no es lo mismo que garantizar calidad de trabajo. Falta definir si existe
  seguro, fondo de garantía, o el usuario asume el riesgo.
- **Proceso de disputas** ("el trabajo no quedó bien" después de pagado):
  implementado — el cliente reporta con categoría y descripción
  (`POST /api/disputes`), un admin revisa y resuelve (`PATCH
  /api/admin/disputes/:id`), dejando opcionalmente un registro contable de
  reembolso en `payments`. Sin SLA de tiempo de resolución ni apelación
  todavía.
- **Mecánicos que aceptan más solicitudes de las que pueden atender**: falta
  límite de solicitudes simultáneas o penalización por cancelación tardía.

## Roadmap pendiente

1. Verificación telefónica por SMS para todos los usuarios.
2. Carga privada de documentos, selfie con prueba de vida y revisión humana.
3. Panel administrativo completo de identidad, auditoría, suspensión y
   retención/eliminación de datos.
4. Seguimiento GPS exclusivo para el cliente asignado, incluyendo trayecto a
   refaccionaria, regreso y eventualmente segundo plano con consentimiento.
5. Reseñas con moderación, filtros y perfiles públicos ampliados.
6. Pagos: autorización, captura, comisión, reembolso y liquidación de cada
   servicio.
7. Refacciones: cotización, aprobación, ticket, anticipo/método controlado y
   conciliación.
8. Métodos de pago tokenizados, CLABE, saldos y calendario de pagos para
   mecánicos.
9. Mayor simplificación y accesibilidad: menos texto, asistencia guiada y
   controles grandes para personas mayores.

## Flujos actuales

### Cliente

1. Registrarse o iniciar sesión.
2. Consultar mecánicos o buscar cercanos.
3. Revisar perfil, agenda, fotos, calificación y reseñas.
4. Crear solicitud: elegir vehículo guardado o escribirlo, describir la falla,
   seleccionar horario opcional y agregar dirección.
5. Consultar estado, actualizaciones, chat y detalle del mecánico.
6. Cancelar si el servicio aún no está cerrado.
7. Calificar al mecánico cuando el servicio esté terminado.

### Mecánico

1. Registrarse y esperar activación administrativa.
2. Completar perfil público y crear turnos.
3. Conectarse para recibir solicitudes.
4. Aceptar o rechazar una solicitud en hold.
5. Actualizar el estado: en camino, en sitio, diagnóstico, reparación,
   refacciones o terminado.
6. Enviar actualizaciones y mensajes al cliente.
7. Mantener disponibilidad y conexión.

### Administrador

1. Activar, suspender o devolver un mecánico a pendiente de verificación.
2. Asignar solicitudes manualmente si es necesario.
3. Consultar y administrar estados, disponibilidad y agenda.
4. Con las mejoras locales publicadas, revisar y dictaminar verificaciones de
   identidad.

## Ejecutar y validar

### API

```bash
npm install
npm run dev
npm run build
npm test
```

Copia [.env.example](./.env.example) a `.env` y define al menos
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_REDIRECT_URL` y
`SUPABASE_MOBILE_REDIRECT_URL`.

### App Android

```bash
cd mobile
npm install
npx expo start
npx tsc --noEmit
npx expo-doctor
```

Para crear un APK:

```bash
eas build --platform android --profile preview
```

## Configuración de Google OAuth

En Supabase, **Authentication → Providers → Google**:

- **Client IDs:** Client ID OAuth Web de Google Cloud.
- **Client Secret:** secreto del mismo cliente OAuth Web.
- **Skip nonce checks:** desactivado.
- **Allow users without an email:** desactivado.

En el cliente OAuth de Google Cloud registra la Callback URL que muestra
Supabase, normalmente:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

En Supabase, **Authentication → URL Configuration → Redirect URLs**, registra:

```text
https://mecanifique.onrender.com/auth/callback
mecanifique://auth/callback
```

## Seguridad y privacidad

No almacenar números completos de tarjeta, documentos oficiales, selfies o
ubicación como información pública. Los documentos deben usar almacenamiento
privado, URLs firmadas de corta duración, cifrado, control de acceso mínimo,
auditoría, consentimiento explícito y una política de retención/eliminación
conforme a la legislación aplicable.

## Documentación relacionada

- [Autenticación Supabase](./SUPABASE_AUTH_SETUP.md)
- [Despliegue Render](./render.yaml)
- [Build Android EAS](./mobile/eas.json)
