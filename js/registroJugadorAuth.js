// js/registroJugadorAuth.js
// Conecta el formulario de registro de jugador con Firebase Auth + Firestore.

import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
// ✅ Siempre arriba (antes de usarla)

const TERMS_VERSION = "v1.0";
const TERMS_DATE = "2026-01-13";
const TERMS_META = { version: TERMS_VERSION, date: TERMS_DATE };


// opcional, para mostrar/guardar versión por fecha


console.log("✅ registroJugadorAuth.js cargó");
console.log("🔎 Firebase projectId:", auth.app.options.projectId);
console.log("🔎 Firebase authDomain:", auth.app.options.authDomain);

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form-registro");
  const mensaje = document.getElementById("mensaje");

  if (!form) {
    console.warn("⚠️ No encontré #form-registro en esta página.");
    return;
  }

  function setMensaje(texto, tipo = "error") {
    if (!mensaje) return;
    mensaje.textContent = texto;
    mensaje.style.color = tipo === "ok" ? "#16a34a" : "#dc2626";
  }

function openLegalModal() {
  const overlay = document.getElementById("overlay-legal");
  const chk = document.getElementById("legal-accept");
  const btnContinue = document.getElementById("btn-legal-continue");
  const btnCancel = document.getElementById("btn-legal-cancel");
  const btnClose = document.getElementById("btn-legal-close");

  if (!overlay || !chk || !btnContinue || !btnCancel || !btnClose) {
    return Promise.resolve(true);
  }

  overlay.style.display = "grid";
  chk.checked = false;
  btnContinue.disabled = true;

  const cleanup = () => {
    overlay.style.display = "none";
    chk.removeEventListener("change", onChange);
    btnContinue.removeEventListener("click", onContinue);
    btnCancel.removeEventListener("click", onCancel);
    btnClose.removeEventListener("click", onCancel);
    overlay.removeEventListener("click", onOverlay);
    document.removeEventListener("keydown", onKey);
  };

  const onChange = () => { btnContinue.disabled = !chk.checked; };

  let resolveFn;
  const p = new Promise((resolve) => (resolveFn = resolve));

  const onContinue = () => {
    if (!chk.checked) return;
    cleanup();
    resolveFn(true);
  };

  const onCancel = () => {
    cleanup();
    resolveFn(false);
  };

  const onOverlay = (e) => {
    if (e.target === overlay) onCancel();
  };

  const onKey = (e) => {
    if (e.key === "Escape") onCancel();
  };

  chk.addEventListener("change", onChange);
  btnContinue.addEventListener("click", onContinue);
  btnCancel.addEventListener("click", onCancel);
  btnClose.addEventListener("click", onCancel);
  overlay.addEventListener("click", onOverlay);
  document.addEventListener("keydown", onKey);

  return p;
}


  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMensaje("");

    // ✅ IDs reales según tu HTML
    const nombres = document.getElementById("nombres")?.value.trim() || "";
    const apellidos = document.getElementById("apellidos")?.value.trim() || "";
    const genero = document.getElementById("dato-genero")?.value || "";
    const nacionalidad = document.getElementById("nacionalidad")?.value.trim() || "";
    const departamento = document.getElementById("departamento")?.value.trim() || "";
    const ciudad = document.getElementById("ciudad")?.value.trim() || "";
    const fechaNacimiento = document.getElementById("fecha_nacimiento")?.value || "";

    const posicion = document.getElementById("posicion")?.value || "";
    const altura = document.getElementById("altura")?.value || "";
    const peso = document.getElementById("peso")?.value || ""; // opcional
    const nivel = document.getElementById("nivel")?.value || "";
    const descripcionBreve = document.getElementById("descripcionBreve")?.value.trim() || "";



    const contactoReclutadores = document.getElementById("contacto_reclutadores")?.value.trim() || "";
    const institucion = document.getElementById("institucion")?.value.trim() || "";

    const inputEmail = form.querySelector('input[name="email"]');
    const inputPass = form.querySelector('input[name="password"]');
    const inputConfirm = form.querySelector('input[name="confirm"]');

    const email = (inputEmail?.value || "").trim().toLowerCase();
    const password = inputPass?.value || "";
    const confirm = inputConfirm?.value || "";

    // ✅ Validaciones (peso NO es obligatorio)
    if (
      !nombres ||
      !apellidos ||
      !genero ||
      !nacionalidad ||
      !departamento ||
      !ciudad ||
      !fechaNacimiento ||
      !posicion ||
      !altura ||
      !nivel ||
      !contactoReclutadores ||
      !email ||
      !password ||
      !confirm 
    ) {
      setMensaje("Por favor completa todos los campos obligatorios.");
      return;
    }

    if (password !== confirm) {
      setMensaje("Las contraseñas no coinciden.");
      return;
    }

    if (password.length < 6) {
      setMensaje("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    const btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) btn.disabled = true;

    setMensaje("Creando tu cuenta, por favor espera...", "ok");
    console.log("➡️ Submit detectado. Email:", email);

    try {
      // 1) Auth
      console.log("➡️ Creando usuario en Auth...");

      // ✅ Modal legal antes de crear la cuenta
const accepted = await openLegalModal();
if (!accepted) {
  setMensaje("Debes aceptar los términos y el tratamiento de datos para crear la cuenta.");
  if (btn) btn.disabled = false;   // ✅ para que no quede bloqueado
  return;
}


      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      await sendEmailVerification(cred.user);
      console.log("✅ Auth creado:", { uid, email: cred.user.email });

      // 2) users/{uid}
      console.log("➡️ Guardando users/{uid}...");
      await setDoc(doc(db, "users", uid), {
        uid,
        email,
        role: "player",
        legal: { accepted: true, version: TERMS_VERSION, acceptedAt: serverTimestamp() },
        contactEmail: contactoReclutadores,
        createdAt: serverTimestamp(),

      });
      console.log("✅ users/{uid} guardado");

      // 3) profiles/{uid}
      console.log("➡️ Guardando profiles/{uid}...");
      await setDoc(doc(db, "profiles", uid), {
        uid,
        type: "player",
        nombres,
        apellidos,
        genero,
        nacionalidad,
        departamento,
        ciudad,
        fechaNacimiento,
        posicion,
        alturaCm: Number(altura),
        pesoKg: peso ? Number(peso) : null, // ✅ opcional
        nivelActual: nivel,
        institucion,
        contactoReclutadores,
        emailContacto: email,
        descripcionBreve: descripcionBreve,
        legal: { accepted: true, version: TERMS_VERSION, acceptedAt: serverTimestamp() },

        createdAt: serverTimestamp(),
      });
      console.log("✅ profiles/{uid} guardado");

      // (Opcional) mantener compatibilidad con tu perfil actual si usa localStorage:
      localStorage.setItem(
        "perfilJugador",
        JSON.stringify({
          nombres,
          apellidos,
          nacionalidad,
          departamento,
          ciudad,
          fechaNacimiento,
          posicion,
          altura,
          peso,
          nivel,
          contactoReclutadores,
          institucion,
          email,
          uid,
        })
      );

      setMensaje("Cuenta creada correctamente. Redirigiendo...", "ok");




      // Redirige dentro de /html
      setMensaje("✅ Cuenta creada. Revisa tu correo para verificar y poder entrar.", "ok");
window.location.href = `verificaEmail.html?email=${encodeURIComponent(email)}`;
return;

    } catch (error) {
      console.error("❌ ERROR REGISTRO:", error);
      alert(`Firebase error:\n${error.code || "sin-code"}\n${error.message || error}`);

      let msg = "Ocurrió un error al crear la cuenta.";

      if (error.code === "auth/email-already-in-use") msg = "Este correo ya está registrado.";
      else if (error.code === "auth/invalid-email") msg = "El correo no tiene un formato válido.";
      else if (error.code === "auth/weak-password") msg = "La contraseña es demasiado débil.";
      else if (error.code === "auth/network-request-failed") msg = "Error de red (bloqueo/extensión/CORS).";
      else if (error.code === "auth/operation-not-allowed") msg = "Email/Password no está habilitado en ESTE proyecto.";
      else if (error.code === "permission-denied") msg = "Firestore bloqueó la escritura (rules).";

      setMensaje(msg);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
});
