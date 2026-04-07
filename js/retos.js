// /js/retos.js (MODULE) - Paso 3: crear retos + subir intentos + recruiter revisa intentos

import { auth, db, storage } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  getDoc,
  getDocs,
  doc,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";
import { normalizeDifficulty, basePointsForDifficulty } from "/js/puntos.js";

import {
  reserveChallengeUploadSlot,
  uploadVideoToReservedPath,
  finalizeReservedChallengeUpload,
  cleanupUploadedVideo,
  normalizeCallableError,
} from "./videoUploadQuota.js";



document.addEventListener("DOMContentLoaded", () => {
  // ===== UI TOP =====
  const btnLogout = document.getElementById("btn-logout");

  const btnCrear = document.getElementById("btn-abrir-crear-reto");
  const hintCrear = document.getElementById("hint-crear-reto");

  const inputBusqueda = document.getElementById("filtro-busqueda");
  const selectDificultad = document.getElementById("filtro-dificultad");
  const selectEstado = document.getElementById("filtro-estado");
  const btnLimpiar = document.getElementById("btn-limpiar-filtros");

  const retosGrid = document.getElementById("retos-grid");
  const emptyMsg = document.getElementById("retos-empty");

  // ===== MODALES =====
  const overlayDetalle = document.getElementById("modal-reto-overlay");
  const overlayCrear = document.getElementById("modal-crear-overlay");
  const overlayIntento = document.getElementById("modal-intento-overlay");

  const btnCerrarDetalle = document.getElementById("btn-cerrar-reto");
  const btnCerrarDetalle2 = document.getElementById("btn-cerrar-reto-2");
  const btnCerrarCrear = document.getElementById("btn-cerrar-crear");
  const btnCancelarCrear = document.getElementById("btn-cancelar-crear");
  const btnCerrarIntento = document.getElementById("btn-cerrar-intento");
  const btnCancelarIntento = document.getElementById("btn-cancelar-intento");

  // ===== DETALLE =====
  const detalleTitulo = document.getElementById("detalle-titulo");
  const detalleReglas = document.getElementById("detalle-reglas");
  const detalleBadge = document.getElementById("detalle-badge");
  const detalleCierre = document.getElementById("detalle-cierre");
  const detalleCupos = document.getElementById("detalle-cupos");
  const detalleCreador = document.getElementById("detalle-creador");

  const btnParticipar = document.getElementById("btn-participar");
  const hintParticipar = document.getElementById("hint-participar");

  // (Opcional) panel intentos en el modal detalle (para recruiter)
  const intentosPanel = document.getElementById("detalle-intentos-panel");
  const intentosList = document.getElementById("detalle-intentos-list");
  const intentosEmpty = document.getElementById("detalle-intentos-empty");

  // ===== FORM CREAR =====
  const formCrear = document.getElementById("form-crear-reto");
  const crearTitulo = document.getElementById("crear-titulo");
  const crearReglas = document.getElementById("crear-reglas");
  const crearDificultad = document.getElementById("crear-dificultad");
  const crearCupos = document.getElementById("crear-cupos");
  const crearCierreDias = document.getElementById("crear-cierre-dias");
  const crearError = document.getElementById("crear-error");

  // ===== FORM INTENTO =====
  const formIntento = document.getElementById("form-intento");
  const intentoFile = document.getElementById("intento-video");
  const intentoError = document.getElementById("intento-error");
  const intentoUploadWrap = document.getElementById("intento-upload-wrap");
  const intentoUploadBar = document.getElementById("intento-upload-bar");
  const intentoUploadTexto = document.getElementById("intento-upload-texto");

  
// ===== Modal Ver Video (reutilizable, estilo feed) =====
const modalVideoOverlay = document.getElementById("modal-video-overlay");
const modalVideoPlayer  = document.getElementById("modal-video-player");
const btnCerrarVideo    = document.getElementById("btn-cerrar-video");



function openVideoModal(url) {
  if (!modalVideoOverlay || !modalVideoPlayer) {
    console.warn("Modal de video no existe en el HTML (modal-video-overlay / modal-video-player).");
    return;
  }
  modalVideoPlayer.src = url;
  modalVideoOverlay.style.display = "flex"; // o "block" si tu CSS no usa flex
  // opcional: intentar autoplay
  modalVideoPlayer.play?.().catch(() => {});
}

function closeVideoModal() {
  if (!modalVideoOverlay || !modalVideoPlayer) return;
  modalVideoPlayer.pause?.();
  modalVideoPlayer.removeAttribute("src");
  modalVideoPlayer.load?.();
  modalVideoOverlay.style.display = "none";
}

// Botón cerrar
btnCerrarVideo?.addEventListener("click", closeVideoModal);

// Click fuera (overlay)
modalVideoOverlay?.addEventListener("click", (e) => {
  if (e.target === modalVideoOverlay) closeVideoModal();
});

// Esc
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalVideoOverlay?.style.display !== "none") {
    closeVideoModal();
  }
});


  // ===== ESTADO =====
  let currentUser = null;
  let currentRole = null; // "player" | "recruiter" | null
  let myProfile = null;

  let allChallenges = [];
  const challengeMap = new Map(); // id -> data

  let selectedChallengeId = null;
  let unsubscribeIntentos = null;

  const __autoOpenId = new URLSearchParams(window.location.search).get("open");
let __autoOpened = false;




async function abrirVideoSubmission(sub) {
  try {
    // ✅ Preferir videoPath (genera downloadURL con SDK autenticado)
    if (sub.videoPath) {
      const url = await getDownloadURL(storageRef(storage, sub.videoPath));
      openVideoModal(url);
      return;
    }

    // Fallback si tienes un URL ya usable
    if (sub.videoUrl) {
      openVideoModal(sub.videoUrl);
      return;
    }

    alert("Este intento no tiene videoPath/videoUrl válido.");
  } catch (e) {
    console.error("Error abriendo video:", e);
    alert("No pude abrir el video (permiso/URL). Revisa consola.");
  }
}


  // ===== Helpers =====
  function openOverlay(ov) { if (ov) ov.style.display = "flex"; }
  function closeOverlay(ov) { if (ov) ov.style.display = "none"; }

  function closeAll() {
    closeOverlay(overlayDetalle);
    closeOverlay(overlayCrear);
    closeOverlay(overlayIntento);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });

  [overlayDetalle, overlayCrear, overlayIntento].forEach((ov) => {
    if (!ov) return;
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeOverlay(ov);
    });
  });

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

 

  function setCrearError(msg) {
    if (!crearError) return;
    crearError.textContent = msg || "";
    crearError.style.display = msg ? "block" : "none";
  }

  function setIntentoError(msg) {
    if (!intentoError) return;
    intentoError.textContent = msg || "";
    intentoError.style.display = msg ? "block" : "none";
  }

  function setUploadProgress(pct) {
    if (intentoUploadWrap) intentoUploadWrap.style.display = "block";
    if (intentoUploadBar) intentoUploadBar.value = Math.max(0, Math.min(100, Math.round(pct)));
    if (intentoUploadTexto) intentoUploadTexto.textContent = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
  }

  function resetUploadUI() {
    if (intentoUploadWrap) intentoUploadWrap.style.display = "none";
    if (intentoUploadBar) intentoUploadBar.value = 0;
    if (intentoUploadTexto) intentoUploadTexto.textContent = "0%";
  }

  function badgeInfo(difficulty) {
    if (difficulty === "easy") return { text: "Fácil", cls: "badge badge-easy" };
    if (difficulty === "hard") return { text: "Difícil", cls: "badge badge-hard" };
    return { text: "Media", cls: "badge badge-medium" };
  }

  function isClosedChallenge(ch) {
  const status = String(ch.status || "active");
  const closesMs = ch.closesAt?.toDate ? ch.closesAt.toDate().getTime() : null;
  const closedByTime = closesMs ? closesMs <= Date.now() : false;

  const slots = Number(ch.slots || 0);
  const used  = Number(ch.slotsUsed || 0);
  const closedBySlots = slots > 0 && used >= slots;

  return status === "closed" || closedByTime || closedBySlots;
}


  function cierreTexto(closesAt) {
    if (!closesAt) return "Cierre —";
    const d = closesAt.toDate ? closesAt.toDate() : new Date(closesAt);
    const diffMs = d.getTime() - Date.now();
    if (diffMs <= 0) return "Cerrado";
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 1) return "Cierra hoy";
    return `Cierra en ${days} días`;
  }

  async function getMyRole(uid) {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      return snap.exists() ? snap.data()?.role : null;
    } catch (e) {
      console.error("Error leyendo role:", e);
      return null;
    }
  }

  async function loadMyProfile(uid) {
    try {
      const snap = await getDoc(doc(db, "profiles", uid));
      myProfile = snap.exists() ? snap.data() : null;
    } catch (e) {
      console.error("Error leyendo profile:", e);
      myProfile = null;
    }
  }

  function getDisplayNameFallback() {
    const full = myProfile
      ? `${(myProfile.nombres || "").trim()} ${(myProfile.apellidos || "").trim()}`.trim()
      : "";
    if (full) return full;

    const org = myProfile?.organizacion || myProfile?.orgName || myProfile?.club || "";
    if (org) return String(org);

    return currentUser?.email || "Usuario";
  }

  function fileExtFrom(file) {
    const name = String(file?.name || "");
    const dot = name.lastIndexOf(".");
    if (dot !== -1 && dot < name.length - 1) {
      const ext = name.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{1,6}$/.test(ext)) return ext;
    }
    const mime = String(file?.type || "");
    if (mime === "video/mp4") return "mp4";
    if (mime === "video/webm") return "webm";
    if (mime === "video/quicktime") return "mov";
    return "mp4";
  }

  const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
  function validateVideoFile(file) {
    if (!file) return "Selecciona un archivo de video.";
    if (!String(file.type || "").startsWith("video/")) return "El archivo debe ser un video (mp4, mov, webm, etc.).";
    if (file.size > MAX_VIDEO_BYTES) return "El video es muy pesado. Máximo 50 MB por ahora.";
    return "";
  }

  // ===== Render cards =====
  function buildCard(ch) {
    const { text, cls } = badgeInfo(ch.difficulty);
    const cardClass = ch.__isClosed ? "reto-card is-closed" : "reto-card";
    const slots = typeof ch.slots === "number" ? ch.slots : null;
  const used  = typeof ch.slotsUsed === "number" ? ch.slotsUsed : 0;
  const remaining = (slots == null) ? "—" : Math.max(0, slots - used);

    return `
      <article class="${cardClass}" data-id="${escapeHtml(ch.id)}">
        <div class="reto-top">
          <span class="${cls}">${text}</span>
          <span class="meta"><i class="fa-regular fa-clock"></i> ${escapeHtml(cierreTexto(ch.closesAt))}</span>
        </div>

        <h3 class="reto-title">${escapeHtml(ch.title || "Reto")}</h3>
        <p class="reto-desc">${escapeHtml(ch.rules || "")}</p>

        <div class="reto-bottom">
          <div class="reto-stats">
            <span><i class="fa-solid fa-users"></i> Cupos: ${escapeHtml(remaining)} / ${escapeHtml(slots ?? "—")}</span>
            <span>
  <i class="fa-solid fa-user-tie"></i>
  <a class="link-recruiter"
     href="perfilReclutador.html?uid=${encodeURIComponent(ch.createdByUid || "")}">
     ${escapeHtml(ch.createdByName || "Reclutador")}
  </a>
</span>

          </div>

          <button class="btn-secondary btn-ver-reto" type="button">Ver reto</button>
        </div>
      </article>
    `;
  }

  function applyFiltersAndRender() {
    if (!retosGrid) return;

    const q = (inputBusqueda?.value || "").trim().toLowerCase();
    const dif = (selectDificultad?.value || "").trim();   // "" | easy | medium | hard
    const est = (selectEstado?.value || "active").trim(); // active | closed

    const filtered = allChallenges
      .filter((ch) => {
        const title = String(ch.title || "").toLowerCase();
        const rules = String(ch.rules || "").toLowerCase();

        if (q && !(title.includes(q) || rules.includes(q))) return false;
        if (dif && ch.difficulty !== dif) return false;

        const isClosed = !!ch.__isClosed;
        if (est === "active" && isClosed) return false;
        if (est === "closed" && !isClosed) return false;

        return true;
      })
      .sort((a, b) => {
        // Activos: los que cierran más pronto arriba
        if (est === "active") {
          const aClose = a.closesAt?.toDate ? a.closesAt.toDate().getTime() : Infinity;
          const bClose = b.closesAt?.toDate ? b.closesAt.toDate().getTime() : Infinity;
          if (aClose !== bClose) return aClose - bClose;
        }
        // fallback: más nuevos arriba
        const aCreated = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const bCreated = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return bCreated - aCreated;
      });

    retosGrid.innerHTML = filtered.map(buildCard).join("");
    if (emptyMsg) emptyMsg.style.display = filtered.length ? "none" : "block";
  }

  function wireFilters() {
    if (inputBusqueda) inputBusqueda.addEventListener("input", applyFiltersAndRender);
    if (selectDificultad) selectDificultad.addEventListener("change", applyFiltersAndRender);
    if (selectEstado) selectEstado.addEventListener("change", applyFiltersAndRender);

    if (btnLimpiar) {
      btnLimpiar.addEventListener("click", () => {
        if (inputBusqueda) inputBusqueda.value = "";
        if (selectDificultad) selectDificultad.value = "";
        if (selectEstado) selectEstado.value = "active";
        applyFiltersAndRender();
      });
    }
  }

  // ===== Subscribe retos =====
  function subscribeChallenges() {
    const qy = query(collection(db, "challenges"), orderBy("createdAt", "desc"));

    onSnapshot(
      qy,
      (snap) => {
        allChallenges = snap.docs.map((d) => {
          const data = d.data() || {};
          const ch = { id: d.id, ...data };
          ch.__isClosed = isClosedChallenge(ch);
          challengeMap.set(d.id, ch);
          return ch;
        });
        applyFiltersAndRender();
        if (__autoOpenId && !__autoOpened && challengeMap.has(__autoOpenId)) {
  __autoOpened = true;
  openDetalleById(__autoOpenId);
}

      },
      (err) => {
        console.error(err);
        if (retosGrid) retosGrid.innerHTML = `<p style="color:#fecaca">Error cargando retos. Revisa consola / rules.</p>`;
      }
    );
  }

  // ===== Detalle =====
  async function countSubmissions(challengeId) {
  // ✅ Players NO deberían listar submissions globales (rules lo bloquean)
  if (currentRole === "player") return null;

  const ch = challengeMap.get(challengeId);

  const canSeeAll =
    currentRole === "recruiter" &&
    currentUser?.uid &&
    ch?.createdByUid === currentUser.uid;

  // Si no es el creador, no cuentes (evita permission denied)
  if (!canSeeAll) return null;

  const qy = query(
    collection(db, "challenge_submissions"),
    where("challengeId", "==", challengeId)
  );

  const snap = await getDocs(qy);
  return snap.size || 0;
}


  function stopIntentosLive() {
    if (unsubscribeIntentos) {
      unsubscribeIntentos();
      unsubscribeIntentos = null;
    }
  }

function renderIntentosList(subs, canReview) {
  if (!intentosPanel || !intentosList) return;

  intentosPanel.style.display = "block";

  if (!subs.length) {
    intentosList.innerHTML = "";
    if (intentosEmpty) intentosEmpty.style.display = "block";
    return;
  }
  if (intentosEmpty) intentosEmpty.style.display = "none";

  const rows = subs.map((s) => {
    // Normaliza estados viejos -> nuevos
    const raw = String(s.status || "pending");
    const status =
      raw === "approved" ? "accepted" :
      raw === "rejected" ? "rejected" :
      raw === "accepted" ? "accepted" :
      "pending";

    const statusText =
      status === "accepted" ? "Aceptada" :
      status === "rejected" ? "Rechazada" :
      "Pendiente";

    const when = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString() : "";

    return `
      <div class="intento-item" data-subid="${escapeHtml(s.id)}" data-status="${escapeHtml(status)}">
        <div class="intento-left">
            <div class="intento-title">
              ${
                s.playerUid
                  ? `<a class="link-player" href="perfilJugador.html?uid=${encodeURIComponent(s.playerUid)}">${escapeHtml(s.playerName || "Jugador")}</a>`
                  : `${escapeHtml(s.playerName || "Jugador")}`
              }
              <span class="badge ${escapeHtml(status)}">${escapeHtml(statusText)}</span>
            </div>
          <div class="intento-meta">
            ${when ? `<span><i class="fa-regular fa-clock"></i> ${escapeHtml(when)}</span>` : ""}
          </div>
        </div>

        <div class="intento-actions">
          <button
            type="button"
            class="btn-mini btn-secondary btn-ver-video"
            data-videourl="${escapeHtml(s.videoUrl || "")}"
            data-videopath="${escapeHtml(s.videoPath || "")}"
          >
            Ver video
          </button>

          ${ (canReview && status === "pending") ? `
  <button type="button" class="btn-mini btn-secondary btn-aprobar">Aceptar</button>
  <button type="button" class="btn-mini btn-secondary btn-rechazar">Rechazar</button>
` : "" }

        </div>
      </div>
    `;
  });

  intentosList.innerHTML = rows.join("");
}


function liveIntentosForChallenge(challengeId, challengeCreatorUid) {
  stopIntentosLive();
  if (!intentosPanel || !intentosList) return;

  const isSigned = !!currentUser?.uid;
  if (!isSigned) {
    intentosPanel.style.display = "none";
    return;
  }

  // ✅ Solo el creador (recruiter) revisa
  const canReview =
    currentRole === "recruiter" && currentUser.uid === challengeCreatorUid;

  // UI base
  intentosPanel.style.display = "block";
  const titleEl = intentosPanel.querySelector("h3");
  if (titleEl) titleEl.textContent = "Intentos";

  if (intentosEmpty) {
    intentosEmpty.style.display = "none";
    intentosEmpty.textContent = "Aún no hay intentos para este reto.";
  }

  // Query: todos los intentos del reto
  const qy = query(
    collection(db, "challenge_submissions"),
    where("challengeId", "==", challengeId)
  );

  unsubscribeIntentos = onSnapshot(
    qy,
    (snap) => {
      const subs = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => {
          const at = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const bt = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return bt - at;
        });

      renderIntentosList(subs, canReview);

      // ✅ Si soy jugador: si ya envié intento, deshabilito participar + hint correcto
      if (currentRole === "player" && btnParticipar) {
        const mine = subs.find(s => s.playerUid === currentUser.uid);

        // guarda texto original una vez
        if (!btnParticipar.dataset.defaultText) {
          btnParticipar.dataset.defaultText = btnParticipar.textContent?.trim() || "Participar";
        }
        const defaultText = btnParticipar.dataset.defaultText;

        if (!mine) {
          btnParticipar.disabled = false;
          btnParticipar.textContent = defaultText;
          btnParticipar.style.opacity = "";

          if (hintParticipar) hintParticipar.style.display = "none";
        } else {
          // normaliza status por compatibilidad
          const raw = String(mine.status || "pending");
          const st = raw === "approved" ? "accepted" : raw;

          btnParticipar.disabled = true;
          btnParticipar.textContent = "Ya enviaste tu intento";
          btnParticipar.style.opacity = "0.7";

          if (hintParticipar) {
            hintParticipar.style.display = "block";
            hintParticipar.textContent =
              st === "accepted" ? "✅ Tu intento fue aceptado." :
              st === "rejected" ? "❌ Tu intento fue rechazado." :
              "⏳ Tu intento está en revisión.";
          }
        }
      }
    },
    (err) => {
      console.error(err);
      intentosPanel.style.display = "block";
      intentosList.innerHTML = `<p style="color:#fecaca;margin:0;">No se pudieron cargar intentos.</p>`;
    }
  );
}

  async function openDetalleById(id) {
    const ch = challengeMap.get(id);
    liveIntentosForChallenge(id, ch.createdByUid);
    if (!ch) return;

    selectedChallengeId = id;

    const { text, cls } = badgeInfo(ch.difficulty);

    if (detalleTitulo) detalleTitulo.textContent = ch.title || "Reto";
    if (detalleReglas) detalleReglas.textContent = ch.rules || "";
    if (detalleBadge) {
      detalleBadge.className = cls;
      detalleBadge.textContent = text;
    }
    if (detalleCierre) detalleCierre.textContent = cierreTexto(ch.closesAt);
    if (detalleCupos) detalleCupos.textContent = String(ch.slots ?? "—");
    if (detalleCreador) {
  const name = ch.createdByName || "Reclutador";
  const uid = ch.createdByUid || "";
  if (uid) {
    detalleCreador.innerHTML =
      `<a class="link-recruiter" href="perfilReclutador.html?uid=${encodeURIComponent(uid)}">${escapeHtml(name)}</a>`;
  } else {
    detalleCreador.textContent = name;
  }
}


    // Player: mostrar/ocultar participar
    if (ch.__isClosed) {
      if (btnParticipar) btnParticipar.style.display = "none";
      if (hintParticipar) {
        hintParticipar.style.display = "block";
        hintParticipar.textContent = "Este reto ya cerró.";
      }
    } else if (currentRole === "player") {
      // check cupos (best effort)
      try {
        const used = await countSubmissions(id);
        if (typeof ch.slots === "number" && ch.slots > 0 && used >= ch.slots) {
          if (btnParticipar) btnParticipar.style.display = "none";
          if (hintParticipar) {
            hintParticipar.style.display = "block";
            hintParticipar.textContent = "Cupos llenos.";
          }
        } else {
          if (btnParticipar) btnParticipar.style.display = "inline-flex";
          if (hintParticipar) hintParticipar.style.display = "none";
        }
      } catch {
        if (btnParticipar) btnParticipar.style.display = "inline-flex";
        if (hintParticipar) hintParticipar.style.display = "none";
      }
    } else {
      if (btnParticipar) btnParticipar.style.display = "none";
      if (hintParticipar) {
        hintParticipar.style.display = "block";
        hintParticipar.textContent = "Solo jugadores pueden participar.";
      }
    }

    // Recruiter: ver intentos en el mismo modal (si el panel existe)
    // Panel intentos: recruiter creador ve todos / jugador ve el suyo
if (intentosPanel) {
  liveIntentosForChallenge(id, ch.createdByUid);
}


    openOverlay(overlayDetalle);
  }

  // click en cards
  if (retosGrid) {
    retosGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-ver-reto");
      if (!btn) return;
      const card = btn.closest(".reto-card");
      const id = card?.dataset?.id;
      if (id) openDetalleById(id);
    });
  }

  // Approve/Reject (recruiter) dentro del panel intentos
  // Approve/Reject + Ver video (recruiter) dentro del panel intentos
if (intentosList) {
  intentosList.addEventListener("click", async (e) => {
    const wrap = e.target.closest(".intento-item");
    if (!wrap) return;

    // ✅ VER VIDEO
    const btnVer = e.target.closest(".btn-ver-video");
    if (btnVer) {
      const sub = {
        videoUrl: btnVer.dataset.videourl || "",
        videoPath: btnVer.dataset.videopath || "",
      };
      abrirVideoSubmission(sub);
      return;
    }

    // ✅ ACEPTAR / RECHAZAR
    const btnAceptar = e.target.closest(".btn-aprobar");
    const btnRechazar = e.target.closest(".btn-rechazar");
    if (!btnAceptar && !btnRechazar) return;

    const subId = wrap.dataset.subid;
    if (!subId) return;

    // si ya no está pending, no hagas nada
    if ((wrap.dataset.status || "pending") !== "pending") return;

    const newStatus = btnAceptar ? "accepted" : "rejected";

    // anti doble click
    if (btnAceptar) btnAceptar.disabled = true;
    if (btnRechazar) btnRechazar.disabled = true;

    const ch = challengeMap.get(selectedChallengeId);
    const difficultyKey = normalizeDifficulty(ch?.difficulty);
    const basePoints = basePointsForDifficulty(difficultyKey);


    try {
      const subRef = doc(db, "challenge_submissions", subId);

      await updateDoc(subRef, {
  status: newStatus,
  reviewedByUid: currentUser?.uid || null,
  reviewedByName: getDisplayNameFallback(),
  reviewedAt: serverTimestamp(),

  // ✅ rellena para puntos (sirve para docs viejos)
  ...(difficultyKey ? { difficultyKey } : {}),
  ...(basePoints ? { basePoints } : {}),
  ...(newStatus === "accepted" ? { acceptedAt: serverTimestamp() } : {}),
});
;

      // feedback inmediato (igual onSnapshot lo va a refrescar)
      wrap.dataset.status = newStatus;
      const badge = wrap.querySelector(".badge");
      if (badge) {
        badge.classList.remove("pending", "accepted", "rejected");
        badge.classList.add(newStatus);
        badge.textContent = newStatus === "accepted" ? "Aceptada" : "Rechazada";
      }

  wrap.querySelector(".btn-aprobar")?.remove();
  wrap.querySelector(".btn-rechazar")?.remove();

    } catch (err) {
      console.error(err);
      alert("No se pudo actualizar el estado. Revisa rules / consola.");

      // re-habilita si falló
      if (btnAceptar) btnAceptar.disabled = false;
      if (btnRechazar) btnRechazar.disabled = false;
    }
  });
}


  // ===== Crear reto =====
  async function createChallengeFromForm() {
    if (!currentUser) throw new Error("No hay sesión.");
    if (currentRole !== "recruiter") throw new Error("Solo reclutadores pueden crear retos.");

    const title = (crearTitulo?.value || "").trim();
    const rules = (crearReglas?.value || "").trim();
    const difficulty = (crearDificultad?.value || "medium").trim();
    const slots = Number(crearCupos?.value || 0);
    const days = Number(crearCierreDias?.value || 7);

    if (!title || !rules) throw new Error("Completa título y reglas.");
    if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error("Dificultad inválida.");
    if (!Number.isFinite(slots) || slots <= 0) throw new Error("Cupos debe ser un número mayor a 0.");
    if (!Number.isFinite(days) || days <= 0 || days > 30) throw new Error("Cierre (días) debe estar entre 1 y 30.");

    const closesAt = Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

    await addDoc(collection(db, "challenges"), {
  title,
  rules,
  difficulty,            // "easy" | "medium" | "hard"
  slots,
  slotsUsed: 0,
  status: "active",
  createdAt: serverTimestamp(),
  closesAt,
  createdByUid: currentUser.uid,
  createdByName: getDisplayNameFallback(),
});


  }

  if (btnCrear) {
    btnCrear.addEventListener("click", () => {
      setCrearError("");
      openOverlay(overlayCrear);
    });
  }

  if (btnCerrarCrear) btnCerrarCrear.addEventListener("click", () => closeOverlay(overlayCrear));
  if (btnCancelarCrear) btnCancelarCrear.addEventListener("click", () => closeOverlay(overlayCrear));
  if (btnCerrarDetalle) btnCerrarDetalle.addEventListener("click", () => closeOverlay(overlayDetalle));
  if (btnCerrarDetalle2) btnCerrarDetalle2.addEventListener("click", () => closeOverlay(overlayDetalle));
  if (btnCerrarIntento) btnCerrarIntento.addEventListener("click", () => closeOverlay(overlayIntento));
  if (btnCancelarIntento) btnCancelarIntento.addEventListener("click", () => closeOverlay(overlayIntento));

  if (formCrear) {
    formCrear.addEventListener("submit", async (e) => {
      e.preventDefault();
      setCrearError("");

      try {
        await createChallengeFromForm();
        formCrear.reset();
        closeOverlay(overlayCrear);
      } catch (err) {
        console.error(err);
        setCrearError(err?.message || "No se pudo crear el reto. Revisa consola / rules.");
      }
    });
  }

  // ===== Participar (player) =====
  if (btnParticipar) {
    btnParticipar.addEventListener("click", async () => {
      if (!selectedChallengeId) return;
      setIntentoError("");
      resetUploadUI();

      // Validación rápida de cupos (best effort)
      try {
        const ch = challengeMap.get(selectedChallengeId);
        const used = await countSubmissions(selectedChallengeId);
        if (ch && typeof ch.slots === "number" && ch.slots > 0 && used >= ch.slots) {
          setIntentoError("Cupos llenos.");
          return;
        }
      } catch {}

      openOverlay(overlayIntento);
    });
  }



if (formIntento) {
  formIntento.addEventListener("submit", async (e) => {
    e.preventDefault();
    setIntentoError("");

    if (!currentUser) return setIntentoError("Debes iniciar sesión.");
    if (currentRole !== "player") return setIntentoError("Solo jugadores pueden participar.");
    if (!selectedChallengeId) return setIntentoError("Reto inválido.");

    const file = intentoFile?.files?.[0];
    const vErr = validateVideoFile(file);
    if (vErr) return setIntentoError(vErr);

    const challengeId = selectedChallengeId;

    const btnSubmit = formIntento.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.disabled = true;
    if (intentoFile) intentoFile.disabled = true;

    let uploaded = null;

    try {
      resetUploadUI();

      const ticket = await reserveChallengeUploadSlot(challengeId);

      uploaded = await uploadVideoToReservedPath({
        videoPath: ticket.videoPath,
        file,
        onProgress: setUploadProgress,
      });

      await finalizeReservedChallengeUpload({
        ticketId: ticket.ticketId,
        videoPath: uploaded.fullPath,
      });

      if (formIntento) formIntento.reset();
      resetUploadUI();
      closeOverlay(overlayIntento);
      alert("Intento enviado ✅");
    } catch (err) {
      console.error(err);

      if (uploaded?.ref) await cleanupUploadedVideo(uploaded.ref);

      setIntentoError(
        normalizeCallableError(
          err,
          "Se agotaron tus subidas de videos semanales."
        )
      );
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
      if (intentoFile) intentoFile.disabled = false;
    }
  });
}

  // ===== Logout =====
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/html/login.html";
      } catch (e) {
        console.error(e);
      }
    });
  }

  // ===== Auth =====
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (!user) {
      if (btnCrear) btnCrear.style.display = "none";
      if (hintCrear) hintCrear.style.display = "none";
      if (retosGrid) retosGrid.innerHTML = "<p>Debes iniciar sesión.</p>";
      return;
    }

    currentRole = await getMyRole(user.uid);
    await loadMyProfile(user.uid);

    // Permisos UI (crear reto solo recruiters)
    if (currentRole === "recruiter") {
      if (btnCrear) btnCrear.style.display = "inline-flex";
      if (hintCrear) hintCrear.style.display = "none";
    } else {
      if (btnCrear) btnCrear.style.display = "none";
      if (hintCrear) hintCrear.style.display = "none";
    }

    wireFilters();
    subscribeChallenges();
  });
});
