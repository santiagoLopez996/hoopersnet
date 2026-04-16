// /js/cargarPerfil.js
// Carga perfil del jugador en perfilJugador.html desde Firestore (profiles/{uid})
// y ajusta UI según si es "mi perfil" (dueño) o "perfil público".

import { auth, db, storage } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp,
  collection, getDocs, updateDoc, where, onSnapshot,
  query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  ref as sRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";
//import { computeScoresFromSubs } from "/js/puntos.js";





function byId(id) {
  const el = document.getElementById(id);
  return el || null;
}

function setSolicitudesBadge(count) {
  const badge = byId("tab-badge-solicitudes");
  if (!badge) return;

  const n = Number(count) || 0;

  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = "inline-flex";
  } else {
    badge.textContent = "0";
    badge.style.display = "none";
  }
}

function updateSolicitudesBadgeFromDOM() {
  const list = byId("contacto-list");
  if (!list) return;
  const shown = list.querySelectorAll(".post-card").length;
  setSolicitudesBadge(shown);
}


function safeTextById(id, value, fallback = "—") {
  const el = byId(id);
  if (!el) return;
  const txt = (value ?? "").toString().trim();
  el.textContent = txt ? txt : fallback;
}

function calcEdad(fechaISO) {
  if (!fechaISO) return "";
  const d = new Date(fechaISO);
  if (Number.isNaN(d.getTime())) return "";
  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) edad--;
  return edad >= 0 ? String(edad) : "";
}

function initials(nombres, apellidos) {
  const a = (nombres || "").trim().slice(0, 1).toUpperCase();
  const b = (apellidos || "").trim().slice(0, 1).toUpperCase();
  return (a + b) || "HN";
}

function withCacheBust(url, v) {
  const ver = Number(v) || 0;
  if (!url) return "";
  return url.includes("?") ? `${url}&v=${ver}` : `${url}?v=${ver}`;
}

function paintAvatar({ photoURL, photoVersion, nombres, apellidos }) {
  const img = byId("avatar-img");
  const fallback = byId("avatar-fallback");
  const ini = byId("avatar-iniciales");

  const url = (photoURL || "").toString().trim();
  const iniTxt = initials(nombres, apellidos);

  if (ini) ini.textContent = iniTxt;

  if (url && img) {
    img.src = withCacheBust(url, photoVersion || Date.now());
    img.style.display = "block";
    if (fallback) fallback.style.display = "none";
    if (ini) ini.style.display = "none";
  } else {
    if (img) img.style.display = "none";
    if (fallback) fallback.style.display = "block";
    if (ini) ini.style.display = "none"; // si prefieres iniciales, ponlo en "block" y esconde el icono
  }
}

// ==========================
// PUNTOS POR PUBLICACIONES
// ==========================
const POST_POINTS_DEFAULT = 10;
const RECENT_WINDOW_DAYS = 15;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const RECENT_WEIGHT = 0.65;
const TOTAL_WEIGHT = 0.35;

function pickPostPoints(p) {
  // Preferimos lo que guardas en el post (si existe)
  const a = Number(p.pointsAwarded);
  if (Number.isFinite(a) && a > 0) return a;

  const b = Number(p.postPoints);
  if (Number.isFinite(b) && b > 0) return b;

  return POST_POINTS_DEFAULT;
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function computeScoresFromPosts(posts = []) {
  const now = Date.now();

  let total = 0;
  let p30 = 0;

  for (const p of posts) {
    if (p?.deleted === true || p?.isDeleted === true) continue;

    const pts = pickPostPoints(p);
    total += pts;

    const t = tsToMs(p.createdAt || p.pointsAwardedAt || p.updatedAt);
    if (t && (now - t <= RECENT_WINDOW_MS)) p30 += pts;
  }

  return { totalPoints: total, points30d: p30 };
}

let unsubScoreSync = null;

function startScoreAutoSync({ uidToLoad, isOwner }) {

  return;
  // Solo el dueño puede leer sus submissions y escribir su profiles
  if (!isOwner) return;

  // evitar doble listener
  if (unsubScoreSync) unsubScoreSync();

  // listener 1: accepted
  const qAccepted = query(
    collection(db, "challenge_submissions"),
    where("playerUid", "==", uidToLoad),
    where("status", "==", "accepted")
  );

  // listener 2: approved (compatibilidad vieja)
  const qApproved = query(
    collection(db, "challenge_submissions"),
    where("playerUid", "==", uidToLoad),
    where("status", "==", "approved")
  );

  // listener 3: posts del jugador (publicaciones)
  const qPosts = query(
    collection(db, "posts"),
    where("ownerUid", "==", uidToLoad)
  );

  let cacheA = [];
  let cacheB = [];
  let cacheP = [];

  let timer = null;

  const recomputeAndPersist = async () => {
    if (timer) clearTimeout(timer);

    timer = setTimeout(async () => {
      try {
        const subs = [...cacheA, ...cacheB];

        // Retos
        const ch = computeScoresFromSubs(subs);

        // Posts
        const ps = computeScoresFromPosts(cacheP);

        // Combinar
        const totalPoints = (ch.totalPoints || 0) + (ps.totalPoints || 0);
        const points30d = (ch.points30d || 0) + (ps.points30d || 0);
        const rankingScore = RECENT_WEIGHT * points30d + TOTAL_WEIGHT * totalPoints;

        // Pintar UI
        paintScoreBoxes({
          scoreTotal: totalPoints,
          score30d: points30d,
          rankingScore,
        });

        // Persistir en profiles para que explore/cards lo vean
        await setDoc(
          doc(db, "profiles", uidToLoad),
          {
            scoreTotal: totalPoints || 0,
            score30d: points30d || 0,
            rankingScore: rankingScore || 0,
            scoreUpdatedAt: serverTimestamp(),

            // Breakdown / debug
            postScoreTotal: ps.totalPoints || 0,
            postScore30d: ps.points30d || 0,
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("[score] no pude recompute/persist:", e);
      }
    }, 250);
  };

  const unsub1 = onSnapshot(qAccepted, (snap) => {
    cacheA = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    recomputeAndPersist();
  });

  const unsub2 = onSnapshot(qApproved, (snap) => {
    cacheB = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    recomputeAndPersist();
  });

  const unsub3 = onSnapshot(qPosts, (snap) => {
    cacheP = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    recomputeAndPersist();
  });

  unsubScoreSync = () => {
    unsub1();
    unsub2();
    unsub3();
  };
}




function getUidFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("uid") || "";
}

function setOwnerUI(isOwner, signedIn) {
  // Botones del dueño
  const btnEditar = byId("btn-editar-perfil");
  const btnAdd = byId("btn-abrir-modal"); // + publicaciones

  // Logout solo en tu propio perfil
  const btnLogout = byId("btn-logout");

  if (btnEditar) btnEditar.style.display = isOwner ? "inline-flex" : "none";
  if (btnAdd) btnAdd.style.display = isOwner ? "inline-flex" : "none";
  if (btnLogout) btnLogout.style.display = isOwner ? "inline-flex" : "none";
}

function initPerfilTabs(isOwner) {
  const tabsBar = byId("perfil-tabs");

  const btnPrincipal = byId("tab-btn-principal");
  const btnPublicaciones = byId("tab-btn-publicaciones");
  const btnRetos = byId("tab-btn-retos-participados");
  const btnSolicitudes = byId("tab-btn-solicitudes");

  const viewPrincipal = byId("view-principal");
  const viewPublicaciones = byId("view-publicaciones");
  const viewRetos = byId("view-retos");
  const viewSolicitudes = byId("view-solicitudes");

  if (!tabsBar || !btnPrincipal || !btnPublicaciones || !viewPrincipal || !viewPublicaciones) return;

  // Tabs siempre visibles (para que visitantes puedan ver Publicaciones / Retos)
  tabsBar.style.display = "flex";

  // Solicitudes solo para el dueño
  if (btnSolicitudes) btnSolicitudes.style.display = isOwner ? "inline-flex" : "none";
  if (btnRetos) btnRetos.style.display = "inline-flex";

  const toggleActive = (btn, on) => {
    if (!btn) return;
    btn.classList.toggle("tab-activo", !!on);
    // por si en algún lado todavía usas ".active"
    btn.classList.toggle("active", !!on);
  };

  function setActive(tab) {
    const btnAdd = byId("btn-abrir-modal"); // FAB "+"
    if (btnAdd) btnAdd.style.display = (isOwner && tab === "publicaciones") ? "inline-flex" : "none";

    // botones activos
    toggleActive(btnPrincipal, tab === "principal");
    toggleActive(btnPublicaciones, tab === "publicaciones");
    toggleActive(btnRetos, tab === "retos");
    toggleActive(btnSolicitudes, tab === "solicitudes");

    // vistas
    viewPrincipal.style.display = tab === "principal" ? "block" : "none";
    viewPublicaciones.style.display = tab === "publicaciones" ? "block" : "none";
    if (viewRetos) viewRetos.style.display = tab === "retos" ? "block" : "none";

    if (viewSolicitudes) {
      viewSolicitudes.style.display = (tab === "solicitudes" && isOwner) ? "block" : "none";
    }

    // guardar tab
    try {
      const safeTab = (!isOwner && tab === "solicitudes") ? "principal" : tab;
      sessionStorage.setItem("HN_PLAYER_TAB", safeTab);
    } catch (_) {}
  }

  // listeners
  btnPrincipal.onclick = () => setActive("principal");
  btnPublicaciones.onclick = () => setActive("publicaciones");
  if (btnRetos) btnRetos.onclick = () => setActive("retos");

  if (btnSolicitudes) {
    btnSolicitudes.onclick = () => {
      if (!isOwner) return;
      setActive("solicitudes");
    };
  }

  // default tab
  let defaultTab = "principal";
  try {
    const saved = sessionStorage.getItem("HN_PLAYER_TAB");
    if (saved === "publicaciones") defaultTab = "publicaciones";
    if (saved === "retos" && viewRetos) defaultTab = "retos";
    if (saved === "solicitudes" && isOwner) defaultTab = "solicitudes";
  } catch (_) {}

  setActive(defaultTab);
}

let unsubRetosParticipados = null;
const retosChallengeCache = new Map();
let retosDelegationWired = false;
let videoModalWired = false;

function fmtFecha(ts) {
  if (!ts) return "";
  const d =
    (typeof ts.toDate === "function") ? ts.toDate() :
    (typeof ts.seconds === "number") ? new Date(ts.seconds * 1000) :
    new Date(ts);

  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
}

function labelEstadoSubmission(status) {
  const s = (status || "pending").toString();
  if (s === "accepted") return "✅ Aprobado";
  if (s === "rejected") return "❌ Rechazado";
  return "⏳ En revisión";
}

function labelDificultad(key) {
  const k = (key || "").toString().toLowerCase();
  if (k === "easy") return "FÁCIL";
  if (k === "medium") return "MEDIA";
  if (k === "hard") return "DIFÍCIL";
  return k ? k.toUpperCase() : "—";
}

function truncateText(str, n = 160) {
  const s = String(str || "").trim();
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}

async function getChallengeCached(challengeId) {
  if (!challengeId) return null;
  if (retosChallengeCache.has(challengeId)) return retosChallengeCache.get(challengeId);

  try {
    const snap = await getDoc(doc(db, "challenges", challengeId));
    const data = snap.exists() ? (snap.data() || {}) : null;
    retosChallengeCache.set(challengeId, data);
    return data;
  } catch (e) {
    console.warn("No pude leer challenge:", challengeId, e);
    retosChallengeCache.set(challengeId, null);
    return null;
  }
}

function wireVideoModal() {
  if (videoModalWired) return;

  const overlay = byId("modal-video-overlay");
  const btnClose = byId("btn-cerrar-video");
  const player = byId("modal-video-player");

  if (!overlay || !btnClose || !player) return;

  videoModalWired = true;

  const close = () => {
    try { player.pause(); } catch (_) {}
    player.removeAttribute("src");
    try { player.load(); } catch (_) {}
    overlay.classList.remove("visible");
    overlay.style.display = "none";
  };

  btnClose.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // expone close por si lo necesitas
  window.__HN_closeVideoModal = close;
}

async function openVideoModal({ videoPath, fallbackUrl }) {
  const overlay = byId("modal-video-overlay");
  const player = byId("modal-video-player");

  // Si por alguna razón no existe el modal, abrimos el link en otra pestaña
  if (!overlay || !player) {
    if (fallbackUrl) window.open(fallbackUrl, "_blank", "noopener");
    return;
  }

  wireVideoModal();

  overlay.style.display = "flex";
  overlay.classList.add("visible");

  player.removeAttribute("src");

  try {
    if (videoPath) {
      const url = await getDownloadURL(sRef(storage, videoPath));
      player.src = url;
    } else if (fallbackUrl) {
      player.src = fallbackUrl;
    }
  } catch (e) {
    console.warn("No pude abrir video por Storage path, uso fallback:", e);
    if (fallbackUrl) player.src = fallbackUrl;
  }

  try { player.load(); } catch (_) {}
  try { await player.play(); } catch (_) {}
}

function wireRetosDelegation(listEl) {
  if (!listEl || retosDelegationWired) return;
  retosDelegationWired = true;

  listEl.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-action='ver-video']");
    if (!a) return;

    e.preventDefault();

    const videoPath = a.dataset.videoPath || "";
    const videoUrl = a.dataset.videoUrl || "";

    await openVideoModal({ videoPath, fallbackUrl: videoUrl });
  });
}

async function renderRetosParticipados(listEl, emptyEl, subs) {
  if (!listEl) return;

  listEl.innerHTML = "";

  if (!subs || subs.length === 0) {
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  // Trae challenges en paralelo (cacheado)
  const pairs = await Promise.all(subs.map(async (sub) => {
    const ch = await getChallengeCached(sub.challengeId);
    return { sub, ch };
  }));

  for (const { sub, ch } of pairs) {
    const card = document.createElement("article");
    card.className = "post-card";

    const estado = labelEstadoSubmission(sub.status);
    const fecha = fmtFecha(sub.createdAt);
    const diff = labelDificultad(ch?.difficulty || sub.difficultyKey);
    const title = (ch?.title || "Reto").toString();
    const rules = (ch?.rules || "").toString().trim();
    const creator = (ch?.createdByName || "").toString().trim();

    const puntos = Number(sub.basePoints) || 0;
    const pill = puntos ? `${diff} · ${puntos} pts` : diff;

    card.innerHTML = `
      <div class="post-meta">
        <span class="post-fecha">${escapeHtml(estado)}${fecha ? ` · ${escapeHtml(fecha)}` : ""}</span>
        <span class="post-tipo">${escapeHtml(pill)}</span>
      </div>

      <h3 class="post-titulo">${escapeHtml(title)}</h3>

      <p class="post-descripcion">
        ${rules ? escapeHtml(truncateText(rules, 170)) : (creator ? `Creador: ${escapeHtml(creator)}` : "—")}
      </p>

      ${creator ? `<p class="post-descripcion" style="margin-top:-2px;opacity:.9;">Creador: ${escapeHtml(creator)}</p>` : ""}
    `;

    const footer = document.createElement("div");
    footer.className = "post-footer";

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const a = document.createElement("a");
    a.href = "#";
    a.className = "post-boton";
    a.dataset.action = "ver-video";
    a.dataset.videoPath = sub.videoPath || "";
    a.dataset.videoUrl = sub.videoUrl || "";
    a.innerHTML = `<i class="fa-solid fa-play"></i> Ver video`;

    actions.appendChild(a);
    footer.appendChild(actions);
    card.appendChild(footer);

    listEl.appendChild(card);
  }
}

function initRetosParticipados({ playerUid, signedIn }) {
  const listEl = byId("retos-list");
  const emptyEl = byId("retos-empty");
  const loginHint = byId("retos-login-hint");

  // Si aún no agregaste la vista al HTML, no hacemos nada
  if (!listEl) return;

  // corta listener previo
  if (unsubRetosParticipados) {
    unsubRetosParticipados();
    unsubRetosParticipados = null;
  }
  retosChallengeCache.clear();
  retosDelegationWired = false;

  listEl.innerHTML = "";
  if (emptyEl) emptyEl.style.display = "none";

  if (!signedIn) {
    if (loginHint) loginHint.style.display = "block";
    return;
  }
  if (loginHint) loginHint.style.display = "none";

  wireRetosDelegation(listEl);

  const q = query(
    collection(db, "challenge_submissions"),
    where("playerUid", "==", playerUid),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  unsubRetosParticipados = onSnapshot(q, async (snap) => {
    const subs = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    await renderRetosParticipados(listEl, emptyEl, subs);
  }, (err) => {
    console.error("Error cargando retos participados:", err);
    if (emptyEl) {
      emptyEl.textContent = "No se pudieron cargar los retos participados. Revisa consola.";
      emptyEl.style.display = "block";
    }
  });
}

function paintScoreBoxes(p = {}) {
  const total = Number(p.scoreTotal ?? 0);
  const p30 = Number(p.score30d ?? 0);
  const rank = Number(p.rankingScore ?? 0);

  const elTotal = byId("score-total");
  const el30 = byId("score-30d");
  const elRank = byId("score-ranking");

  if (elTotal) elTotal.textContent = String(total);
  if (el30) el30.textContent = String(p30);
  if (elRank) elRank.textContent = String(Math.round(rank));
}

let unsubProfileScore = null;

function listenProfileScore(uidToLoad) {
  if (unsubProfileScore) unsubProfileScore();

  const refP = doc(db, "profiles", uidToLoad);
  unsubProfileScore = onSnapshot(
    refP,
    (snap) => {
      const p = snap.exists() ? (snap.data() || {}) : {};
      paintScoreBoxes({
        scoreTotal: Number(p.scoreTotal || 0),
        score30d: Number(p.score30d || 0),
        rankingScore: Number(p.rankingScore || 0),
      });
    },
    (err) => console.warn("[score] error escuchando profile:", err)
  );
}



async function paintAndMaybePersistScores({ uidToLoad, isOwner }) {

  return;
  // 1) Si NO es dueño: solo pintamos lo que ya exista en /profiles/{uid}
  // (no recalculamos ni persistimos nada)
  try {
    const snapP = await getDoc(doc(db, "profiles", uidToLoad));
    const p = snapP.exists() ? (snapP.data() || {}) : {};
    paintScoreBoxes(p);
  } catch (e) {
    console.warn("[score] no pude leer profiles para pintar", e);
  }

  if (!isOwner) return;

  // 2) Si SÍ es dueño: recalculamos (retos + posts) y persistimos en /profiles/{uid}
  try {
    // --- A) Retos (submissions aceptadas + aprobadas) ---
    const qAccepted = query(
      collection(db, "challenge_submissions"),
      where("playerUid", "==", uidToLoad),
      where("status", "==", "accepted")
    );

    const qApproved = query(
      collection(db, "challenge_submissions"),
      where("playerUid", "==", uidToLoad),
      where("reviewStatus", "==", "approved")
    );

    const [snapA, snapB] = await Promise.all([getDocs(qAccepted), getDocs(qApproved)]);
    const a = snapA.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const b = snapB.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    // merge sin duplicados por id
    const map = new Map();
    a.forEach((x) => map.set(x.id, x));
    b.forEach((x) => map.set(x.id, x));
    const subs = Array.from(map.values());

    const ch = computeScoresFromSubs(subs); // { totalPoints, points30d, rankingScore? }

    // --- B) Posts (publicaciones del jugador) ---
    const qPosts = query(
      collection(db, "posts"),
      where("ownerUid", "==", uidToLoad)
    );
    const snapPosts = await getDocs(qPosts);
    const posts = snapPosts.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const ps = computeScoresFromPosts(posts); // { totalPoints, points30d }

    // --- C) Combinar ---
    const totalPoints = (ch.totalPoints || 0) + (ps.totalPoints || 0);
    const points30d = (ch.points30d || 0) + (ps.points30d || 0);
    const rankingScore = RECENT_WEIGHT * points30d + TOTAL_WEIGHT * totalPoints;

    // --- D) Persistir (merge para no pisar otros campos del perfil) ---
    await setDoc(
      doc(db, "profiles", uidToLoad),
      {
        scoreTotal: totalPoints || 0,
        score30d: points30d || 0,
        rankingScore: rankingScore || 0,
        scoreUpdatedAt: serverTimestamp(),

        // Breakdown útil (no rompe nada)
        postScoreTotal: ps.totalPoints || 0,
        postScore30d: ps.points30d || 0,
      },
      { merge: true }
    );

    // --- E) Pintar en UI con lo nuevo ---
    paintScoreBoxes({
      scoreTotal: totalPoints || 0,
      score30d: points30d || 0,
      rankingScore: rankingScore || 0,
      postScoreTotal: ps.totalPoints || 0,
      postScore30d: ps.points30d || 0,
    });
  } catch (e) {
    console.warn("[score] no pude recalcular/persistir (owner)", e);
  }
}

async function paintPlayerEmailForViewer({ playerUid, viewerUser, isOwner }) {
  // dueño: lee users/{uid}
  if (isOwner && viewerUser) {
    const uSnap = await getDoc(doc(db, "users", playerUid));
    const email = (uSnap.data()?.contactEmail || "").toString().trim();
    safeTextById("contacto-email", email || "—", "—");
    return;
  }

  // recruiter viendo jugador: solo si existe reveal accepted
  if (viewerUser) {
    const role = await getRole(viewerUser.uid);
    if (role === "recruiter") {
      try {
        const rRef = doc(db, "contact_reveals", playerUid, "items", viewerUser.uid);
        const rSnap = await getDoc(rRef);
        const email = (rSnap.data()?.playerEmail || "").toString().trim();
        safeTextById("contacto-email", email ? email : "🔒 Oculto", "🔒 Oculto");
        return;
      } catch (_) {}
    }
  }

  safeTextById("contacto-email", "🔒 Oculto", "🔒 Oculto");
}

async function loadProfile(uidToLoad) {
  const ref = doc(db, "profiles", uidToLoad);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Perfil no existe en profiles/{uid}");
  const p = snap.data();

  paintAvatar({
  photoURL: p.photoURL,
  photoVersion: p.photoVersion,
  nombres: p.nombres,
  apellidos: p.apellidos
});


  // Header
  const fullName = `${p.nombres || ""} ${p.apellidos || ""}`.trim() || "Jugador";
  safeTextById("nombre-header", fullName, "Jugador");
  safeTextById("posicion", p.posicion, "—");
  safeTextById("ciudad-header", p.ciudad, "—");
  safeTextById("edad-header", calcEdad(p.fechaNacimiento), "—");

  // Avatar iniciales
  safeTextById("avatar-iniciales", initials(p.nombres, p.apellidos), "HN");

  // Datos personales
  safeTextById("dato-nombre", fullName, "—");
  safeTextById("dato-genero", p.genero, "—");
  safeTextById("dato-nacionalidad", p.nacionalidad, "—");
  safeTextById(
    "dato-ubicacion",
    `${p.departamento || ""} · ${p.ciudad || ""}`.trim().replace(/^·\s*|\s*·$/g, ""),
    "—"
  );
  safeTextById("dato-fecha", p.fechaNacimiento, "—");
  safeTextById("dato-altura", p.alturaCm ? `${p.alturaCm} cm` : "", "—");
  safeTextById("dato-peso", p.pesoKg ? `${p.pesoKg} kg` : "", "—");

  // Hazte visible
  safeTextById("nivel-actual", p.nivelActual, "—");
  safeTextById("institucion-actual", p.institucion, "—");

  // Contacto
  safeTextById("contacto-whatsapp", p.whatsapp || "", "—");
  safeTextById("contacto-email", "🔒 Oculto", "🔒 Oculto");


  // Descripción
  safeTextById("descripcionBreve", p.descripcionBreve || "", "—");

  // Video principal (link)
  const aVideo = byId("link-video");
  const urlVideo = (p.videoPrincipal || p.videoUrl || "").trim();
  if (aVideo) {
    if (urlVideo) {
      aVideo.href = urlVideo;
      aVideo.classList.remove("disabled");
      aVideo.setAttribute("target", "_blank");
      aVideo.setAttribute("rel", "noopener");
    } else {
      aVideo.removeAttribute("href");
      aVideo.classList.add("disabled");
    }
  }

  return p;
}

function wireLogout() {
  const btnLogout = byId("btn-logout");
  if (!btnLogout) return;
  btnLogout.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "/html/login.html";
    } catch (e) {
      console.error("Error cerrando sesión:", e);
      alert("No se pudo cerrar sesión.");
    }
  });
}

async function getRole(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    return snap.data()?.role || null;
  } catch (e) {
    console.error("Error leyendo role:", e);
    return null;
  }
}

function setFavBtnState(btn, isFav) {
  if (!btn) return;
  btn.innerHTML = isFav
    ? `<i class="fa-solid fa-star"></i> Quitar de favoritos`
    : `<i class="fa-regular fa-star"></i> Agregar a favoritos`;
  btn.dataset.isFav = isFav ? "1" : "0";
}

async function initFavoritos({ viewerUser, playerUid, isOwner }) {
  const btnFav = byId("btn-favorito");
  if (!btnFav) return;

  // Por defecto oculto
  btnFav.style.display = "none";

  // Solo si hay sesión, NO es tu propio perfil, y el viewer es recruiter
  if (!viewerUser || !viewerUser.uid || isOwner) return;

  const role = await getRole(viewerUser.uid);
  if (role !== "recruiter") return;

  // Mostrar botón
  btnFav.style.display = "inline-flex";

  const favRef = doc(db, "users", viewerUser.uid, "favorites", playerUid);

  // Estado inicial (¿ya está en favoritos?)
  btnFav.disabled = true;
  try {
    const favSnap = await getDoc(favRef);
    let isFav = favSnap.exists();
    setFavBtnState(btnFav, isFav);

    // Click toggle
    btnFav.onclick = async () => {
      btnFav.disabled = true;
      try {
        if (isFav) {
          await deleteDoc(favRef);
          explainFavToast("Jugador quitado de favoritos ✅");
          isFav = false;
        } else {
          await setDoc(favRef, { createdAt: serverTimestamp() });
          explainFavToast("Jugador agregado a favoritos ⭐");
          isFav = true;
        }
        setFavBtnState(btnFav, isFav);
      } catch (e) {
        console.error("Error actualizando favoritos:", e);
        alert("No se pudo actualizar favoritos. Revisa consola.");
      } finally {
        btnFav.disabled = false;
      }
    };
  } finally {
    btnFav.disabled = false;
  }
}

// Mini “toast” simple con alert (si ya tienes otro, lo puedes cambiar)
function explainFavToast(msg) {
  // Puedes reemplazar por tu UI si quieres
  // alert(msg);
  console.log(msg);
}

// ==========================
// 2.2 Contacto (Solicitud + Inbox del jugador)
// ==========================

async function getUserData(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? (snap.data() || {}) : {};
  } catch (e) {
    console.error("Error leyendo users/{uid}:", e);
    return {};
  }
}

async function getProfileData(uid) {
  try {
    const snap = await getDoc(doc(db, "profiles", uid));
    return snap.exists() ? (snap.data() || {}) : {};
  } catch (e) {
    console.error("Error leyendo profiles/{uid}:", e);
    return {};
  }
}

function openContactoModal() {
  const ov = byId("overlay-contacto");
  if (ov) ov.style.display = "flex";
}

function closeContactoModal() {
  const ov = byId("overlay-contacto");
  if (ov) ov.style.display = "none";
}

function setContactoMsg(msg, ok = false) {
  const el = byId("contacto-msg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok ? "#16a34a" : "#dc2626";
}

function setContactoSubmitEnabled(enabled) {
  const form = byId("form-contacto");
  if (!form) return;
  const btnSubmit = form.querySelector('button[type="submit"]');
  if (btnSubmit) btnSubmit.disabled = !enabled;
}

async function initContacto({ viewerUser, playerUid, isOwner }) {
  const btn = byId("btn-solicitar-contacto");
  if (!btn) return;

  // Por defecto oculto
  btn.style.display = "none";

  // Solo reclutadores viendo perfil AJENO de jugador
  if (!viewerUser || !viewerUser.uid || isOwner) return;

  const role = await getRole(viewerUser.uid);
  if (role !== "recruiter") return;

  // Mostrar FAB incluso si NO está verificado (pero bloqueamos enviar)
  btn.style.display = "inline-flex";

  const viewerData = await getUserData(viewerUser.uid);
  const isVerified = viewerData.verified === true;
  const contactEmail = (viewerData.contactEmail || "").toString().trim();


  const btnClose = byId("btn-cerrar-contacto");
  const btnCancel = byId("btn-cancelar-contacto");
  const form = byId("form-contacto");

  if (btnClose) btnClose.onclick = () => closeContactoModal();
  if (btnCancel) btnCancel.onclick = () => closeContactoModal();

  btn.onclick = () => {
    // reset
    const msg = byId("contacto-mensaje");
    if (msg) msg.value = "";

    if (!isVerified) {
      setContactoMsg("⚠️ Tu cuenta no está verificada. Verifícate para poder solicitar contacto.", false);
      setContactoSubmitEnabled(false);
    } else {
      setContactoMsg("");
      setContactoSubmitEnabled(true);
    }
    openContactoModal();
  };

  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();

    if (!isVerified) {
      setContactoMsg("Debes estar verificado para enviar solicitudes.", false);
      return;
    }
    if (!contactEmail) {
      setContactoMsg("No tienes email de contacto configurado. Completa tu verificación primero.", false);
      return;
    }

    setContactoMsg("Enviando solicitud...", true);
    setContactoSubmitEnabled(false);

    try {
      // Evitar duplicados: docId estable = recruiterUid
      const reqRef = doc(db, "contact_requests", playerUid, "items", viewerUser.uid);
      const existing = await getDoc(reqRef);
      if (existing.exists()) {
        setContactoMsg("Ya enviaste una solicitud a este jugador.", false);
        setContactoSubmitEnabled(true);
        return;
      }

      const prof = await getProfileData(viewerUser.uid);
      const fromName = (`${prof.nombres || ""} ${prof.apellidos || ""}`).trim() || "Reclutador";
      const fromOrg = (prof.organizacion || "").toString().trim();
      const fromRole = (prof.rol || "").toString().trim();

      const message = (byId("contacto-mensaje")?.value || "").toString().trim();

      // 1) Crear request (esto YA te está funcionando)
await setDoc(reqRef, {
  fromUid: viewerUser.uid,
  fromName,
  fromOrg,
  fromRole,
  fromVerified: true,
  message,
  status: "pending",
  createdAt: serverTimestamp(),
});
console.log("[HN-contact] ✅ request creado:", reqRef.path);

closeContactoModal();
alert("✅ Solicitud enviada. El jugador podrá aceptarla o rechazarla.");


    } catch (err) {
      console.error(err);
      setContactoMsg("Error enviando solicitud. Revisa consola.", false);
      setContactoSubmitEnabled(true);
      alert(`Firebase error:\n${err.code || "sin-code"}\n${err.message || err}`);
    }
  };
}

// Escape básico para evitar inyección en innerHTML
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSolicitudCard({ playerUid, recruiterUid, data }) {
  const card = document.createElement("article");
  card.className = "post-card";

  const estado = (data.status || "pending").toString();
  const fromName = data.fromName || "Reclutador";
  const fromOrg = data.fromOrg || "—";
  const fromRole = data.fromRole || "—";
  const msg = (data.message || "").toString().trim();

  const statusLabel =
    estado === "accepted" ? "✅ Aceptada" :
    estado === "rejected" ? "❌ Rechazada" :
    "⏳ Pendiente";

  card.innerHTML = `
    <div class="post-meta">
      <span class="post-fecha">${statusLabel}</span>
      <span class="post-tipo">${escapeHtml(fromRole)} · ${escapeHtml(fromOrg)}</span>
    </div>
    <h3 class="post-titulo">
  <a class="solicitud-nombre-link" href="/html/perfilReclutador.html?uid=${encodeURIComponent(recruiterUid)}">
    ${escapeHtml(fromName)}
  </a>
</h3>

    ${msg ? `<p class="post-desc">${escapeHtml(msg)}</p>` : ""}
    <div class="post-acciones" style="display:flex; gap:10px; margin-top:10px;"></div>
    <div class="post-link" style="margin-top:10px;"></div>
  `;

  const acciones = card.querySelector(".post-acciones");
  const linkBox = card.querySelector(".post-link");

  if (estado === "pending") {
    const btnA = document.createElement("button");
    btnA.textContent = "Aceptar";
    btnA.type = "button";
    btnA.className = "btn-modal publicar";

    const btnR = document.createElement("button");
    btnR.textContent = "Rechazar";
    btnR.type = "button";
    btnR.className = "btn-modal cancelar";

    btnA.onclick = async () => {
      try {
        await updateDoc(doc(db, "contact_requests", playerUid, "items", recruiterUid), {
          status: "accepted",
          respondedAt: serverTimestamp(),
        });
        await loadSolicitudesContacto(playerUid);
      } catch (e) {
        console.error(e);
        alert("No se pudo aceptar. Revisa consola.");
      }
    };

    btnR.onclick = async () => {
  const reqRef = doc(db, "contact_requests", playerUid, "items", recruiterUid);

  try {
    // 1) Guardar rechazo (se mantiene en Firestore)
    await updateDoc(reqRef, {
      status: "rejected",
      respondedAt: serverTimestamp(),
    });

    // 2) Quitar de la UI inmediatamente (para que no “estorbe”)
    card.remove();

    updateSolicitudesBadgeFromDOM();

const list = byId("contacto-list");
const empty = byId("contacto-empty");
const left = list ? list.querySelectorAll(".post-card").length : 0;
if (empty) empty.style.display = left === 0 ? "block" : "none";


    // 3) Si quedó vacío, mostrar mensaje
    const listEl = byId("contacto-list");
    const emptyEl = byId("contacto-empty");
    if (listEl && emptyEl) {
      if (!listEl.querySelector(".post-card")) emptyEl.style.display = "block";
    }

    // 4) Toast con “Deshacer” por 10s
    showUndoToast({
      seconds: 10,
      onUndo: async () => {
        try {
          await updateDoc(reqRef, {
            status: "pending",
            
          });
          await loadSolicitudesContacto(playerUid);
        } catch (e) {
          console.error(e);
          alert("No se pudo deshacer. Revisa consola.");
        }
      },
    });

  } catch (e) {
    console.error(e);
    alert("No se pudo rechazar. Revisa consola.");
  }
};


    acciones.appendChild(btnR);
    acciones.appendChild(btnA);
  } else if (estado === "accepted") {
  linkBox.textContent = "⏳ Preparando contacto...";

  const rRef = doc(db, "contact_reveals", playerUid, "items", recruiterUid);
  const unsub = onSnapshot(rRef, (rSnap) => {
    if (!rSnap.exists()) {
      linkBox.textContent = "⏳ Preparando contacto...";
      return;
    }
    const email = (rSnap.data()?.recruiterEmail || "").toString().trim();
    linkBox.innerHTML = "";
    if (email) {
      const a = document.createElement("a");
      a.href = `mailto:${email}`;
      a.textContent = `📩 ${email}`;
      a.target = "_blank";
      a.rel = "noopener";
      linkBox.appendChild(a);
    } else {
      linkBox.textContent = "Contacto no disponible.";
    }
  });
}
  return card;
}

function showUndoToast({ seconds = 10, onUndo }) {
  // si ya hay uno, lo reemplaza
  const existing = document.getElementById("hn-undo-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "hn-undo-toast";
  toast.style.position = "fixed";
  toast.style.left = "18px";
  toast.style.right = "18px";
  toast.style.bottom = "18px";
  toast.style.zIndex = "99999";
  toast.style.background = "rgba(17, 24, 39, .96)";
  toast.style.color = "#fff";
  toast.style.padding = "12px 14px";
  toast.style.borderRadius = "14px";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.justifyContent = "space-between";
  toast.style.gap = "12px";
  toast.style.boxShadow = "0 18px 45px rgba(0,0,0,.28)";

  const msg = document.createElement("div");
  msg.style.fontWeight = "700";
  msg.textContent = `Solicitud rechazada.`;

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "10px";

  const countdown = document.createElement("span");
  countdown.style.opacity = "0.85";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Deshacer";
  btn.style.border = "0";
  btn.style.cursor = "pointer";
  btn.style.borderRadius = "999px";
  btn.style.padding = "8px 12px";
  btn.style.fontWeight = "800";
  btn.style.background = "#ff7a00";
  btn.style.color = "#111";

  right.appendChild(countdown);
  right.appendChild(btn);

  toast.appendChild(msg);
  toast.appendChild(right);
  document.body.appendChild(toast);

  let remaining = seconds;
  countdown.textContent = `${remaining}s`;

  // limpiar timer anterior si existía
  if (window.__HN_UNDO_TIMER) clearInterval(window.__HN_UNDO_TIMER);

  window.__HN_UNDO_TIMER = setInterval(() => {
    remaining--;
    countdown.textContent = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(window.__HN_UNDO_TIMER);
      window.__HN_UNDO_TIMER = null;
      toast.remove();
    }
  }, 1000);

  btn.onclick = async () => {
    try {
      if (window.__HN_UNDO_TIMER) {
        clearInterval(window.__HN_UNDO_TIMER);
        window.__HN_UNDO_TIMER = null;
      }
      toast.remove();
      await onUndo?.();
    } catch (e) {
      console.error(e);
    }
  };
}


async function loadSolicitudesContacto(playerUid) {
  const section = byId("contacto-section");
  const list = byId("contacto-list");
  const empty = byId("contacto-empty");

  if (!section || !list) return;

  section.style.display = "block";
  list.innerHTML = "";
  if (empty) empty.style.display = "none";

  try {
    const colRef = collection(db, "contact_requests", playerUid, "items");
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      if (empty) empty.style.display = "block";
      return;
    }

    let shown = 0;

snap.forEach((d) => {
  const data = d.data() || {};
  const status = (data.status || "pending").toString();

  // ✅ Estrategia A: mantener en Firestore, pero no mostrar rechazadas
  if (status === "rejected") return;

  shown++;
  list.appendChild(renderSolicitudCard({ playerUid, recruiterUid: d.id, data }));
});

if (shown === 0) {
  if (empty) empty.style.display = "block";
}
setSolicitudesBadge(shown);



  } catch (e) {
    console.error(e);
    if (empty) {
      empty.style.display = "block";
      empty.textContent = "Error cargando solicitudes. Revisa consola.";
    }
  }
}

function initHeaderMenu() {
  const wrap = document.getElementById("perfil-menu-wrap");
  const btnMenu = document.getElementById("btn-menu");
  const dropdown = document.getElementById("menu-dropdown");

  const menuEditar = document.getElementById("menu-editar");
  const menuLogout = document.getElementById("menu-logout");

  const btnEditarReal = document.getElementById("btn-editar-perfil");
  const btnLogoutReal = document.getElementById("btn-logout");

  if (!wrap || !btnMenu || !dropdown || !menuEditar || !menuLogout) return;

  function closeMenu() {
    dropdown.style.display = "none";
    btnMenu.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    const open = dropdown.style.display === "block";
    dropdown.style.display = open ? "none" : "block";
    btnMenu.setAttribute("aria-expanded", open ? "false" : "true");
  }

  // Disparan la lógica real (NO duplicamos lógica)
  menuEditar.addEventListener("click", () => {
    closeMenu();
    btnEditarReal?.click();
  });

  menuLogout.addEventListener("click", () => {
    closeMenu();
    btnLogoutReal?.click();
  });

  btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Click afuera
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeMenu();
  });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // Sincroniza qué items se ven según tu lógica actual (isOwner, etc.)
  window.syncHeaderMenu = function syncHeaderMenu() {
    const showEditar = btnEditarReal && btnEditarReal.style.display !== "none";
    const showLogout = btnLogoutReal && btnLogoutReal.style.display !== "none";

    menuEditar.style.display = showEditar ? "flex" : "none";
    menuLogout.style.display = showLogout ? "flex" : "none";

    // Si no hay nada que mostrar, escondemos el ⋮ completo
    btnMenu.style.display = (showEditar || showLogout) ? "inline-flex" : "none";
    closeMenu();
  };
}

function initAvatarUploader({ isOwner, uid }) {
  const btn = byId("btn-avatar-edit");
  const input = byId("avatar-file");

  if (!btn || !input) return;

  btn.style.display = isOwner ? "inline-flex" : "none";
  if (!isOwner) return;

  btn.onclick = () => input.click();

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    // Validaciones MVP
    if (!file.type.startsWith("image/")) {
      alert("Sube una imagen válida (JPG/PNG/WebP).");
      input.value = "";
      return;
    }
    const MAX = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX) {
      alert("La imagen es muy pesada. Máximo 2MB por ahora.");
      input.value = "";
      return;
    }

    btn.disabled = true;

    try {
      const path = `profile_photos/${uid}/avatar.jpg`;
      const ref = sRef(storage, path);

      await uploadBytes(ref, file, {
        contentType: file.type,
        cacheControl: "public,max-age=300"
      });

      const url = await getDownloadURL(ref);

      // Guardar URL en profiles/{uid}
      await setDoc(doc(db, "profiles", uid), {
        photoURL: url,
        photoVersion: Date.now()
      }, { merge: true });

      // Pintar inmediatamente
      paintAvatar({ photoURL: url, photoVersion: Date.now() });

    } catch (e) {
      console.error(e);
      alert("No se pudo subir la foto. Revisa consola / rules de Storage.");
    } finally {
      btn.disabled = false;
      input.value = "";
    }
  };
}



document.addEventListener("DOMContentLoaded", () => {
  wireLogout();
  initHeaderMenu();


  onAuthStateChanged(auth, async (user) => {
    const uidFromQuery = getUidFromQuery();
    const uidToLoad = uidFromQuery || (user ? user.uid : "");

    // ✅ Guard de rol: si es "mi perfil" (sin ?uid=), solo players pueden entrar aquí
    if (user && !uidFromQuery) {
      const myRole = await getRole(user.uid);
      if (myRole !== "player") {
        window.location.href = "/html/perfilReclutador.html";
        return;
      }
    }

    // Si NO hay uid en query y no hay user => login
    if (!uidToLoad) {
      window.location.href = "/html/login.html";
      return;
    }

    const signedIn = !!user;
    const isOwner = signedIn && (user.uid === uidToLoad);

    // ✅ Contexto que perfilPublicaciones.js está esperando:
    window.__HN_PROFILE_UID = uidToLoad;
    window.__HN_IS_OWNER = isOwner;
    window.__HN_SIGNED_IN = signedIn;

    setOwnerUI(isOwner, signedIn);
    initPerfilTabs(isOwner);
    initRetosParticipados({ playerUid: uidToLoad, signedIn });
    initAvatarUploader({ isOwner, uid: uidToLoad });

    if (window.syncHeaderMenu) window.syncHeaderMenu();



    const btnEditar = byId("btn-editar-perfil");
    if (btnEditar) {
      btnEditar.onclick = () => {
        if (!isOwner) return;
        window.location.href = "/html/editarJugador.html";
      };
    }

    await initFavoritos({ viewerUser: user, playerUid: uidToLoad, isOwner });
    await initContacto({ viewerUser: user, playerUid: uidToLoad, isOwner });

    try {
      await loadProfile(uidToLoad);
      await paintPlayerEmailForViewer({ playerUid: uidToLoad, viewerUser: user, isOwner });
      listenProfileScore(uidToLoad);

      if (isOwner) await loadSolicitudesContacto(uidToLoad);
    } catch (err) {
      console.error(err);
      const elError = byId("error-perfil");
      if (elError) elError.style.display = "block";
      alert("No se pudo cargar el perfil. Revisa consola.");
    }
  });
});
