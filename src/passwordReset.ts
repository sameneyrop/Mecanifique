/**
 * "¿Olvidaste tu contraseña?": la app pide el enlace (POST
 * /auth/v2/forgot-password), Supabase lo manda por correo y el enlace abre
 * /restablecer-contrasena en este servidor, donde la persona escribe la nueva
 * (POST /auth/v2/reset-password). La respuesta al pedir el enlace es siempre
 * la misma, exista o no la cuenta, para no revelar qué correos están
 * registrados.
 */

export const FORGOT_PASSWORD_MESSAGE =
  "Si hay una cuenta con ese correo, te mandamos un enlace para crear una nueva contraseña. Revisa también tu correo no deseado.";

export const RESEND_CONFIRMATION_MESSAGE =
  "Si tu cuenta está pendiente de confirmar, te mandamos otro correo. Revisa también tu correo no deseado.";

// El mismo logo que los correos (email-templates/).
const LOGO =
  '<img src="https://mecanifique.vercel.app/assets/mecanifique-logo-blue.png" alt="Mecanifique" width="170" style="display:block;height:auto">';

/**
 * A donde regresa el enlace del correo de confirmación (y el de cambio de
 * correo). Supabase manda el resultado en el hash: si trae error, el enlace
 * venció o ya se usó.
 */
export function emailConfirmedPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Correo confirmado · Mecanifique</title>
<style>
  body { margin: 0; background: #E3ECF8; color: #0b0f22; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  .card { background: #fff; border-radius: 20px; padding: 24px 20px; margin-top: 20px; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { font-size: 16px; line-height: 1.55; color: #4A5568; margin: 0; }
  .check { width: 56px; height: 56px; border-radius: 28px; background: #E3F4EA; color: #1a7f4b; font-size: 30px; font-weight: 800; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
  [hidden] { display: none !important; }
</style>
</head>
<body><main>
${LOGO}
<div class="card" id="ok">
  <div class="check" aria-hidden="true">✓</div>
  <h1>¡Listo, confirmaste tu correo!</h1>
  <p>Regresa a la app Mecanifique e inicia sesión con tu correo y tu contraseña.</p>
</div>
<div class="card" id="expired" hidden>
  <h1>Este enlace ya no sirve</h1>
  <p>Vence después de un rato o ya se usó. Abre la app, toca «Iniciar sesión» y luego «¿No te llegó el correo de confirmación?» para pedir otro.</p>
</div>
<script>
  (function () {
    var params = new URLSearchParams(location.hash.slice(1));
    if (params.get("error") || params.get("error_code")) {
      document.getElementById("ok").hidden = true;
      document.getElementById("expired").hidden = false;
    }
    // La sesión que trae el enlace no se usa aquí: no se deja en la dirección.
    if (location.hash) history.replaceState(null, "", location.pathname);
  })();
</script>
</main></body>
</html>`;
}

export function resetPasswordPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nueva contraseña · Mecanifique</title>
<style>
  body { margin: 0; background: #E3ECF8; color: #0b0f22; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  .card { background: #fff; border-radius: 20px; padding: 20px; margin-top: 16px; }
  h1 { font-size: 24px; margin: 16px 0 8px; }
  p { font-size: 16px; line-height: 1.5; color: #4A5568; }
  label { display: block; font-weight: 700; margin: 12px 0 6px; }
  input { width: 100%; box-sizing: border-box; font-size: 16px; padding: 12px; border: 1px solid #D6E4F5; border-radius: 12px; background: #EEF3FA; }
  button { width: 100%; margin-top: 16px; padding: 14px; font-size: 16px; font-weight: 800; color: #fff; background: #2F8FEA; border: 0; border-radius: 999px; }
  button:disabled { opacity: .6; }
  .error { color: #b42318; font-weight: 600; }
  [hidden] { display: none !important; }
</style>
</head>
<body><main>
${LOGO}
<h1>Crea una nueva contraseña</h1>
<div class="card" id="form-card">
  <form id="form">
    <label for="password">Nueva contraseña (mínimo 8 caracteres, con letras y números)</label>
    <input id="password" type="password" minlength="8" autocomplete="new-password" required>
    <label for="confirm">Escríbela otra vez</label>
    <input id="confirm" type="password" minlength="8" autocomplete="new-password" required>
    <p class="error" id="error" hidden></p>
    <button id="submit" type="submit">Guardar contraseña</button>
  </form>
</div>
<div class="card" id="done" hidden>
  <p><strong>Listo.</strong> Regresa a la app Mecanifique e inicia sesión con tu nueva contraseña.</p>
</div>
<div class="card" id="expired" hidden>
  <p>Este enlace ya no sirve (vence después de un rato o ya se usó). Pide otro desde la app, en «¿Olvidaste tu contraseña?».</p>
</div>
<script>
  (function () {
    var params = new URLSearchParams(location.hash.slice(1));
    var token = params.get("access_token");
    var show = function (id) {
      ["form-card", "done", "expired"].forEach(function (card) { document.getElementById(card).hidden = card !== id; });
    };
    if (!token || params.get("error")) { show("expired"); return; }
    history.replaceState(null, "", location.pathname);
    var error = document.getElementById("error");
    document.getElementById("form").addEventListener("submit", function (event) {
      event.preventDefault();
      var password = document.getElementById("password").value;
      if (password.length < 8 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(password) || !/\\d/.test(password)) { error.textContent = "Usa al menos 8 caracteres, con letras y números."; error.hidden = false; return; }
      if (password !== document.getElementById("confirm").value) { error.textContent = "Las dos contraseñas no coinciden."; error.hidden = false; return; }
      var button = document.getElementById("submit");
      button.disabled = true;
      error.hidden = true;
      fetch("/auth/v2/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, password: password })
      }).then(function (response) {
        return response.json().then(function (body) {
          if (response.ok) { show("done"); return; }
          if (response.status === 401) { show("expired"); return; }
          error.textContent = body.error || "No se pudo guardar. Intenta de nuevo.";
          error.hidden = false;
          button.disabled = false;
        });
      }).catch(function () {
        error.textContent = "Sin conexión. Intenta de nuevo.";
        error.hidden = false;
        button.disabled = false;
      });
    });
  })();
</script>
</main></body>
</html>`;
}
