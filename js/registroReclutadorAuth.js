// /js/registroReclutadorAuth.js
console.log("✅ registroReclutadorAuth.js cargó");

import { auth, db } from "./firebase-init.js";

import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const TERMS_VERSION = "v1.0-2026-01-13";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form-reclutador");
  const mensaje = document.getElementById("mensaje");

  if (!form) {
    console.warn("⚠️ No existe #form-reclutador en registroReclutador.html");
    return;
  }

  const setMensaje = (text, ok = false) => {
    if (!mensaje) return;
    mensaje.textContent = text;
    mensaje.style.color = ok ? "#16a34a" : "#dc2626";
  };

  function openLegalModal() {
    const overlay = document.getElementById("overlay-legal");
    const chk = document.getElementById("legal-accept");
    const btnContinue = document.getElementById("btn-legal-continue");
    const btnCancel = document.getElementById("btn-legal-cancel");
    const btnClose = document.getElementById("btn-legal-close");

    // Si falta el modal (por cualquier razón), no bloquees el registro
    if (!overlay || !chk || !btnContinue || !btnCancel || !btnClose) {
      return Promise.resolve(true);
    }

    overlay.style.display = "grid";
    chk.checked = false;
    btnContinue.disabled = true;

    const onChange = () => { btnContinue.disabled = !chk.checked; };

    let resolveFn;
    const p = new Promise((resolve) => (resolveFn = resolve));

    const cleanup = () => {
      overlay.style.display = "none";
      chk.removeEventListener("change", onChange);
      btnContinue.removeEventListener("click", onContinue);
      btnCancel.removeEventListener("click", onCancel);
      btnClose.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      document.removeEventListener("keydown", onKey);
    };

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

    const btnSubmit = form.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.disabled = true;

    // Paso 1
    const nombres = document.getElementById("nombres")?.value.trim() || "";
    const apellidos = document.getElementById("apellidos")?.value.trim() || "";
    const genero = document.getElementById("dato-genero")?.value.trim() || "";

    // ✅ IMPORTANTE: separar el ELEMENTO del VALOR (para evitar mandar el input a Firestore)
    const fechaNacimientoInput = document.getElementById("fechaNacimiento");
    const fechaNacimiento = (fechaNacimientoInput?.value || "").trim();

    const rol = document.getElementById("rol")?.value || "";
    const organizacion = document.getElementById("organizacion")?.value.trim() || "";

    // Paso 2
    const pais = document.getElementById("pais")?.value.trim() || "";
    const ciudad = document.getElementById("ciudad")?.value.trim() || "";
    const categoria = document.getElementById("categoria")?.value || "";
    const nivelBusqueda = document.getElementById("nivel-busqueda")?.value || "";
    const bioCorta = document.getElementById("bio-corta")?.value.trim() || "";

    // Paso 3
    const email = (document.getElementById("email")?.value || "").trim().toLowerCase();
    const web = document.getElementById("web")?.value.trim() || "";
    const password = document.getElementById("password")?.value || "";
    const confirm = document.getElementById("confirm-password")?.value || "";

    // Validaciones
    if (!nombres || !apellidos || !fechaNacimiento || !rol || !organizacion || !pais || !ciudad || !email || !password || !confirm) {
      setMensaje("Por favor completa todos los campos obligatorios.");
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }
    if (password !== confirm) {
      setMensaje("Las contraseñas no coinciden.");
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }
    if (password.length < 6) {
      setMensaje("La contraseña debe tener al menos 6 caracteres.");
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }

    try {
      // 0) Legal
      const accepted = await openLegalModal();
      if (!accepted) {
        setMensaje("Debes aceptar los términos y el tratamiento de datos para crear la cuenta.");
        if (btnSubmit) btnSubmit.disabled = false;
        return;
      }

      setMensaje("Creando tu cuenta...", true);

      // 1) Auth
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      await sendEmailVerification(cred.user);

      try {
        // 2) users/{uid}
        await setDoc(doc(db, "users", uid), {
          uid,
          email,
          contactEmail: email,
          role: "recruiter",
          verified: false,
          legal: { accepted: true, version: TERMS_VERSION, acceptedAt: serverTimestamp() },
          createdAt: serverTimestamp(),
        });

        // 3) profiles/{uid}
        await setDoc(doc(db, "profiles", uid), {
          uid,
          type: "recruiter",
          verified: false,

          nombres,
          apellidos,
          genero,
          fechaNacimiento, // ✅ string "YYYY-MM-DD"
          rol,
          organizacion,

          pais,
          ciudad,
          categoria,
          nivelBusqueda,
          bioCorta,

          emailContacto: email,
          web,

          legal: { accepted: true, version: TERMS_VERSION, acceptedAt: serverTimestamp() },
          createdAt: serverTimestamp(),
        });

      } catch (firestoreErr) {
        // ✅ Si Firestore falla, borramos el usuario creado para que el email NO quede ocupado
        console.error("❌ Firestore falló, borrando usuario Auth para reintentar:", firestoreErr);
        try { await deleteUser(cred.user); } catch (delErr) { console.warn("No se pudo borrar user:", delErr); }
        throw firestoreErr;
      }

      setMensaje("✅ Cuenta creada. Redirigiendo...", true);
      setMensaje("✅ Cuenta creada. Revisa tu correo para verificar y poder entrar.", true);
window.location.href = `verificaEmail.html?email=${encodeURIComponent(email)}`;
return;

    } catch (error) {
      console.error("❌ ERROR REGISTRO RECLUTADOR:", error);

      alert(`Firebase error:\n${error.code || "sin-code"}\n${error.message || error}`);

      let msg = "Ocurrió un error al crear la cuenta.";
      if (error.code === "auth/email-already-in-use") msg = "Este correo ya está registrado.";
      else if (error.code === "auth/invalid-email") msg = "El correo no tiene un formato válido.";
      else if (error.code === "auth/weak-password") msg = "La contraseña es demasiado débil.";
      else if (error.code === "auth/network-request-failed") msg = "Error de red. Prueba en incógnito o sin adblock.";
      else if (error.code === "auth/operation-not-allowed") msg = "Email/Password no está habilitado en Firebase Auth.";

      setMensaje(msg, false);
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });
});
