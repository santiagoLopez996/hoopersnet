// js/auth-guard.js
import { auth } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

/**
 * Si no hay sesión -> redirige a login.html
 * Retorna una promesa que resuelve cuando ya sabemos si hay user o no
 */
export function requireAuth(redirectTo = "login.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = redirectTo;
        return;
      }
      resolve(user);
    });
  });
}

/**
 * Te deja escuchar el user (sirve para mostrar/ocultar botones)
 */
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Cierra sesión y redirige
 */
export async function doLogout(redirectTo = "login.html") {
  await signOut(auth);
  window.location.href = redirectTo;
}
