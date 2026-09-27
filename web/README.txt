MECANIFIQUE — SITIO WEB (mecanifique.vercel.app)

Vive en la carpeta web/ del repositorio de la app. Vercel está conectado al
repo y publica solo esta carpeta (ver vercel.json en la raíz del repo): cada
push a main actualiza el sitio. No hace falta subir archivos a mano.

Sitio estático, en español por defecto (con inglés opcional, que se recuerda
en el navegador). Pensado primero para clientes y mecánicos, con una sección
completa para inversionistas al final.

Páginas:
- index.html      Inicio: clientes (cómo funciona, confianza, la app),
                  mecánicos, lista de espera e inversionistas.
- privacidad.html Aviso de privacidad (enlace que pide Google Play).
                  Con vercel.json, también responde en /privacidad.

Lista de espera:
- El formulario envía a https://mecanifique.onrender.com/lista-de-espera
  (servidor de la app). El servidor guarda el registro y regresa aquí con
  ?registro=ok o ?registro=error, que la página muestra como mensaje.
- Publica primero el servidor con esa ruta y después este sitio; si no, el
  formulario llevaría a "Ruta no encontrada".

Otros archivos:
- robots.txt, sitemap.xml: para que Google encuentre el sitio.
- vercel.json: direcciones sin ".html" (/privacidad).
- script.js: traducciones (es/en), idioma recordado y lógica del formulario.

Pendiente antes del lanzamiento formal:
- Pedir a un abogado que revise el aviso de privacidad.
- Una imagen para compartir (1200 x 630 px) en assets/ y apuntar og:image a
  ella; hoy la vista previa usa el logo.
- Dominio propio y correo de contacto del proyecto.
