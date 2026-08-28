# Mecanifique

Plataforma móvil para conectar clientes con mecánicos verificados, solicitar
servicios, seguir el avance y gestionar pagos.

## Estado actual

- Backend Node.js + TypeScript + Express desplegado en
  `https://mecanifique.onrender.com`.
- App Android con Expo.
- Autenticación Supabase por email y Google OAuth.
- Solicitudes inmediatas y programadas, disponibilidad de mecánicos, ubicación,
  dirección del servicio, chat básico, estados de avance y reseñas.
- Modo seguro del mapa cuando todavía no existe una clave de Google Maps.

## Ejecutar localmente

### Backend

```bash
npm install
npm run dev
```

El servidor usa `http://localhost:4000`. Copia `.env.example` a `.env` y
configura `SUPABASE_URL`, `SUPABASE_ANON_KEY` y los redirects.

Para validar:

```bash
npm run build
npm test
```

### App Android

```bash
cd mobile
npm install
npx expo start
```

Para crear un APK instalable:

```bash
npm install --global eas-cli
eas login
eas build --platform android --profile preview
```

La URL móvil de producción está definida en `mobile/eas.json`.

## Google OAuth

En Google Cloud crea un cliente OAuth de tipo **Web application**. En Supabase,
abre **Authentication → Providers → Google** y coloca:

- **Client IDs:** Client ID OAuth Web de Google.
- **Client Secret:** Client Secret del mismo cliente.
- **Skip nonce checks:** desactivado.
- **Allow users without an email:** desactivado.

En Google Cloud registra como URI de redirección la **Callback URL for OAuth**
que muestra Supabase (normalmente `https://<project-ref>.supabase.co/auth/v1/callback`).

En Supabase → **Authentication → URL Configuration → Redirect URLs** agrega:

```text
https://mecanifique.onrender.com/auth/callback
mecanifique://auth/callback
```

La app abre `GET /auth/v2/google`, recibe el token en el callback móvil y crea
o inicia la sesión del cliente.

## Pruebas de registro

El límite local de registros fue retirado para facilitar las pruebas. Supabase
puede seguir limitando el envío de correos. Para pruebas rápidas se puede
desactivar temporalmente **Confirm email** en **Authentication → Providers →
Email**. Para producción se debe configurar SMTP propio y conservar límites
antiabuso.

## Roadmap de seguridad y producto

Las siguientes iniciativas están registradas en el todo list de la sesión:

1. Verificación SMS obligatoria para clientes y mecánicos.
2. Verificación de identidad con INE y selfie para todos.
3. Para mecánicos: INE frontal/trasera, selfie con prueba de vida, carta de
   antecedentes no penales y comprobante de domicilio.
4. Estados de revisión, cifrado, retención limitada, consentimiento, auditoría
   y revisión humana. La IA solo debe asistir en la detección de inconsistencias,
   no aprobar automáticamente de forma irreversible.
5. Pagos con Stripe Connect u otro proveedor compatible con México: cobro del
   cliente, comisión, autorización, captura, reembolso y liquidación.
6. Refacciones con cotización, aprobación del cliente, adelanto o método
   controlado para el mecánico, ticket y conciliación.
7. Métodos de pago tokenizados para clientes y cuentas de cobro/CLABE mediante
   onboarding bancario del proveedor.
8. Saldo, comisiones, pagos fallidos y liquidaciones semanales para mecánicos.
9. Seguimiento GPS con consentimiento durante el servicio, incluyendo el viaje
   a la refaccionaria y el regreso; se detiene al cerrar la solicitud.
10. Información previa clara: vehículo, falla, fotos, dirección aproximada,
    identidad, calificación, especialidades y ETA.
11. Reseñas posteriores al servicio, promedios, cantidad de servicios,
    moderación y perfiles públicos.
12. Flujo accesible con botones grandes, pocos pasos, lenguaje sencillo y
    confirmaciones para personas mayores.
13. Perfiles de vehículos con marca, modelo, año, placas parcialmente ocultas y
    fotos para que ambas partes identifiquen correctamente el auto y la persona.

## Flujos previstos

### Cliente

Pedir ayuda → elegir vehículo → describir falla y subir fotos → confirmar
dirección → revisar mecánico y precio → autorizar pago → seguir servicio →
aprobar refacciones → calificar.

### Mecánico

Activarse → revisar solicitud y vehículo → aceptar → navegar → actualizar estado
→ cotizar/comprar refacción → completar trabajo → recibir liquidación.

## Seguridad y privacidad

Los documentos oficiales, selfies, teléfonos, métodos de pago y ubicaciones
requieren cifrado, acceso mínimo, registro de auditoría, consentimiento
explícito, política de privacidad y eliminación conforme a la legislación
aplicable. No se deben guardar números completos de tarjetas en Mecanifique.

## Documentación relacionada

- [Configuración de Supabase y Google OAuth](./SUPABASE_AUTH_SETUP.md)
- [Configuración de Render](./render.yaml)
- [Configuración EAS móvil](./mobile/eas.json)
