// /js/perfilReclutadorAuth.js
import { requireAuth, doLogout } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", async () => {
  // Guard: si no hay sesión -> login
  await requireAuth("login.html");

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", () => {
    doLogout("login.html");
  });
});
