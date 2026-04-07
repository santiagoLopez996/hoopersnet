// js/explorarJugadores.js
import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  collection,
  getDocs,
  limit,
  query,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

let CURRENT_UID = null;

function filtrosKey(uid) {
  return `explorarFiltros_${uid}`;
}

const $ = (id) => document.getElementById(id);

function normalize(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos
}

function calcAge(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

function formatHeight(alturaCm) {
  const cm = Number(alturaCm);
  if (!Number.isFinite(cm) || cm <= 0) return null;
  return (cm / 100).toFixed(2);
}

function initials(nombres, apellidos) {
  const n = (nombres || "").trim();
  const a = (apellidos || "").trim();
  const i1 = n ? n[0].toUpperCase() : "";
  const i2 = a ? a[0].toUpperCase() : "";
  return (i1 + i2) || "HN";
}

const POS_LABEL = {
  PG: "Base",
  SG: "Escolta",
  SF: "Alero",
  PF: "Ala-pívot",
  C: "Pívot",
};

function createCard(p) {
  const grid = $("grid-jugadores");
  if (!grid) return;

  const fullName = `${p.nombres || ""} ${p.apellidos || ""}`.trim() || "Jugador";
  const edad = calcAge(p.fechaNacimiento);
  const h = formatHeight(p.alturaCm);

  const posCode = (p.posicion || "").toString().trim().toUpperCase();
  const posText = POS_LABEL[posCode] || p.posicion || "—";

  const ciudad = p.ciudad || "—";
  const depto = p.departamento || "—";
  const nivel = p.nivelActual || "—";


// ✅ Scores (pueden no existir aún en profiles)
const rankingScore = Number(p.rankingScore) || 0;


  // Para filtros (coinciden con select)
  const dataPos = posCode || normalize(posText);
  const dataCity = normalize(ciudad);
  const dataNivel = normalize(nivel);

  //Redireccion
  const profileHref = `perfilJugador.html?uid=${encodeURIComponent(p.uid)}`;

  const article = document.createElement("article");
  article.className = "card-jugador";
  article.dataset.posicion = dataPos;
  article.dataset.ciudad = dataCity;
  article.dataset.nivel = dataNivel;
  article.dataset.uid = p.uid;

  const lineaPos = [
    posText,
    edad !== null ? `${edad} años` : null,
    h ? `${h} m` : null,
  ].filter(Boolean).join(" · ");

  // ✅ Avatar: foto si existe, si no iniciales
  const rawUrl = (p.photoURL || "").toString().trim();
  const version = Number(p.photoVersion) || 0;
  const photoUrl = rawUrl
    ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}v=${version}`
    : "";

  const initialsText = initials(p.nombres, p.apellidos);
  const avatarHTML = photoUrl
    ? `<img src="${photoUrl}" alt="Foto de ${fullName}" loading="lazy" referrerpolicy="no-referrer"
         onerror="this.replaceWith(document.createTextNode('${initialsText}'))">`
    : `${initialsText}`;

article.innerHTML = `
  <header class="card-header">
    <a href="${profileHref}" class="card-link-profile" aria-label="Ver perfil de ${fullName}">
      <div class="card-avatar">${avatarHTML}</div>
    </a>

    <div class="card-titulos">
      <a href="${profileHref}" class="card-link-profile">
        <h2 class="card-nombre">${fullName}</h2>
      </a>
      <p class="card-linea-posicion">${lineaPos || "—"}</p>
    </div>

    <!-- ✅ Score pill -->
    <div class="score-pill" title="RankingScore = 0.65*(puntaje últimos 15 días) + 0.35*(puntaje total)">
  <span class="score-pill-label">Score</span>
  <span class="score-pill-value">${Math.round(rankingScore)}</span>
</div>
  </header>

  <p class="card-linea-contexto">
    ${ciudad} · ${nivel} · ${depto}
  </p>


  <div class="card-acciones">
    <a href="${profileHref}" class="btn-ver-perfil">Ver perfil</a>
  </div>
`;



  grid.appendChild(article);
}


function clearGrid() {
  const grid = $("grid-jugadores");
  if (grid) grid.innerHTML = "";
}

function updateCount(n) {
  const el =
    document.getElementById("total-jugadores") ||
    document.querySelector(".explorar-resumen strong");

  if (el) el.textContent = String(n);
}


function applyFilters() {
  const nombre = normalize($("filtro-nombre")?.value);
  const pos = ($("filtro-posicion")?.value || "").toString().trim();
  const ciudad = normalize($("filtro-ciudad")?.value);
  const nivel = normalize($("filtro-nivel")?.value);

  const cards = document.querySelectorAll(".card-jugador");
  let visibles = 0;

  cards.forEach((card) => {
    const cardName = normalize(card.querySelector(".card-nombre")?.textContent);
    const cardPos = (card.dataset.posicion || "").toString();
    const cardCity = normalize(card.dataset.ciudad);
    const cardNivel = normalize(card.dataset.nivel);

    const okNombre = !nombre || cardName.includes(nombre);
    const okPos = !pos || cardPos === pos;               // pos: PG/SG/SF/PF/C
    const okCity = !ciudad || cardCity.includes(ciudad); // ciudad: "bogota"
    const okNivel = !nivel || cardNivel.includes(nivel);

    const show = okNombre && okPos && okCity && okNivel;
    card.style.display = show ? "" : "none";
    if (show) visibles++;
  });

  updateCount(visibles);
}

function resetFilters() {
  const form = $("filtros-jugadores");
  form?.reset();

  if (CURRENT_UID) {
    localStorage.removeItem(filtrosKey(CURRENT_UID));
  }

  applyFilters();
}



async function loadPlayers() {
  clearGrid();
  updateCount(0);

  // carga perfiles (por ahora limit 200)
  const snap = await getDocs(query(collection(db, "profiles"), limit(200)));

  const players = snap.docs
  .map((d) => ({ uid: d.id, ...d.data() }))
  .filter((p) => (p.type || "player") === "player");

// ✅ ORDENAR por RankingScore (mayor -> menor)
players.sort((a, b) => (Number(b.rankingScore) || 0) - (Number(a.rankingScore) || 0));

players.forEach(createCard);
applyFilters(); // para que el contador quede bien
 // para que el contador quede bien
}

function wireUI() {
  $("filtro-buscar")?.addEventListener("click", applyFilters);
  $("filtro-reset")?.addEventListener("click", resetFilters);

  // opcional: filtrar en vivo al escribir
  $("filtro-nombre")?.addEventListener("input", applyFilters);
  $("filtro-posicion")?.addEventListener("change", applyFilters);
  $("filtro-ciudad")?.addEventListener("change", applyFilters);
  $("filtro-nivel")?.addEventListener("change", applyFilters);

  // Logout (si existe el botón)
  $("btn-logout")?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

function restoreFiltersFromStorage(uid) {
  try {
    const raw = localStorage.getItem(filtrosKey(uid));
    if (!raw) return;

    const f = JSON.parse(raw) || {};

    if ($("filtro-nombre")) $("filtro-nombre").value = f.nombre || "";
    if ($("filtro-posicion")) $("filtro-posicion").value = f.posicion || "";
    if ($("filtro-ciudad")) $("filtro-ciudad").value = f.ciudad || "";
    if ($("filtro-nivel")) $("filtro-nivel").value = f.nivel || "";
  } catch (e) {
    console.warn("No se pudieron restaurar filtros:", e);
  }
}

// ✅ Guard: si no está logueado, lo mandamos a login
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  CURRENT_UID = user.uid;

  try {
    wireUI();
    restoreFiltersFromStorage(CURRENT_UID); // ✅ ahora por usuario
    await loadPlayers();
    applyFilters();
  } catch (err) {
    console.error(err);
    alert("Error cargando jugadores. Revisa la consola y tus Firestore Rules.");
  }
});


