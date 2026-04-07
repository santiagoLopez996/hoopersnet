// pestanasPerfil.js
document.addEventListener("DOMContentLoaded", () => {
  const tabDatos = document.getElementById("tab-datos");
  const tabPublicaciones = document.getElementById("tab-publicaciones");
  const contDatos = document.getElementById("contenido-datos");
  const contPublicaciones = document.getElementById("contenido-publicaciones");

  tabDatos.addEventListener("click", () => {
    contDatos.style.display = "block";
    contPublicaciones.style.display = "none";
    tabDatos.classList.add("activo");
    tabPublicaciones.classList.remove("activo");
  });

  tabPublicaciones.addEventListener("click", () => {
    contDatos.style.display = "none";
    contPublicaciones.style.display = "block";
    tabDatos.classList.remove("activo");
    tabPublicaciones.classList.add("activo");
  });
});
