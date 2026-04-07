import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const correoEl = document.getElementById("correo");
const msgEl = document.getElementById("msg");
const btnResend = document.getElementById("btn-resend");
const btnCheck = document.getElementById("btn-check");
const btnLogout = document.getElementById("btn-logout");

const setMsg = (t, ok = false) => {
  if (!msgEl) return;
  msgEl.textContent = t;
  msgEl.style.color = ok ? "#16a34a" : "#dc2626";
};

async function redirectByRole(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  const role = snap.exists() ? (snap.data().role || null) : null;

  if (role === "player") window.location.href = "perfilJugador.html";
  else if (role === "recruiter") window.location.href = "explorarJugadores.html";
  else window.location.href = "login.html";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // si llega sin sesión, que vuelva al login
    window.location.href = "login.html";
    return;
  }

  if (correoEl) correoEl.textContent = user.email || "—";

  if (user.emailVerified) {
    await redirectByRole(user.uid);
    return;
  }

  setMsg("📩 Revisa tu correo y haz clic en el enlace de verificación.");
});

btnResend?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await sendEmailVerification(user);
    setMsg("Listo ✅ Te reenviamos el correo. Revisa spam.", true);
  } catch (e) {
    console.error(e);
    setMsg("No se pudo reenviar. Intenta en un minuto.");
  }
});

btnCheck?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  await user.reload();
  if (user.emailVerified) {
    await redirectByRole(user.uid);
  } else {
    setMsg("Aún no aparece verificado. Intenta en 10–20 segundos.");
  }
});

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});