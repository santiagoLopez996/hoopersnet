// /js/miPerfil.js
// Redirige al perfil correcto según el rol guardado en Firestore.
// - users/{uid}.role = "player" | "recruiter"
// (Fallback) profiles/{uid}.type = "player" | "recruiter"

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function getRole(uid) {
  // 1) Intentar users/{uid}
  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    if (uSnap.exists()) {
      const role = (uSnap.data()?.role || "").toString().trim().toLowerCase();
      if (role) return role;
    }
  } catch (e) {
    console.warn("No se pudo leer users/{uid} (fallback a profiles):", e);
  }

  // 2) Fallback profiles/{uid}
  const pSnap = await getDoc(doc(db, "profiles", uid));
  if (pSnap.exists()) {
    const type = (pSnap.data()?.type || pSnap.data()?.role || "").toString().trim().toLowerCase();
    if (type) return type;
  }

  return "";
}

function go(url) {
  window.location.replace(url);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    go("/html/login.html");
    return;
  }

  try {
    const role = await getRole(user.uid);

    if (role === "recruiter") {
      go("/html/perfilReclutador.html");
      return;
    }

    // Default: player
    go("/html/perfilJugador.html");
  } catch (err) {
    console.error("Error resolviendo rol:", err);
    // En caso de error, manda al login (o al perfil jugador por defecto)
    go("/html/login.html");
  }
});
