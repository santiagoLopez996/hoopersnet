// js/login.js
import { auth, db } from "./firebase-init.js";

import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form-login");
  const msg = document.getElementById("mensaje");
  const btnReset = document.getElementById("btn-reset");
  const btnLogin = document.getElementById("btn-login");

  const setMsg = (text, ok = false) => {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = ok ? "#16a34a" : "#dc2626";
  };

  const setLoading = (loading) => {
    if (!btnLogin) return;
    btnLogin.disabled = loading;
    btnLogin.style.opacity = loading ? "0.7" : "1";
    btnLogin.style.pointerEvents = loading ? "none" : "auto";
  };

// Reset password (con página propia)
// =======================
// Modal "Olvidé mi contraseña"
// =======================
const overlayReset = document.getElementById("overlay-reset");
const btnCerrarReset = document.getElementById("btn-cerrar-reset");
const formResetModal = document.getElementById("form-reset-modal");
const resetEmailInput = document.getElementById("resetEmail");
const resetModalMsg = document.getElementById("reset-modal-msg");
const btnEnviarReset = document.getElementById("btn-enviar-reset");

function openResetModal() {
  if (!overlayReset) return;
  overlayReset.style.display = "grid";
  if (resetModalMsg) resetModalMsg.textContent = "";
  if (resetEmailInput) {
    // si ya escribió email en el login, lo copiamos
    const mainEmail = (document.getElementById("email")?.value || "").trim().toLowerCase();
    resetEmailInput.value = mainEmail;
    resetEmailInput.focus();
  }
}

function closeResetModal() {
  if (!overlayReset) return;
  overlayReset.style.display = "none";
}

function setResetMsg(text, ok = false) {
  if (!resetModalMsg) return;
  resetModalMsg.textContent = text;
  resetModalMsg.style.color = ok ? "#16a34a" : "#dc2626";
}

btnReset?.addEventListener("click", () => {
  openResetModal();
});

btnCerrarReset?.addEventListener("click", closeResetModal);

// Cerrar si hace click fuera del modal
overlayReset?.addEventListener("click", (e) => {
  if (e.target === overlayReset) closeResetModal();
});

formResetModal?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = (resetEmailInput?.value || "").trim().toLowerCase();
  if (!email) {
    setResetMsg("Escribe tu correo.");
    return;
  }

  const actionCodeSettings = {
    url: "http://127.0.0.1:5500/html/resetPassword.html",
    handleCodeInApp: true,
  };

  try {
    btnEnviarReset.disabled = true;
    btnEnviarReset.style.opacity = "0.7";

    await sendPasswordResetEmail(auth, email, actionCodeSettings);

    // Mensaje neutro (seguridad)
    setResetMsg("Listo ✅ Si el correo está registrado, te llegará un enlace. Revisa spam.", true);

    // opcional: cerrar después de 1.2s
    setTimeout(closeResetModal, 1200);
  } catch (err) {
    console.error(err);
    setResetMsg("No se pudo enviar el correo. Intenta de nuevo.");
  } finally {
    btnEnviarReset.disabled = false;
    btnEnviarReset.style.opacity = "1";
  }
});



  // Login + redirect by role
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    const email = (document.getElementById("email")?.value || "")
      .trim()
      .toLowerCase();
    const password = document.getElementById("password")?.value || "";

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      // ✅ Bloqueo si no ha verificado email
if (!cred.user.emailVerified) {
  window.location.href = `verificaEmail.html?email=${encodeURIComponent(email)}`;
  setLoading(false);
  return;
}

      // Leer rol real desde users/{uid}
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);

      let role = null;

      if (userSnap.exists()) {
        role = userSnap.data().role || null;
      } else {
        // (Rescate) si existe profiles/{uid}, reconstruimos users/{uid}
        const profSnap = await getDoc(doc(db, "profiles", uid));
        if (profSnap.exists()) {
          const p = profSnap.data();
          role = p.type || "player";

          await setDoc(userRef, {
            uid,
            email,
            role,
            createdAt: serverTimestamp(),
          });
        }
      }

      if (!role) {
        setMsg("Tu cuenta no tiene rol asignado. Vuelve al inicio y crea tu cuenta.");
        setLoading(false);
        return;
      }

      // Redirección según rol (ajusta si quieres otra página)
      if (role === "player") {
        window.location.href = "perfilJugador.html";
      } else if (role === "recruiter") {
        // Puedes cambiar a perfilReclutador.html si prefieres
        window.location.href = "explorarJugadores.html";
      } else {
        setMsg("Tu rol no está habilitado aún.");
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      let t = "Correo o contraseña incorrectos.";
      if (err.code === "auth/wrong-password") t = "Contraseña incorrecta.";
      else if (err.code === "auth/user-not-found") t = "No existe una cuenta con ese correo.";
      else if (err.code === "auth/invalid-email") t = "Correo inválido.";
      else if (err.code === "auth/too-many-requests") t = "Demasiados intentos. Intenta más tarde.";

      setMsg(t);
      setLoading(false);
    }
  });
});
