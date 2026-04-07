// js/registroJugador.js
// Maneja UI de pasos (wizard). NO hace registro ni redirige.

document.addEventListener("DOMContentLoaded", () => {
  const pasos = Array.from(document.querySelectorAll(".paso"));
  const badges = Array.from(document.querySelectorAll(".paso-badge"));
  const mensaje = document.getElementById("mensaje");

  let pasoActual = 0;

  function mostrarPaso(index) {
    pasos.forEach((paso, i) => paso.classList.toggle("activo", i === index));
    badges.forEach((badge, i) => badge.classList.toggle("activo", i === index));

    pasoActual = index;
    if (mensaje) {
      mensaje.textContent = "";
      mensaje.style.color = "#ffdddd";
    }
  }

  function validarPaso(index) {
    const paso = pasos[index];
    const campos = paso.querySelectorAll("input[required], select[required]");
    let valido = true;

    campos.forEach((campo) => {
      if (!String(campo.value || "").trim()) valido = false;
    });

    if (!valido) {
      if (mensaje) {
        mensaje.textContent =
          "Por favor completa todos los campos requeridos de este paso.";
        mensaje.style.color = "#ffdddd";
      }
      return false;
    }

    // Validaciones extra específicas de paso 3
    if (index === 2) {
      const password = document.getElementById("password");
      const confirm = document.getElementById("confirm");

      if (password && password.value.length < 6) {
        if (mensaje) {
          mensaje.textContent = "La contraseña debe tener al menos 6 caracteres.";
          mensaje.style.color = "#ffdddd";
        }
        return false;
      }

      if (password && confirm && password.value !== confirm.value) {
        if (mensaje) {
          mensaje.textContent = "Las contraseñas no coinciden.";
          mensaje.style.color = "#ffdddd";
        }
        return false;
      }
    }

    if (mensaje) mensaje.textContent = "";
    return true;
  }

  // Botones de navegación
  const btnP1Siguiente = document.getElementById("btn-p1-siguiente");
  const btnP2Atras = document.getElementById("btn-p2-atras");
  const btnP2Siguiente = document.getElementById("btn-p2-siguiente");
  const btnP3Atras = document.getElementById("btn-p3-atras");

  btnP1Siguiente?.addEventListener("click", () => {
    if (validarPaso(0)) mostrarPaso(1);
  });

  btnP2Atras?.addEventListener("click", () => mostrarPaso(0));

  btnP2Siguiente?.addEventListener("click", () => {
    if (validarPaso(1)) mostrarPaso(2);
  });

  btnP3Atras?.addEventListener("click", () => mostrarPaso(1));

  // (Opcional) si alguien intenta enviar el form por teclado sin completar:
  const form = document.getElementById("form-registro");
  form?.addEventListener("submit", (e) => {
    if (!validarPaso(2)) e.preventDefault();
  });
});
