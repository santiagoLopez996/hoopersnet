// js/indexModal.js
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn-crear-cuenta");
  const overlay = document.getElementById("modal-cuenta");
  const cerrar = document.getElementById("modal-cerrar");

  if (!btn || !overlay) return;

  const open = () => {
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  };

  const close = () => {
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  };

  btn.addEventListener("click", open);
  cerrar?.addEventListener("click", close);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
});
