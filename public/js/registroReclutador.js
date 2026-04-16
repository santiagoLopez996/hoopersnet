// /js/registroReclutador.js
document.addEventListener("DOMContentLoaded", () => {
  const pasos = Array.from(document.querySelectorAll(".paso"));
  const indicadores = Array.from(document.querySelectorAll(".circulo"));
  const mensaje = document.getElementById("mensaje");

  let indicePasoActual = 0;

  function mostrarPaso(indice) {
    pasos.forEach((p, i) => p.classList.toggle("activo", i === indice));
    indicadores.forEach((c, i) => c.classList.toggle("activo", i === indice));
    indicePasoActual = indice;
    if (mensaje) mensaje.textContent = "";
  }

  function validarPaso(indice) {
    if (indice === 0) {
      const nombres = document.getElementById("nombres").value.trim();
      const apellidos = document.getElementById("apellidos").value.trim();
      const pais = document.getElementById("pais").value.trim();
      const ciudad = document.getElementById("ciudad").value.trim();


      if (!nombres || !apellidos || !pais || !ciudad) {
        if (mensaje) mensaje.textContent = "Completa todos los campos obligatorios de este paso.";
        return false;
      }
    }

    if (indice === 1) {

      const rol = document.getElementById("rol").value.trim();
      const org = document.getElementById("organizacion").value.trim();      

      if (!rol || !org) {
        if (mensaje) mensaje.textContent = "Indica al menos país y ciudad para continuar.";
        return false;
      }
    }

    return true;
  }

  function validarPassword() {
    const pass = document.getElementById("password").value;
    const confirm = document.getElementById("confirm-password").value;

    if (!pass || !confirm) {
      if (mensaje) mensaje.textContent = "Completa y confirma tu contraseña.";
      return false;
    }

    if (pass !== confirm) {
      if (mensaje) mensaje.textContent = "Las contraseñas no coinciden.";
      return false;
    }

    if (pass.length < 6) {
      if (mensaje) mensaje.textContent = "La contraseña debe tener al menos 6 caracteres.";
      return false;
    }

    return true;
  }

  // Navegación entre pasos
  document.addEventListener("click", (e) => {
    const siguiente = e.target.closest(".btn-paso.siguiente");
    const volver = e.target.closest(".btn-paso.volver");

    if (siguiente) {
      if (!validarPaso(indicePasoActual)) return;
      mostrarPaso(Math.min(indicePasoActual + 1, pasos.length - 1));
    }

    if (volver) {
      mostrarPaso(Math.max(indicePasoActual - 1, 0));
    }
  });

  // ✅ Validación final SIN redireccionar (el submit real lo hace registroReclutadorAuth.js)
  const form = document.getElementById("form-reclutador");
  form?.addEventListener("submit", (e) => {
    // OJO: NO hacemos preventDefault aquí para no interferir con el Auth.
    // Solo validamos y si falla, cancelamos el submit.
    if (!validarPaso(indicePasoActual) || !validarPassword()) {
      e.preventDefault();
    }
  });

  mostrarPaso(0);
});
