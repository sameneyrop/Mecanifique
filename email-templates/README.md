# Correos de Supabase con la marca de Mecanifique

Plantillas para Supabase → Authentication → Emails → Templates. En cada una se
pega el asunto y el HTML completo del archivo.

| Plantilla en Supabase | Asunto | Archivo |
| --- | --- | --- |
| Confirm signup | Confirma tu correo de Mecanifique | `confirmar-correo.html` |
| Reset password | Crea una nueva contraseña de Mecanifique | `nueva-contrasena.html` |
| Change email address | Confirma tu nuevo correo de Mecanifique | `cambiar-correo.html` |

- `{{ .ConfirmationURL }}` y `{{ .NewEmail }}` los reemplaza Supabase; no se
  tocan.
- Estilos en línea y tablas: así se ven bien en Gmail, Outlook y Apple Mail.
  Los clientes de correo no cargan la fuente de la app, así que cae en la del
  sistema.
- El logo se carga del sitio (`mecanifique.vercel.app/assets/`); si cambia de
  ruta, hay que actualizarlo aquí.
- La confirmación regresa a `https://mecanifique.onrender.com/auth/callback`
  y la nueva contraseña a `/restablecer-contrasena`: las dos deben estar en
  Authentication → URL Configuration → Redirect URLs.
