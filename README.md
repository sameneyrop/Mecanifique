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
- **Sesión que se renueva sola**: el access token de Supabase vence a la hora.
  El login (y el callback de Google) entregan también un refresh token, que la
  app guarda en SecureStore; cuando una petición responde 401, la app llama a
  `POST /auth/v2/refresh`, guarda el token nuevo y repite la petición sin que
  el usuario note nada. Si la renovación ya no es posible, cierra la sesión
  con el aviso "Tu sesión expiró. Vuelve a iniciar sesión." (antes la app
  quedaba con un token muerto y todo respondía "Autenticación requerida").
- Inicio de sesión con correo y contraseña, o **con Facebook** ("Entrar con
  Facebook" / "Crear cuenta con Facebook"; ver "Configuración de Facebook
  Login"). `GET /auth/v2/oauth/facebook?redirectTo=` devuelve la dirección de
  Supabase y solo acepta regresar a la app (`mecanifique://`, `exp://`). La
  sesión llega en el hash de la dirección de regreso. Una cuenta nueva nace
  como cliente, y si el correo ya tenía cuenta, Supabase la une a esa misma.
  En el registro de mecánico, "Continuar con Facebook" pasa directo a "Tu
  trabajo" y pide el teléfono (Facebook no lo da); al volver, la app llama a
  `switch-role` y guarda el teléfono en el perfil. "Continuar con Google" sigue
  quitado; ver "Configuración de Google OAuth".
- Registro de clientes y mecánicos, con roles `customer`, `mechanic` y `admin`.
  El registro solo crea clientes o mecánicos (pendientes de verificación):
  los metadatos de Supabase los escribe el propio usuario, así que el rol
  `admin` nunca se toma de ahí. Un admin se asigna a mano en Turso con
  `UPDATE users SET role = 'admin' WHERE login = '<correo>'`.
- Mecánicos con disponibilidad, conexión/desconexión y búsqueda por ciudad,
  zona y cercanía GPS.
- Perfil público de mecánico: especialidades, experiencia, foto principal,
  galería, bio, tarifa de mano de obra, calificación y reseñas.
- **Fotos desde el teléfono**: en Acciones → Mi perfil, el mecánico toca un
  recuadro y elige "Tomar foto" o "Elegir de mis fotos" (antes había que pegar
  enlaces https). La app reduce la foto (máx. 1280 px, JPG ~200 KB) y la sube a
  `POST /api/uploads/photo` (solo mecánico/admin), que confirma por sus
  primeros bytes que sea JPG o PNG, la guarda en la base de datos (tabla
  `uploaded_photos`) y la sirve en `/uploads/<archivo>`. La foto queda
  guardada en el perfil al momento, sin tocar "Guardar". Las fotos que se
  quitan o reemplazan todavía no se borran de la tabla.
- **Servidor dormido (Render gratis)**: Render apaga el servidor tras 15 min
  sin uso y tarda 30–60 s en despertar. La app espera hasta 70 s (antes
  cortaba a los 15 con un error), muestra "Conectando con el servidor…" si
  una petición tarda más de 5 s, y despierta el servidor (`/health`) al
  abrirse y al volver a primer plano. No reintenta peticiones: la original sí
  llega al servidor al despertar, y repetirla podría duplicar una solicitud.
  Para que no se duerma, un servicio externo gratuito (cron-job.org) visita
  `/health` cada 10 minutos.
- **Base de datos en Turso** (SQLite en la nube, vía `@libsql/client`): el
  plan gratis de Render no permite discos y borra su sistema de archivos en
  cada deploy y cada vez que el servicio se duerme, así que un archivo
  SQLite ahí perdía todo. Con `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` en
  Render se usa Turso; sin ellas (desarrollo y tests) se usa
  `data/mecanifique.db` con el mismo motor.
- **Cuenta completa**: editar nombre y teléfono (`/api/account/profile`, el
  nombre también se copia a Supabase), cambiar contraseña
  (`POST /api/account/password`), mecánicos favoritos (corazón en el perfil,
  lista en Cuenta; `/api/favorites`) y "Reportar un problema" / "Obtener
  ayuda" desde la app (`POST /api/support`, avisa a los admins con una
  notificación). El registro ahora manda nombre, teléfono y rol a Supabase en
  `data` (antes iban en `user_metadata`, que Supabase ignoraba).
- **Sitio web** (`web/`, publicado en `mecanifique.vercel.app`): página
  estática en español (inglés opcional) para clientes, mecánicos e
  inversionistas, con aviso de privacidad en `/privacidad`. Vercel está
  conectado a este repo y publica solo `web/` gracias al `vercel.json` de la
  raíz (sin instalar ni compilar); se actualiza solo con cada push a `main`.
  La raíz del servidor de Render (`/`) redirige al sitio (`SITE_URL`).
- **Aviso de privacidad dentro de la app** (lo exige Google Play además del
  enlace en la ficha): al crear cuenta ("Al crear tu cuenta aceptas el Aviso
  de privacidad"), en el Login, en Cuenta → "Aviso de privacidad" y en
  Acciones → Sesión. Abre `https://mecanifique.vercel.app/privacidad`
  (`web/privacidad.html`) en un navegador dentro de la app
  (`openPrivacyNotice` en `mobile/utils.ts`): un solo texto que mantener.
- **Lista de espera del sitio web**: formulario HTML normal que hace POST a
  `/lista-de-espera` (cliente o mecánico, nombre opcional, WhatsApp o correo,
  ciudad). Guarda en `waitlist_signups` sin duplicar (contacto normalizado),
  descarta bots con un campo trampa, avisa a los admins y regresa al sitio con
  `?registro=ok|error#lista`. La dirección de regreso es fija
  (`WAITLIST_REDIRECT_URL`, por defecto el sitio de Vercel) para no permitir
  redirecciones abiertas. No necesita CORS porque no es un fetch.
  El admin la ve en **Acciones → Lista de espera** (`GET /api/admin/waitlist`),
  con los que faltan de contactar primero y filtro Clientes/Mecánicos. Cada
  registro tiene botones para abrir WhatsApp (o el correo) con un saludo que
  se puede editar, copiar el contacto, "Ya le escribí" (`contacted_at`, vía
  `POST /api/admin/waitlist/:id/contacted`) y "Quitar de la lista"
  (`DELETE /api/admin/waitlist/:id`), solo si la persona pidió que se borren
  sus datos.
- **Eliminar cuenta** (requisito de Google Play): Cuenta → Seguridad →
  "Eliminar mi cuenta" (mecánico: Acciones → Sesión), con explicación y doble
  confirmación; bloqueado si hay un servicio en curso o una solicitud
  buscando mecánico. `DELETE /api/account` borra primero el usuario en
  Supabase Auth (necesita `SUPABASE_SERVICE_ROLE_KEY` en Render; sin ella
  responde 503) y luego, en una transacción, borra los datos personales y
  anonimiza el historial compartido (`src/accountDeletion.ts` documenta qué
  se borra, qué se anonimiza y qué se conserva). Página pública
  `/eliminar-cuenta` para pedirla sin la app (el enlace que pide la ficha de
  Play); guarda la solicitud y avisa a los admins, que la procesan a mano por
  ahora. `/health` indica `accountDeletion: true` cuando la clave existe.
- **Comunidad** (Cuenta → Comunidad; el mecánico entra desde Acciones):
  cualquier usuario publica preguntas sobre su auto (título, categoría,
  vehículo, descripción); solo mecánicos verificados (`status = 'active'`)
  responden, y cada respuesta muestra su calificación y un botón para
  pedirle el servicio. "Seguir" una pregunta (avisa de cada respuesta
  nueva), marcar respuestas como "Útil", búsqueda, filtro por categoría y
  "Mis preguntas". Al autor y a quienes la siguen les llega una notificación
  con cada respuesta; el autor o un admin pueden borrar. Textos propios, no
  copiados de competidores. Los clientes aparecen como
  "Emilio L." (primer nombre + inicial). Rutas en `src/routes/community.ts`
  (`/api/community/*`).
- **Promociones**: el mecánico publica, pausa y borra promociones en
  Acciones → Promociones (vigencia sin fecha, 1 semana, 1 mes o 3 meses). El
  cliente las ve en Cuenta → Promociones, las más cercanas primero, y también
  en el perfil de cada mecánico. Solo se muestran las activas, vigentes y de
  mecánicos activos (`/api/promotions`).
- Solicitudes inmediatas o programadas, solicitud a un mecánico específico y
  turnos de agenda.
- Ciclo del servicio: pendiente, asignada, en camino, en sitio, diagnóstico,
  reparación, espera de refacciones, terminada o cancelada.
- Hold temporal y respuesta de aceptar/rechazar para solicitudes entrantes.
- **Onboarding del mecánico con checklist**: mientras la cuenta no está
  lista, Inicio del mecánico muestra "Activa tu cuenta": 1) verificar
  identidad (con su estado: en revisión, rechazada, etc.), 2) poner su
  tarifa de mano de obra (obligatoria: sin ella no hay apartado), 3)
  conectarse. CONECTARME queda deshabilitado mientras la cuenta no esté
  activa, y el servidor también lo rechaza con una explicación
  (`applyMechanicConnection`). La app lee el perfil propio en
  `GET /api/mechanics/me` (la lista pública solo trae activos) y lo revisa
  cada 20 s mientras está pendiente, así el checklist avanza solo cuando
  Didit aprueba.
- **Entrar con huella** (APK 1.0.1, `mobile/biometric.ts`). Al cerrar sesión
  se pregunta una vez "¿Entrar con tu huella la próxima vez?". Si se acepta,
  el refresh token se sella con `SecureStore` y `requireAuthentication` en vez
  de borrarse, en un llavero propio. La pantalla de entrada muestra "Entrar
  como <nombre>": pide la huella, renueva con `POST /auth/v2/refresh` y
  descarta lo sellado, porque es de un solo uso (el refresh token rota). No se
  guarda la contraseña y funciona también con Facebook. Si se agrega otra
  huella al teléfono, Android invalida el sello y se entra con la contraseña.
  Entrar normal o eliminar la cuenta borra lo sellado. Se activa o desactiva
  en Cuenta → Seguridad (cliente) o Acciones → Sesión (mecánico), con el
  componente `BiometricSetting`. No requiere módulo nuevo: `expo-secure-store`
  ya trae la pantalla de huella de Android.
- **Identificador del celular** (APK 1.0.1): en Android, `X-Device-Id` es
  `android-<Android ID>` (`expo-application`), que no cambia al reinstalar,
  solo con un restablecimiento de fábrica. En otros casos es uno al azar.
- **Recorrido de la app** (`mobile/components/AppTour.tsx`): la primera vez
  que se entra con cada rol en ese teléfono, con sesión y sin la verificación
  de teléfono pendiente. Cliente y mecánico tienen 9 pasos cada uno y quien
  cambia de modo ve el del otro rol. Cambia de pantalla solo, oscurece todo
  menos el elemento que explica (envuelto en `<TourTarget id>`: barra de
  abajo, campana, "Ahora mismo / Agendar" y "Tu estado") y lo marca. Si el
  elemento no se ve, desplaza la pantalla para mostrarlo; si no existe, el
  paso sale centrado. Se puede saltar, y lo visto se guarda en AsyncStorage
  (`mecanifique.tour.<rol>.<userId>`). Se vuelve a ver en Cuenta (cliente) o
  en Acciones → Sesión (mecánico).
- **Foto de perfil obligatoria del mecánico** (`mechanics.profile_photo_url`):
  es el paso 2 de "Activa tu cuenta" (quedan 4 pasos). Es una selfie con la
  cámara frontal, sin galería, recortada en cuadro y de máximo 800 px
  (`takeProfilePhoto` en `mobile/photos.ts`), y se sube con
  `PUT /api/mechanics/me/profile-photo`. Al reemplazarla se borra la anterior
  de `uploaded_photos` y no se puede quitar. Sin foto,
  `applyMechanicConnection` no deja conectarse, y al arrancar el servidor
  desconecta a quien esté conectado sin foto. El cliente la ve en "Tu
  mecánico", junto con estrellas, servicios y "Cuenta verificada", y con el
  aviso de revisar que sea la persona de la foto. También sale en la lista y
  el perfil de mecánicos. Se cambia en Acciones → Mi perfil. Es distinta de la
  foto de portada (`cover_photo_url`), que puede ser del taller.
- **Conectarse deja al mecánico disponible** (`is_available = 1`) salvo que
  tenga un trabajo en curso. Antes se conservaba el valor anterior, y un
  mecánico nuevo (registrado con 0) nunca recibía solicitudes automáticas.
- **Dual-rol + identidad**: si un cliente ya verificado activa el modo
  profesional, su perfil de mecánico nace activo (antes quedaba pendiente
  para siempre); `GET /api/mechanics/me` reconcilia a quien ya estaba en
  ese caso.
- **Emparejamiento por distancia**: si la solicitud tiene coordenadas, se
  ofrece al mecánico disponible más cercano dentro de 25 km
  (`findAvailableMechanic`, `MATCH_RADIUS_KM`). La ciudad/zona escritas son
  solo respaldo, y solo para mecánicos sin ubicación registrada (antes era
  la única forma, y fallaba con cualquier diferencia de texto). El mecánico
  manda su ubicación al conectarse (CONECTARME), además de durante un
  servicio activo.
- **Pedir un servicio con menos pasos**: la ubicación de la solicitud se
  llena sola con el GPS (coordenadas + ciudad/zona/dirección por
  geocodificación inversa, todo editable, con botón "Usar mi ubicación
  actual"); el vehículo principal se preselecciona y se salta ese paso; el
  mecánico elegido desde Mecánicos se muestra por nombre con "Quitar" (ya no
  se escribe su ID). "Agendar fecha" en Inicio lleva a Mecánicos, donde
  están los turnos reales de cada mecánico.
- **Solicitud entrante a pantalla completa** (mecánico conectado): aparece
  encima de cualquier pantalla (`mobile/components/IncomingRequestOverlay.tsx`)
  con vibración, cuenta regresiva del hold, vehículo, falla, dirección,
  distancia y horario pedido. Aceptar (verde, grande) / Rechazar (con
  confirmación). "Ver después" o el gesto de atrás la minimizan sin
  rechazarla; sigue en Mapa hasta que venza. Al vencer se cierra sola.
  Se detecta con el mismo sondeo de 10 s de siempre, más la notificación
  push.
- **Servicio en curso en Inicio**: mientras hay una solicitud activa, Inicio
  deja de mostrar la búsqueda y muestra ese servicio. Cliente: progreso,
  espera/reasignación, mecánico con botón "Llamar", chat, emergencia y
  cancelar. Mecánico: cliente, dirección, "Cómo llegar", chat, emergencia y
  **un solo botón grande de siguiente paso** (Voy en camino → Ya llegué →
  Empezar diagnóstico → Empezar reparación → Terminar servicio, con
  "Esperando refacciones" como desvío). Al aceptar una solicitud, el
  mecánico llega directo ahí. Los componentes (progreso, chat, espera,
  emergencia) están en `mobile/components/ActiveService.tsx` y también los
  usa el detalle de Solicitudes. El chat se refresca solo cada 10 s.
- **Seguimiento del mecánico** (en camino y por refacciones): mientras la
  solicitud está en `en_route` o `awaiting_parts`, el cliente ve al
  mecánico en el radar con su auto al centro, la distancia, hace cuánto
  llegó el último punto y "Ver en Google Maps"
  (`mobile/components/MechanicTracker.tsx`, sondeo de 10 s a `GET
  /api/service-requests/:id/mechanic-location`). En cualquier otro estado
  el servidor no expone la ubicación (`src/tracking.ts`). El teléfono del
  mecánico la manda en segundo plano con un servicio en primer plano de
  Android y aviso fijo ("Compartiendo tu ubicación",
  `mobile/liveTracking.ts`): basta el permiso de ubicación normal, no se
  pide "permitir siempre". Se apaga al cambiar de estado, y también solo si
  el servidor responde que ya nadie lo sigue. No funciona en Expo Go (ahí
  solo se manda con la app en pantalla); se prueba con el APK. **Al
  publicar en Play Store** hay que llenar la declaración de servicios en
  primer plano de tipo ubicación (Play Console → Contenido de la app).
- **Propina directa**: el mecánico puede poner, si quiere, su CLABE y el
  nombre del titular (Acciones → Mi perfil → Propinas; `PUT/DELETE
  /api/mechanics/me/tip-info`, se valida el dígito de control). Al terminar
  un servicio, el cliente ve "¿Quieres dejarle propina?" con la CLABE y
  "Copiar CLABE", o la sugerencia de dársela en efectivo (`GET
  /api/service-requests/:id/tip-info`, solo el cliente de un servicio
  terminado; `src/tips.ts`). Mecanifique no cobra ni pasa ese dinero, por la
  misma razón que no cobra el trabajo del mecánico (ver "Modelo de pagos").
- **Pantalla de carga**: la nativa (`expo-splash-screen` en `app.json`: fondo
  `#0072B2` y el logo blanco `assets/splash-logo.png` a 180 de ancho) se
  cambia sin que se note por `components/AnimatedSplash.tsx`: el logo queda
  igual y en el mismo lugar (no se altera), y encima aparece el coche del
  ícono (`assets/splash-car.png`, recortado de `android-icon-monochrome.png`)
  sobre un elevador de taller que lo sube y lo baja como indicador de carga;
  al terminar el elevador baja y la pantalla se desvanece. Con "reducir
  movimiento" activado el coche se queda quieto. Se queda mientras la app
  revisa la sesión, al menos 1.4 s, y si tarda más de 6 s explica que el
  servidor puede tardar en despertar. Cambiar la animada llega por EAS
  Update; cambiar la nativa requiere un APK nuevo.
- **Verificación por teléfono (SMS)** (`src/phoneVerification.ts`,
  `mobile/screens/PhoneVerificationScreen.tsx`): con Twilio Verify
  configurado (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_VERIFY_SERVICE_SID`), cada cuenta confirma su número con un código
  al registrarse o al cambiarlo, y otra vez al entrar desde un teléfono nuevo.
  El servidor crea el identificador del teléfono al confirmar el primer
  código; la app lo guarda cifrado y lo manda en `X-Device-Id`. Mientras
  falte, todo responde 403 `PHONE_VERIFICATION_REQUIRED` salvo `/auth/*`,
  `/api/account/verification*` y eliminar la cuenta. Sin esas variables queda
  apagada. **Encenderla solo cuando todos tengan un APK con esta pantalla**:
  uno viejo se quedaría bloqueado sin forma de verificarse.
- **Registro**: casilla obligatoria de mayoría de edad y aceptación de
  Términos y Aviso de privacidad; contraseñas de al menos 8 caracteres con
  letras y números (app y servidor); límite de intentos. El servidor confía
  en el proxy de Render (`trust proxy`): antes todos los usuarios compartían
  la IP del proxy y los límites de intentos eran para todos juntos.
- **Cotización obligatoria antes de reparar** (`src/quotes.ts`,
  `mobile/components/Quote.tsx`): la tarifa del perfil es "Visita y
  diagnóstico" (`mechanics.labor_rate`). Después del diagnóstico el mecánico
  manda mano de obra, refacciones estimadas y qué hará (`POST
  /api/service-requests/:id/quotes`); el cliente la acepta o no (`.../quotes/
  :quoteId/respond`), con aviso push a cada uno. Sin una cotización aceptada
  el servidor no deja pasar a `repairing` ni a `awaiting_parts`; si el
  cliente no acepta, el mecánico manda otra o termina sin reparar. Ya
  reparando puede cotizar algo adicional. Al terminar, `final_price` es la
  visita más lo aceptado (ver "Cobro al terminar"). Mecanifique no cobra ese
  monto: es el registro de lo acordado.
- **"¿Qué sigue?"** (`mobile/components/ServiceGuide.tsx`): arriba del
  servicio en curso, cliente y mecánico ven qué les toca hacer en ese paso,
  con las cantidades reales ("Si no la aceptas, solo pagas la visita: $400").
  Los avisos push al cliente dicen lo mismo con el nombre del mecánico
  (`customerStatusNotice` en el servidor). La oferta al mecánico muestra su
  precio de visita, y al aceptar el cliente recibe cuánto cuesta.
- **Una solicitud a la vez**: un cliente con una solicitud abierta no puede
  crear otra (`REQUEST_ALREADY_OPEN`); con dos, podían ir dos mecánicos.
- **Navegación**: "Voy en camino" abre la ruta sola (Waze o Google Maps) y
  "Cómo llegar" funciona aunque el cliente no haya compartido su ubicación:
  navega por la dirección escrita más la ciudad (`openServiceNavigation`).
- **Reasignación automática**: si el mecánico rechaza o deja vencer el hold,
  la solicitud pasa sola al siguiente mecánico disponible en la zona (sin
  volver a ofrecérsela a quien ya no la tomó). Los holds vencidos se
  detectan con un barrido cada 20 s en el servidor (`sweepExpiredHolds`).
  Solo aplica a solicitudes automáticas (`assignment_mode = 'auto'`); si el
  cliente eligió a un mecánico o turno específico (`'direct'`), no se cambia
  de mecánico sin su permiso. Si no hay nadie disponible, se le avisa al
  cliente y puede pedir "Buscar de nuevo" (`POST
  /api/service-requests/:id/search-again`), que también convierte una
  solicitud dirigida en automática.
- Dirección textual del servicio, además de coordenadas cuando hay permiso de
  ubicación.
- Actualizaciones de avance, chat entre las partes y notificaciones push.
- **Notificaciones**: pantalla propia que se abre con la campana junto a
  "Bienvenido, (nombre)" (con el número sin leer). Tocar un aviso lo marca
  como leído y lleva a la solicitud o a la pregunta de la Comunidad que
  avisa; "Marcar todas como leídas" usa `POST /api/notifications/read-all`.
  "Atrás" regresa a la pantalla donde estabas.
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
| 2 | Home | `mobile/screens/HomeScreen.tsx` | Todos. Cliente: su servicio en curso si tiene uno, si no la búsqueda. Mecánico: su trabajo en curso (con botón de siguiente paso) + conectar/desconectar |
| 3 | Solicitudes | `mobile/screens/RequestsScreen.tsx` | Todos (lista/crear/detalle) |
| 4 | Mecánicos | `mobile/screens/MechanicsScreen.tsx` | Customer/Admin. Arriba el radar de conectados cerca (antes en Mapa), abajo búsqueda por zona y perfil |
| 5 | Mapa | `mobile/screens/MapScreen.tsx` | Mechanic (solicitud entrante y trabajo en curso) |
| 6 | Acciones | `mobile/screens/ActionsScreen.tsx` | Mechanic/Admin |
| 7 | Cuenta | `mobile/screens/AccountScreen.tsx` | Customer |
| 8 | Vehículos | `mobile/screens/VehiclesScreen.tsx` | Customer, desde Cuenta → "Mis vehículos" |
| 9 | Notificaciones | `mobile/screens/NotificationsScreen.tsx` | Todos, desde la campana de arriba |

Barra inferior: el cliente tiene 4 botones (Inicio, Solicitudes, Mecánicos,
Cuenta); el mecánico, 4 (Inicio, Solicitudes, Mapa, Acciones). Mapa y
Vehículos ya no son botones del cliente: el radar vive en Mecánicos y los
vehículos en Cuenta (y se eligen o guardan al pedir un servicio). Las
notificaciones no están en la barra: tienen su campana arriba.

Ilustraciones: las del personaje azul están en `mobile/illustrations.ts` y
se muestran con `<Illustration>` (o `EmptyState image=...`) de
`components/ui.tsx`; para cambiar cuál va en cada lugar basta con cambiar la
referencia ahí.

**Pendiente de UX conocido:** React Navigation está instalado
(`mobile/index.tsx`) pero no se usa para navegar — el cambio entre
pantallas ocurre por estado interno (`currentScreen`) y render
condicional, sin transición nativa entre ellas. Ver `mobile/README.md`.
El botón "atrás" de Android se maneja a mano con `BackHandler` en
`App.tsx`: retrocede una sub-vista (detalle/creación de solicitud), luego
vuelve a Inicio, y desde Inicio sale de la app. Si se agrega una pantalla
con sub-vistas nuevas, hay que sumarla a ese handler.

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
  en SQLite (Turso en producción). Estas migraciones son el
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
- Al aceptar una solicitud, el mecánico vuelve a Inicio, donde vive el trabajo
  en curso (dirección, "Cómo llegar", botón de siguiente paso y chat). Acciones
  del mecánico quedó solo para lo que ven los clientes: perfil público
  (bio, tarifa, fotos) y agenda de turnos. Cambiar estados por número de
  solicitud o asignar mecánicos es una herramienta de admin.
- **Mismo lenguaje visual en todas las pantallas** (el de Inicio): bloques
  separados, selección suave (borde azul y fondo claro, no relleno sólido),
  datos con ícono en vez de "Etiqueta: valor", fechas legibles ("Hoy, 09:52")
  y un solo botón principal al final de cada tarjeta. Las ilustraciones se
  reemplazaron por recuadros punteados (`ImagePlaceholder` en
  `mobile/components/ui.tsx`) hasta tener las ilustraciones de marca finales;
  los archivos viejos siguen en `mobile/assets/` pero ya no se usan.
  Onboarding y Login también: logo y contenido directo sobre el fondo (sin el
  recuadro con degradado), "Iniciar sesión / Crear cuenta" arriba y, al crear
  cuenta, "Soy cliente / Soy mecánico" como opciones con ícono. Los campos de
  correo ya no ponen mayúscula inicial ni autocorrigen.

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

## Modelo de pagos: comisión al mecánico (vigente)

El cliente **no le paga nada a Mecanifique**: le paga el servicio directo al
mecánico, en efectivo o transferencia. Mecanifique cobra al **mecánico** una
comisión por los servicios que termina (`src/commissions.ts`). Como el dinero
del trabajo nunca pasa por la app, Mecanifique no cobra por cuenta de
terceros: no tiene que retener ISR/IVA como plataforma que cobra por otros ni
dar de alta a cada mecánico en Stripe. (Confirmar con un contador si hay
obligación de informar al SAT como plataforma que intermedia.)

- **10 % de la visita y la mano de obra**, sin las refacciones (siguen a
  precio de ticket), con **mínimo $30** (nunca más de lo que cobró) y **tope
  $300** por servicio (`commissionFor`). Se registra al terminar el servicio
  (`commission_charges`). Las cancelaciones con cargo no pagan comisión.
- **Primeros 30 días gratis** desde que el mecánico crea su cuenta
  (`COMMISSION_FREE_DAYS`): el servicio queda con comisión $0. Quien ya era
  mecánico al lanzar la comisión los cuenta desde el lanzamiento, el 29 de
  septiembre de 2026 (`COMMISSION_LAUNCH_DATE`).
- **Nunca paga comisión de lo que no le pagaron**: entra al corte cuando
  confirma el pago, o 48 h después de terminar si no reportó que no le
  pagaron; con un reporte abierto queda "en espera".
- **Corte semanal** (`commission_statements`): cada lunes, hora de México
  (`sweepCommissions`, cada 10 min), se junta lo pendiente; tiene 7 días para
  pagarlo. Con Stripe paga con tarjeta u OXXO (`/commission-statements/:id/
  checkout`, se confirma solo; OXXO tarda 1 a 3 días); sin Stripe, por
  transferencia a `MECANIFIQUE_PAYMENT_CLABE` / `MECANIFIQUE_PAYMENT_HOLDER` y
  un admin lo marca pagado (Acciones → Cortes de comisiones).
- **Corte vencido**: no puede conectarse hasta pagarlo
  (`applyMechanicConnection`).
- La app se lo muestra en Inicio (corte por pagar), en Acciones → Comisiones
  (cómo se calcula, cortes, comisión de cada servicio) y en la tarjeta de
  cobro de cada servicio.

### Cuota de servicio al cliente (apagada)

Era el modelo anterior; el código sigue, pero **queda apagado** aunque haya
Stripe, salvo `SERVICE_FEE_ENABLED=true`. Pedir tarjeta por adelantado frenaba
a quien paga en efectivo o no tiene tarjeta.

Cómo funcionaba (`src/serviceFees.ts`, `src/stripe.ts`):

1. Al enviar la solicitud, la app valida el formulario y abre Stripe Checkout
   (`POST /api/payments/service-fee`) en un navegador dentro de la app. La
   tarjeta solo queda **apartada** (captura manual).
2. Stripe regresa a `/pagos/regreso`, que devuelve a la app (solo a
   `mecanifique://` o `exp://`, nunca a otro sitio). La app crea la
   solicitud con `serviceFeeSessionId`; el servidor verifica con Stripe que la
   tarjeta quedó apartada y reclama la cuota (una cuota, una solicitud) antes
   de enviarla a los mecánicos.
3. Cuando el mecánico llega (`on_site` o cualquier paso posterior) se
   **cobra**. Si la solicitud se cancela antes, se **libera** y no se cobra
   nada. Si algo falla después del pago, la app reutiliza ese pago en el
   siguiente intento.
4. Un barrido cada 10 minutos libera cuotas pagadas que nunca llegaron a una
   solicitud (la app se cerró a medio camino).

Configuración en Render: `STRIPE_SECRET_KEY` (también la usa el corte de
comisiones), `SERVICE_FEE_ENABLED=true` para prenderla y, opcional,
`SERVICE_FEE_MXN`.
Una tarjeta apartada vence a los 7 días, así que los turnos de la agenda solo
se pueden apartar dentro de los próximos 7 días, hoy incluido
(`lastBookableSlotDate` en el servidor, `BOOKING_WINDOW_DAYS` en la app). Queda
un hueco: el campo libre "¿Para cuándo?" acepta cualquier texto, así que
alguien podría escribir una fecha lejana; ahí el mecánico acepta en ese
momento y lo normal es que llegue antes de 7 días.

### Cobro al terminar y disputas de pago (`src/servicePayment.ts`)

Lo que el cliente le paga al mecánico es la **visita y diagnóstico**
(`service_requests.visit_fee`, fijada con la tarifa del mecánico cuando
acepta; si luego la cambia, no afecta) **más las cotizaciones aceptadas**. Al
terminar, Inicio le muestra al cliente "Págale $X a Juan" con el desglose y la
CLABE del mecánico si la registró, y al mecánico "Cobra $X a María".

Como el dinero no pasa por la app, **nadie decide solo si se pagó**:

- El cliente confirma "Ya le pagué" en efectivo o por transferencia
  (`customer_paid_at`, `payment_method`) y el mecánico "Ya me pagó"
  (`paid_at`). Todo queda con fecha y hora.
- Si el mecánico reporta "No me ha pagado" (`unpaid_reported_at`), se abre
  una disputa `unpaid` y el cliente **no puede pedir otro servicio**
  (`UNPAID_SERVICE`) hasta que el mecánico confirme el pago o el cliente diga,
  dejando constancia, que ya pagó.
- **Calificación del cliente** (`src/customerReviews.ts`, tabla
  `customer_reviews`): la pone el mecánico del servicio, una vez, al terminar
  o si se canceló con cargo (`POST /api/service-requests/:id/customer-review`,
  tarjeta `CustomerReviewCard` en Inicio y en el detalle). La solicitud
  entrante trae `customerRating` y la app muestra "★ 4.8 (12) · 5 servicios
  terminados" o "Cliente nuevo". El cliente ve su propio promedio en Cuenta
  (`customerRating` en `/api/account/profile`). El comentario solo queda para
  Mecanifique. Se borran al eliminar la cuenta del cliente.
- **Cuentas nuevas para no pagar** (`src/unpaidFingerprints.ts`): al reportar
  "No me ha pagado" se guarda la huella de la cuenta en `unpaid_fingerprints`.
  Son HMAC del teléfono, el correo y los celulares, más la ubicación del
  servicio. También se guarda justo antes de eliminar una cuenta con deuda, y
  se completa si el deudor vuelve a intentar pedir. Los celulares salen de
  `user_devices`: la huella del `X-Device-Id`, que la app crea desde que se
  abre y guarda en `/auth/v2/me` y al pedir servicio. Si otra cuenta con la
  misma huella intenta pedir, recibe `UNPAID_LINKED_ACCOUNT` con un mensaje
  genérico, sin revelar de quién es la deuda. A la solicitud entrante del
  mecánico se le agregan `unpaidNearby` (otra cuenta dejó un servicio sin
  pagar a menos de 100 m; es un aviso, no un bloqueo) y
  `customerCompletedServices` (la app muestra "Cliente nuevo" o "N servicios
  terminados"). Las huellas no se borran: dejan de contar en cuanto el
  servicio se paga (`UNPAID_DEBT_SQL`). Con la verificación por SMS apagada,
  quien use otro número, otro correo y reinstale la app no queda cubierto;
  con Twilio encendido, cada cuenta necesita un número real distinto.
- Si el cliente dice que pagó y el mecánico que no, se abre una disputa
  `payment_disagreement` (se avisa a los dos y a los admins) **sin bloquear al
  cliente**: un mecánico no puede bloquear a quien sí le pagó con solo decir
  que no.
- Si el mecánico después confirma el pago, la disputa de pago se cierra sola.

### Ticket de refacciones (`src/partsReceipts.ts`)

Para que el mecánico no infle el precio de las piezas, la cotización separa
las **refacciones que ya trae** (`parts_on_hand_amount`, precio fijo) de las
**que va a comprar** (`parts_amount`, un estimado). Las compradas se cobran
**a precio de ticket** (tabla `parts_receipts`):

- Al tocar "Voy por refacciones" (`awaiting_parts`) empieza la salida
  (`parts_trip_started_at`). No puede retomar la reparación ni terminar hasta
  subir la foto del ticket o decir "No compré nada"
  (`PARTS_RECEIPT_REQUIRED`). Sin ticket no se cobra nada comprado.
- La foto se toma **solo con la cámara** de la app (`mobile/photos.ts`), no
  desde la galería; se guarda junto con lo que costó y, opcional, la tienda.
  El cliente la recibe al instante (push y en el servicio).
- Con ticket y dentro de lo estimado se acepta sola. Si pasa de lo estimado,
  o la tienda no dio ticket (foto de la nota o de las piezas), el cliente la
  aprueba; si no la aprueba, se cobra hasta lo estimado (`chargeReceipts`).
- No se puede terminar con un ticket esperando al cliente
  (`PARTS_RECEIPT_PENDING`).
- El recorrido GPS del viaje por refacciones ya queda registrado (seguimiento
  en vivo), como evidencia si hay disputa.
- Puede recorrer varias tiendas: el ticket se pide al regresar, no en cada
  una, y puede subir varios. "No la encontré, voy a otra tienda" solo avisa al
  cliente (`/parts-trip/next-store`), que lo ve moverse en el mapa.
- **Ajuste de lo acordado** (`service_quotes.kind = 'adjustment'`): si no se
  hizo todo (p. ej. la pieza no estaba), el mecánico cobra solo lo que sí hizo.
  Un ajuste solo puede **bajar** lo acordado (para subir está "cotizar algo
  adicional"); aprobado por el cliente, reemplaza a las cotizaciones
  aceptadas, y si no lo aprueba sigue lo de antes. Al tocar "Terminar" con
  refacciones a comprar cotizadas y sin ningún ticket, la app pregunta "¿Hiciste
  la reparación completa?". No se puede terminar con un ajuste pendiente
  (`ADJUSTMENT_PENDING`).
- **Pieza pedida** (`parts_receipts.ordered`): si la pieza llega otro día, el
  mecánico sube el ticket del pedido como "Pedida" y el cliente la paga hoy,
  con la misma doble confirmación del cobro (así el mecánico no arriesga su
  dinero en una pieza que nadie recoja).
- **Visita de regreso** (`src/returnVisits.ts`, `parent_request_id`): el
  mecánico la programa desde el servicio de hoy ("La pieza llega otro día:
  programar regreso", con cuándo y qué falta). Queda como una solicitud nueva
  con el mismo cliente, auto y dirección, asignada a él y **sin cobro de
  visita** (`visit_fee = 0`); ahí cotiza lo que falta. Hoy se cobra solo lo que
  hizo (ajuste) y las refacciones con ticket.

### Cancelaciones (`src/cancellations.ts`)

El cargo por cancelar depende de cuándo aceptó, salió y llegó el mecánico
(`accepted_at`, `en_route_at`, `arrived_at`) y se le paga directo a él con el
mismo cobro de doble confirmación (`cancellation_fee`; `amountDueForRequest`
devuelve solo ese cargo en una solicitud cancelada).

- **Cliente cancela** (`GET /cancellation-quote` le dice cuánto cuesta y por
  qué antes de confirmar; `POST /cancel` con `acceptedFee`, y si cambió
  mientras decidía se le vuelve a preguntar): gratis si el mecánico no ha
  salido, hasta 5 min después de salir o si va tarde (más de 60 min sin
  llegar desde que salió, o sin salir desde que aceptó); **mitad de la
  visita** si va en camino; **visita completa** si ya llegó, más las
  refacciones que ya compró con ticket aceptado. Ya reparando no se cancela
  desde la app (`CANCEL_NOT_ALLOWED`): el mecánico cobra solo lo que hizo
  (ajuste) y termina. La regla se muestra antes de pedir.
- **Cliente ausente** (`POST /customer-absent`): a los 10 min de "Ya llegué"
  se le avisa al cliente (`sweepArrivalReminders`, una vez); a los 15 el
  mecánico puede marcar "El cliente no está" con foto del lugar
  (`absence_photo_url`) y su ubicación, que debe estar a menos de 300 m de la
  dirección si la solicitud tiene coordenadas. Se cobra la visita; el cliente
  puede decir "Yo sí estaba" y se abre una disputa.
- **"Ya no puedo ir"** (`POST /withdraw`): el mecánico suelta el servicio
  antes de llegar; el cliente no paga nada. Si era automática se busca a otro
  mecánico; si el cliente lo eligió, se le avisa. Queda en su historial
  (`mechanic_withdrawals`; suspensión si pasa seguido). En una visita de
  regreso no se puede: tiene la pieza que el cliente ya pagó.

### Citas y visitas de regreso "próximas"

Una cita de la agenda o una visita de regreso que todavía no empieza (sigue
`assigned`) es **próxima**, no un trabajo en curso (`upcomingSql` en el
servidor, `isUpcoming` en la app): no le impide al mecánico recibir trabajo
hoy (antes, aceptar una cita para otro día lo dejaba ocupado desde ese
momento), no bloquea al cliente para pedir otro servicio y no activa el
seguimiento de ubicación. En Inicio aparece en "Próxima visita"; el mecánico
sale hacia ella con "Salir hacia esta visita" y ahí queda ocupado.

Las cotizaciones anteriores a los tickets (`parts_on_hand_amount` NULL)
cobran `parts_amount` fijo, como antes. El detalle de la solicitud trae
`amountDue` calculado en el servidor para que la app muestre exactamente lo
que se cobra.

Un admin resuelve el desacuerdo con la evidencia: la cotización aceptada,
las confirmaciones con fecha, el chat y el comprobante de transferencia. Las
disputas guardan quién las abrió (`opened_by`: cliente, mecánico o sistema).
Las tarjetas de cierre se quitan de Inicio a los 3 días, salvo un reporte de
falta de pago, que se queda hasta resolverse.

## Modelo de apartado + ajuste (descartado, historial)

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

El perfil `preview` genera un APK que apunta al servidor de Render;
`production` genera el AAB para Play Store y sube solo el `versionCode`
(`appVersionSource: remote` en `eas.json`).

**Actualizaciones sin reinstalar (EAS Update, gratis hasta 1,000 usuarios al
mes).** Mientras la app se instala a mano, los APK del perfil `preview`
escuchan el canal `preview`:

```bash
npx eas-cli update --channel preview --message "Qué cambió"
```

La app busca versiones nuevas al abrirse y al volver a ella; si hay, la
descarga y muestra "Hay una versión nueva de Mecanifique. Toca para
actualizar" (si no se toca, se aplica la siguiente vez que se abra). Fuera de
desarrollo la app usa siempre `https://mecanifique.onrender.com`, porque una
actualización no trae las variables del build. `runtimeVersion` sigue a
`version` de `app.json`: si un cambio agrega un módulo nativo o un permiso,
hay que subir `version` (1.0.1, 1.0.2…) y compilar un APK nuevo; los APK
viejos no reciben actualizaciones de otro runtime.

**Notificaciones push (Firebase Cloud Messaging).** Desde el SDK 53, Expo Go
ya no recibe avisos push en Android: se prueban con el APK. Se necesitan dos
piezas del proyecto de Firebase `mecanifique-a9018`:

- `mobile/google-services.json` (registrado en `app.json` como
  `android.googleServicesFile`). No es secreto: va dentro del APK.
- La clave de cuenta de servicio (FCM V1), subida **solo** a expo.dev →
  Credentials → Android. Nunca va en el repositorio.

Cada teléfono queda registrado en `push_tokens` al iniciar sesión. Para una
prueba manual, copia su `ExponentPushToken[...]` y mándale un aviso desde
https://expo.dev/notifications con la app en segundo plano.

**Probar como mecánico sin pasar por Didit** (solo cuentas de prueba): en la
consola SQL de Turso marca la identidad como aprobada **antes** de activar el
modo profesional, y el perfil de mecánico nacerá activo:

```sql
INSERT INTO identity_verifications (user_id, role, status, consent_at, reviewed_at, reviewer_note)
VALUES (<id del usuario>, 'customer', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Activación manual de prueba')
ON CONFLICT(user_id) DO UPDATE SET status = 'approved', updated_at = CURRENT_TIMESTAMP;
```

## Configuración de Facebook Login

App de Meta en developers.facebook.com (caso de uso "Autenticar y solicitar
datos a usuarios con Inicio de sesión con Facebook", permisos `email` y
`public_profile`). En **Configuración → Básica** van la URL del Aviso de
privacidad, la de Términos y la de eliminación de datos
(`https://mecanifique.vercel.app/eliminar-cuenta`).

En Supabase, **Authentication → Sign In / Providers → Facebook**:

- **Facebook client ID:** el "Identificador de la app" de Meta (no es secreto).
- **Facebook secret:** la "Clave secreta de la app" (solo aquí, nunca en el repo).

La **Callback URL** que muestra Supabase
(`https://<project-ref>.supabase.co/auth/v1/callback`) va en Meta, en
"URI de redireccionamiento de OAuth válidos". En Supabase, **URL
Configuration → Redirect URLs**, debe estar `mecanifique://**` (y `exp://**`
para Expo Go). Mientras la app de Meta esté "En desarrollo" solo entran las
cuentas con rol en la app; para que entre cualquiera, pasarla a "Activa".

## Configuración de Google OAuth (desactivado por ahora)

El botón y la ruta se quitaron. Para volver a activarlo hay que restaurar
`handleGoogleLogin` en `mobile/App.tsx`, el botón de `LoginScreen` y
`GET /auth/v2/google` (están en el historial de git), además de lo siguiente.
La pantalla de consentimiento de Google Cloud debe estar "En producción", no en
"Testing", o solo entran los correos de prueba.

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
