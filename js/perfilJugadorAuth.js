// js/perfilJugadorAuth.js
import { watchAuth, requireAuth, doLogout } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", async () => {
  const btnLogout = document.getElementById("btn-logout");

  // Si viene ?uid=... permitimos ver sin sesión (perfil público)
  const uidParam = new URLSearchParams(window.location.search).get("uid");

  // 1) Si NO hay uidParam, entonces es "mi perfil" => requiere sesión
  if (!uidParam) {
    await requireAuth("login.html");
  }

  // 2) Mostrar/ocultar botón logout dependiendo de si hay sesión
  watchAuth((user) => {
    if (!btnLogout) return;
    btnLogout.style.display = user ? "" : "none";
  });

  // 3) Logout
  btnLogout?.addEventListener("click", () => {
    doLogout("login.html");
  });
});
