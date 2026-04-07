// js/feedAuth.js
import { requireAuth, doLogout } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", async () => {
  // 1) Guard: si no hay sesión -> login
  await requireAuth("login.html");

  // 2) Logout
  document.getElementById("btn-logout")?.addEventListener("click", () => {
    doLogout("login.html");
  });
});
