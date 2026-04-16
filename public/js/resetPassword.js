import { auth } from "./firebase-init.js";

import {
  verifyPasswordResetCode,
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

document.addEventListener("DOMContentLoaded", async () => {
  const subtitle = document.getElementById("reset-subtitle");
  const form = document.getElementById("form-reset");
  const msg = document.getElementById("reset-msg");
  const actions = document.getElementById("reset-actions");
  const btn = document.getElementById("btn-confirm-reset");

  const setMsg = (text, ok = false) => {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = ok ? "#16a34a" : "#dc2626";
  };

  const setSubtitle = (text) => {
    if (subtitle) subtitle.textContent = text;
  };

  const setLoading = (loading) => {
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? "0.7" : "1";
    btn.style.pointerEvents = loading ? "none" : "auto";
  };

  // 1) Leer parámetros del link (vienen en el correo)
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  if (!oobCode || mode !== "resetPassword") {
    setSubtitle("Enlace inválido.");
    if (actions) {
      actions.innerHTML = `<a class="auth-link" href="login.html">Volver al login</a>`;
    }
    return;
  }

  // 2) Verificar el oobCode y obtener el email (confirmación real)
  let email = "";
  try {
    email = await verifyPasswordResetCode(auth, oobCode);
    setSubtitle(`Cuenta: ${email}`);
    if (form) form.style.display = "block";
  } catch (err) {
    console.error(err);

    let t = "El enlace es inválido o ya fue usado.";
    if (err.code === "auth/expired-action-code") t = "El enlace expiró. Vuelve a pedir otro.";
    if (err.code === "auth/invalid-action-code") t = "El enlace no es válido o ya fue usado.";

    setSubtitle(t);
    if (actions) {
      actions.innerHTML = `<a class="auth-link" href="login.html">Volver al login</a>`;
    }
    return;
  }

  // 3) Cambiar contraseña
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    const p1 = document.getElementById("newPassword")?.value || "";
    const p2 = document.getElementById("confirmPassword")?.value || "";

    // Validaciones básicas
    if (p1.length < 8) {
      setMsg("La contraseña debe tener al menos 8 caracteres.");
      setLoading(false);
      return;
    }
    if (p1 !== p2) {
      setMsg("Las contraseñas no coinciden.");
      setLoading(false);
      return;
    }

    try {
      await confirmPasswordReset(auth, oobCode, p1);

      setMsg("Contraseña actualizada ✅ Ya puedes iniciar sesión.", true);
      setSubtitle(`Listo para ${email}`);

      // Oculta el form y muestra acción
      form.style.display = "none";
      if (actions) {
        actions.innerHTML = `<a class="auth-link" href="login.html">Ir a iniciar sesión</a>`;
      }
    } catch (err) {
      console.error(err);
      let t = "No se pudo cambiar la contraseña. Intenta de nuevo.";
      if (err.code === "auth/weak-password") t = "Contraseña muy débil. Usa una más fuerte.";
      if (err.code === "auth/expired-action-code") t = "El enlace expiró. Vuelve a pedir otro.";
      if (err.code === "auth/invalid-action-code") t = "El enlace ya fue usado o no es válido.";
      setMsg(t);
    } finally {
      setLoading(false);
    }
  });
});
