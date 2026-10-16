# Mecanifique en Google Play

Todo lo que pide Play Console, listo para copiar. Cuenta **personal**: antes
de publicar hay que hacer una prueba cerrada con al menos 12 testers durante
14 días seguidos (conviene juntar 15 a 20).

| Pieza | Estado |
|---|---|
| AAB para Play (`eas build -p android --profile production`) | Compilado en EAS, `versionCode` 2, misma firma que los APK |
| Canal de actualizaciones | `production` → rama `preview`: el mismo `eas update --channel preview` llega a los APK y a Play |
| Permisos que no se usan | Bloqueados en `app.json` (lectura de almacenamiento, ventana flotante, micrófono). La escritura se declara solo hasta Android 9 (`plugins/withLegacyCameraStorage.js`): ahí la cámara la necesita |
| Cuenta del revisor sin SMS | `PHONE_VERIFICATION_EXEMPT_EMAILS` en Render |
| Ícono 512 × 512 | `icono-512.png` |
| Gráfico destacado 1024 × 500 | `grafico-destacado-1024x500.png` (fuente: `grafico-destacado.html`) |
| Capturas del teléfono | `capturas/` (6, 1080 × 1920): salen de `capturas-originales/` con `capturas.html?n=1…6` |
| Video del servicio en primer plano | **Falta**: se graba en el emulador |

## 1. Crear la app

Play Console → **Crear app**:

- Nombre: **Mecanifique**
- Idioma predeterminado: **Español (Latinoamérica) – es-419**
- App o juego: **App**
- Gratis o pagada: **Gratis** (no se puede cambiar después a pagada)
- Acepta las declaraciones de las Políticas para Desarrolladores y de las
  leyes de exportación de EE. UU.

## 2. Ficha de Play Store

**Nombre** (11 de 30): `Mecanifique`

**Descripción breve** (75 de 80):

```
Un mecánico verificado va hasta tu auto. Ves quién es y cuánto cobra antes.
```

**Descripción completa:**

```
¿Se descompuso tu auto o tu moto? Con Mecanifique pides un mecánico desde tu celular y va hasta donde está tu vehículo: tu casa, tu trabajo o la calle. Sin grúa y sin llevarlo al taller.

CÓMO FUNCIONA
• Cuenta qué le pasa y dónde está. Pídelo para ahora mismo o agenda una fecha.
• Un mecánico cercano acepta. Ves su foto, sus calificaciones y cuánto cobra la visita antes de que llegue.
• Lo sigues en el mapa mientras va en camino.
• Te dice qué tiene tu vehículo y cuánto cuesta. Nada se repara sin que lo apruebes.
• Le pagas directo al mecánico y lo calificas.

CONFIANZA
• Mecánicos con identidad verificada.
• Calificaciones de clientes reales.
• Precio aprobado antes de reparar y ticket de las refacciones.
• Botón de emergencia que llama al 911 durante el servicio.

¿VAS A COMPRAR UN AUTO USADO?
Pide una revisión antes de pagar: el mecánico va a donde esté el auto.

PARA MECÁNICOS
Recibe solicitudes de clientes cerca de ti, decide cuáles aceptas y arma tu perfil público con tus reseñas. Te avisamos cuando alguien busca mecánico cerca, aunque no estés conectado. Mecanifique cobra una comisión del 10 % por servicio terminado, y los primeros 30 días desde tu primer servicio no pagas comisión.

Por ahora Mecanifique funciona en Aguascalientes.
```

**Gráficos:**

- Ícono: `icono-512.png`
- Gráfico destacado: `grafico-destacado-1024x500.png`
- Capturas del teléfono: las 6 de `capturas/`, en este orden: inicio, nueva
  solicitud, dónde está el auto, buscando mecánico, mecánico conectado y
  zona del mecánico. Se tomaron en el emulador con cuentas de prueba y el GPS
  en Querétaro (para no avisarle a mecánicos reales), por eso dos dicen
  Querétaro. Pendiente mejorarlas con un servicio en camino y una cotización.

**Categoría:** Aplicación → **Automóviles y vehículos**. Etiquetas: elige
de la lista de Play las que hablen de servicios para autos.

**Datos de contacto:**

- Correo: el mismo del sitio (el de `web/privacidad.html`)
- Sitio web: `https://mecanifique.vercel.app`
- Teléfono: opcional; mejor no ponerlo

## 3. Contenido de la app (Política → Contenido de la app)

**Política de privacidad:** `https://mecanifique.vercel.app/privacidad`

**Acceso a la app → Todas o algunas funciones están restringidas.** Antes:

1. Crea en la app una cuenta de **cliente** solo para revisores, con un
   Gmail nuevo (por ejemplo, uno de «revisión»). Créala tú; no la compartas
   por chat.
2. En Render → Environment agrega `PHONE_VERIFICATION_EXEMPT_EMAILS` con ese
   correo. Así no le pide el código por SMS en el teléfono del revisor.
3. En Play Console pon el correo, la contraseña y estas instrucciones:

```
La app necesita una cuenta. Esta cuenta de cliente no pide código por SMS. Puede buscar mecánicos, ver sus perfiles y crear una solicitud de prueba. Los mecánicos están en Aguascalientes, México: desde otra ubicación la solicitud se queda esperando mecánico, y eso es normal.
```

**Anuncios:** No, la app no contiene anuncios.

**ID de publicidad:** No (la app no pide `AD_ID`).

**Clasificación del contenido** (cuestionario IARC):

- Categoría: **Utilidad, productividad, comunicación u otra**
- Violencia, sexo, lenguaje, drogas, apuestas: **No** a todo
- ¿Los usuarios pueden interactuar o intercambiar contenido?: **Sí** (chat
  de la solicitud, reseñas, comunidad)
- ¿Comparte la ubicación física del usuario con otros usuarios?: **Sí** (el
  cliente ve dónde va su mecánico; el mecánico ve dónde está el auto)
- ¿Se pueden comprar bienes digitales?: **No**

**Público objetivo:** **18 años o más** (solo esa casilla).

**Apps de noticias, de gobierno, de salud:** No.

**Funciones financieras:** «Mi app no ofrece funciones financieras». La
comisión se cobra con Stripe fuera de Google Play y la CLABE para propinas
solo se le muestra al cliente.

**Seguridad de los datos:**

- ¿Recopila datos?: **Sí**. ¿Cifrados en tránsito?: **Sí** (HTTPS).
- ¿Pueden pedir que se borren?: **Sí**. Desde la app (Cuenta → Eliminar
  cuenta) y en `https://mecanifique.vercel.app/eliminar-cuenta`.
- ¿Comparte datos con terceros?: **No**. Los proveedores que procesan por
  cuenta de Mecanifique (Supabase, Turso, Render, Twilio, Expo, Firebase,
  Stripe, Didit) no cuentan como «compartir», ni lo que un usuario le
  manda a otro dentro del servicio.

| Tipo de dato | Para qué | ¿Obligatorio? |
|---|---|---|
| Ubicación precisa y aproximada | Funcionalidad: mecánicos cercanos, seguimiento en vivo | Sí |
| Nombre, correo, teléfono | Funcionalidad, administración de la cuenta, prevención de fraude | Sí |
| Dirección (dónde está el vehículo) | Funcionalidad | Sí |
| Otra información financiera (CLABE del mecánico para propinas) | Funcionalidad | No |
| Historial de compras (cobros de cada servicio) | Funcionalidad | Sí |
| Fotos (perfil, evidencia del trabajo, tickets) | Funcionalidad | Sí (la foto de perfil, para mecánicos) |
| Otros mensajes en la app (chat de la solicitud) | Funcionalidad | No |
| Otro contenido generado por el usuario (reseñas, comunidad, promociones) | Funcionalidad | No |
| ID del dispositivo y otros identificadores (identificador del teléfono, token de avisos) | Funcionalidad, prevención de fraude y seguridad | Sí |

La identificación oficial y la selfie de la verificación las recibe Didit en
el navegador; la app solo guarda si quedó aprobada. La huella en el teléfono
la revisa el propio teléfono.

**Permisos de servicio en primer plano → Ubicación.** Texto:

```
Solo para mecánicos, y siempre iniciado por ellos con la app en pantalla, con una notificación fija visible:
1) Conectado para recibir solicitudes: al tocar «Conectarme», la app manda la ubicación del mecánico una vez por minuto para asignarle las solicitudes de clientes cercanos, aunque cambie de app (como las apps para conductores). Se apaga al tocar «Desconectarme» o al cerrar la app.
2) Seguimiento en vivo: cuando va hacia el vehículo del cliente o por refacciones, la app comparte su ubicación con ese cliente cada pocos segundos, aunque use el navegador para llegar. Se apaga al marcar «Ya llegué» o al retomar la reparación.
La app no pide ubicación en segundo plano («permitir siempre»).
```

Pide un **video** que muestre las dos funciones (enlace de YouTube «no
listado» o Drive). Pendiente: se graba en el emulador con una cuenta de
mecánico y una de cliente de prueba.

## 4. Firma de la app (al subir el primer AAB)

Play Console pregunta qué clave usar para firmar la app. Recomendación:
**usar la misma clave de los APK** (la que guarda EAS). Así quien instaló el
APK del volante puede pasarse a la versión de Play sin desinstalar, y no se
pierden las actualizaciones.

1. En tu terminal (no aquí): `cd mobile` y `npx eas-cli credentials`
   → Android → production → Keystore → **Download existing keystore**. Te
   da un `.jks` y sus contraseñas: guárdalos tú, **nunca** en el repositorio
   ni en un chat.
2. En Play Console, al crear la versión: **Elegir clave de firma** →
   **Exportar y subir una clave de un almacén de claves Java**. Descarga el
   `pepk.jar` y la clave de cifrado que te da.
3. Corre el comando que muestra la página (lleva tu `.jks`, el alias y
   `--rsa-aes-encryption`); te pide las contraseñas y crea un `.zip`. Java
   viene con Android Studio (`jbr\bin\java.exe`).
4. Sube el `.zip`.

Si prefieres que Google genere una clave nueva: es más sencillo, pero quien
tenga el APK tendrá que desinstalarlo antes de instalar desde Play.

## 5. Prueba cerrada

1. **Prueba → Prueba cerrada → Crear pista.** Testers: crea una lista con
   los Gmail (15 a 20). Países: México.
2. **Crear versión:** sube el AAB (descárgalo de la página del build en
   expo.dev). Nombre: `1.0.2 (2)`. Notas: «Primera versión de prueba».
3. **Enviar a revisión.** La prueba cerrada también la revisa Google: de
   horas a varios días.
4. Al aprobarse, copia el **enlace para unirse** y mándalo. Cada tester
   abre el enlace, toca «Ser tester» y luego instala desde Play.
5. Desde que haya 12 testers dentro, cuenta 14 días sin que bajen de 12.
   Luego Panel → **Solicitar acceso a producción**.

Las actualizaciones de JavaScript siguen saliendo con
`npx eas-cli update --channel preview` y llegan también a la versión de Play.
Un cambio nativo necesita un AAB nuevo (`versionCode` sube solo).
