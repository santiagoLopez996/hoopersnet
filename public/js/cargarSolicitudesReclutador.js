import { auth, db } from "./firebase-init.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  collection, query, where, limit, getDocs,
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const listEl  = document.getElementById("solicitudes-list");
const badgeEl = document.getElementById("tab-badge-solicitudes");
const emptyEl = document.getElementById("solicitudes-enviadas-empty"); // si existe en tu HTML

function badgeClass(status){
  if (status === "accepted") return "badge badge--accepted";
  if (status === "rejected") return "badge badge--rejected";
  return "badge badge--pending";
}

function statusLabel(status){
  if (status === "accepted") return "Aceptada";
  if (status === "rejected") return "Rechazada";
  return "Pendiente";
}

function renderEmpty(){
  if (emptyEl) emptyEl.style.display = "block";
  if (listEl) listEl.innerHTML = "";
  if (badgeEl) badgeEl.style.display = "none";
}

function renderError(){
  if (emptyEl) emptyEl.style.display = "block";
  if (emptyEl) emptyEl.textContent = "No se pudieron cargar las solicitudes. Revisa consola.";
  if (listEl) listEl.innerHTML = "";
}

function formatFecha(ms){
  if (!ms) return "Fecha no disponible";
  const d = new Date(ms);
  // Formato bonito en español (Colombia)
  return d.toLocaleString("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderCard({ playerUid, playerName, status, createdAtMs }){
  const safeName = (playerName || "Jugador").toString();
  const href = `perfilJugador.html?uid=${encodeURIComponent(playerUid || "")}`;

  return `
    <div class="solicitud-card">
      <div class="solicitud-left">
        <div class="solicitud-nombre">
          ${playerUid
            ? `<a class="link-player" href="${href}">${safeName}</a>`
            : safeName
          }
        </div>
        <div class="solicitud-meta">Enviada: ${formatFecha(createdAtMs)}</div>
      </div>
      <div class="${badgeClass(status)}">${statusLabel(status)}</div>
    </div>
  `;
}

// Concurrencia simple para no disparar 500 lecturas a la vez
async function runWorkers(items, workers, fn) {
  const results = new Array(items.length);
  let i = 0;

  const pool = Array.from({ length: Math.max(1, workers) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(pool);
  return results;
}

async function loadSolicitudesSent(recruiterUid){
  if (!listEl) return;

  if (emptyEl) emptyEl.style.display = "none";
  listEl.innerHTML = "";

  try {
    // 1) Traer jugadores (profiles)
    const profQ = query(
      collection(db, "profiles"),
      where("type", "==", "player"),
      limit(400) // ajusta si quieres (MVP)
    );

    const profSnap = await getDocs(profQ);

    if (profSnap.empty) {
      renderEmpty();
      return;
    }

    const players = profSnap.docs.map(d => ({
      uid: d.id,
      data: d.data() || {}
    }));

    // 2) Para cada jugador, mirar si existe la solicitud con docId = recruiterUid
    const found = await runWorkers(players, 12, async (p) => {
      const reqRef = doc(db, "contact_requests", p.uid, "items", recruiterUid);
      const reqSnap = await getDoc(reqRef);
      if (!reqSnap.exists()) return null;

      const r = reqSnap.data() || {};
      const status = (r.status || "pending").toString();

      const nombres = (p.data.nombres || "").toString().trim();
      const apellidos = (p.data.apellidos || "").toString().trim();
      const playerName = (`${nombres} ${apellidos}`).trim() || "Jugador";

      // createdAt puede ser Timestamp; guardamos millis si está
      const createdAtMs = r.createdAt?.toMillis ? r.createdAt.toMillis() : 0;

      return { playerUid: p.uid, playerName, status, createdAtMs };
    });

    const solicitudes = found.filter(Boolean);

    if (!solicitudes.length) {
      renderEmpty();
      return;
    }

    // Ordenar por createdAt desc
    solicitudes.sort((a,b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

    // Badge contador
    if (badgeEl) {
      badgeEl.textContent = String(solicitudes.length);
      badgeEl.style.display = "inline-flex";
    }

    listEl.innerHTML = solicitudes.map(renderCard).join("");

  } catch (err) {
    console.error("Error leyendo solicitudes:", err);
    renderError();
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  loadSolicitudesSent(user.uid);
});
