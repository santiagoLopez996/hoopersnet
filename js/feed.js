// /js/feed.js (MODULE) - Feed real desde Firestore + crear/eliminar posts + reportes a Firestore
import { auth, db } from "./firebase-init.js";
import { onPostDeleted } from "./puntosPublicaciones.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  setDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

import {
  reservePostUploadSlot,
  uploadVideoToReservedPath,
  finalizeReservedPostUpload,
  cleanupUploadedVideo,
  normalizeCallableError,
} from "./videoUploadQuota.js";


document.addEventListener("DOMContentLoaded", () => {
  // ---------- UI PUBLICACIONES ----------
  const btnAbrir = document.getElementById("btn-abrir-modal");
  const btnCerrar = document.getElementById("btn-cerrar-modal");
  const overlay = document.getElementById("modal-overlay");
  const form = document.getElementById("form-publicacion");
  const errorMsg = document.getElementById("modal-error");

  const inputVideo = document.getElementById("video-publicacion");
  const uploadWrap = document.getElementById("upload-wrap");
  const uploadBar = document.getElementById("upload-progreso");
  const uploadTexto = document.getElementById("upload-texto");

  const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
  const storage = getStorage();

  const contenedorFeed =
    document.getElementById("feed-contenido") || document.querySelector(".feed-contenido");

  // ---------- UI FILTROS (modal explorar) ----------
  const btnExplorar = document.getElementById("btn-explorar");
  const overlayFiltros = document.getElementById("modal-overlay-filtros");
  const btnCerrarFiltros = document.getElementById("btn-cerrar-filtros");
  const formFiltros = document.getElementById("filtros-jugadores");
  const btnResetFiltros = document.getElementById("filtro-reset");
  const btnBuscarFiltros = document.getElementById("filtro-buscar");

  const inputFiltroNombre = document.getElementById("filtro-nombre");
  const selectFiltroPosicion = document.getElementById("filtro-posicion");
  const selectFiltroCiudad = document.getElementById("filtro-ciudad");
  const selectFiltroNivel = document.getElementById("filtro-nivel");

  // ---------- UI REPORTE ----------
  const overlayReporte = document.getElementById("modal-overlay-reportar");
  const btnCerrarReporte = document.getElementById("btn-cerrar-reportar");
  const btnCancelarReporte = document.getElementById("btn-cancelar-reporte");
  const formReporte = document.getElementById("form-reporte");
  const selectMotivo = document.getElementById("motivo-reporte");
  const textareaComentarios = document.getElementById("comentarios-reporte");
  const mensajeReporte = document.getElementById("mensaje-reporte");

  // Estado
  let currentUser = null;
  let currentRole = null; // "player" | "recruiter" | null
  let myProfile = null; // datos del perfil del usuario logueado (para autor)
  let postSeleccionadoParaReporte = null; // {postId, ownerUid, titulo, link, ...}
  let unsubscribeFeed = null;

  // ----- MODAL VIDEO -----
const videoOverlay = document.getElementById("modal-video-overlay");
const videoPlayer = document.getElementById("modal-video-player");
const btnCerrarVideo = document.getElementById("btn-cerrar-video");

function abrirModalVideo(url) {
  if (!videoOverlay || !videoPlayer) return;
  videoPlayer.src = url;
  videoOverlay.style.display = "flex";
  videoOverlay.classList.add("visible"); // por si ya usas esta clase en otros modales
  setTimeout(() => videoPlayer.play().catch(() => {}), 0);
}

function cerrarModalVideo() {
  if (!videoOverlay || !videoPlayer) return;
  videoPlayer.pause();
  videoPlayer.removeAttribute("src");
  videoPlayer.load();
  videoOverlay.classList.remove("visible");
  videoOverlay.style.display = "none";
}

if (btnCerrarVideo) {
  btnCerrarVideo.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cerrarModalVideo();
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#btn-cerrar-video")) {
    e.preventDefault();
    cerrarModalVideo();
  }
});


if (videoOverlay) videoOverlay.addEventListener("click", (e) => {
  if (e.target === videoOverlay) cerrarModalVideo();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarModalVideo();
});


  // ---------- Helpers ----------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(ts) {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = meses[d.getMonth()];
    const anio = d.getFullYear();
    return `${dia} ${mes} ${anio}`;
  }

  function setModalError(msg) {
    if (!errorMsg) return;
    errorMsg.textContent = msg || "";
    errorMsg.style.display = msg ? "block" : "none";
  }

  function setModalEnabled(enabled) {
    if (!form) return;
    form
      .querySelectorAll("input, textarea, select, button[type='submit']")
      .forEach((el) => (el.disabled = !enabled));
  }

  function resetUploadUI() {
    if (uploadWrap) uploadWrap.style.display = "none";
    if (uploadBar) uploadBar.value = 0;
    if (uploadTexto) uploadTexto.textContent = "0%";
  }

  function setUploadProgress(pct) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (uploadWrap) uploadWrap.style.display = "block";
    if (uploadBar) uploadBar.value = clamped;
    if (uploadTexto) uploadTexto.textContent = `${clamped}%`;
  }

  function fileExtFrom(file) {
    const name = String(file?.name || "");
    const dot = name.lastIndexOf(".");
    if (dot !== -1 && dot < name.length - 1) {
      const ext = name.slice(dot + 1).toLowerCase();
      // evita extensiones raras
      if (/^[a-z0-9]{1,6}$/.test(ext)) return ext;
    }
    // fallback por mime
    const mime = String(file?.type || "");
    if (mime === "video/mp4") return "mp4";
    if (mime === "video/webm") return "webm";
    if (mime === "video/quicktime") return "mov";
    return "mp4";
  }

  function validateVideoFile(file) {
    if (!file) return "Selecciona un archivo de video.";
    if (!String(file.type || "").startsWith("video/")) {
      return "El archivo debe ser un video (mp4, mov, webm, etc.).";
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return "El video es muy pesado. Sube un archivo de máximo 50 MB.";
    }
    return "";
  }

  function uploadVideo({ uid, postId, file, onProgress }) {
    const ext = fileExtFrom(file);
    const path = `posts/${uid}/${postId}.${ext}`;
    const ref = storageRef(storage, path);

    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(ref, file, { contentType: file.type || undefined });

      task.on(
        "state_changed",
        (snap) => {
          if (!onProgress) return;
          const pct = (snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0);
          onProgress(pct);
        },
        (err) => reject(err),
        async () => {
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve({ downloadURL: url, fullPath: task.snapshot.ref.fullPath });
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  function abrirModal() {
    if (!currentUser) return;

    // ✅ si NO es jugador, abrir pero bloqueado + mensaje
    if (currentRole !== "player") {
      setModalError("Por ahora solo los jugadores pueden publicar en el feed.");
      setModalEnabled(false);
      if (overlay) overlay.classList.add("visible");
      return;
    }

    // ✅ jugador: normal
    setModalError("");
    setModalEnabled(true);
    if (overlay) overlay.classList.add("visible");
  }

  function cerrarModal() {
    if (!overlay) return;
    overlay.classList.remove("visible");
  }

  function abrirModalFiltros() {
    if (!overlayFiltros) return;
    cargarFiltrosExplorarDesdeStorageEnModal();
    overlayFiltros.classList.add("visible");
    if (btnAbrir) btnAbrir.style.display = "none";
  }

  function cerrarModalFiltros() {
    if (!overlayFiltros) return;
    overlayFiltros.classList.remove("visible");
    if (btnAbrir) btnAbrir.style.display = "";
  }

  function abrirModalReporte(infoPost) {
    postSeleccionadoParaReporte = infoPost;
    if (!overlayReporte) return;
    if (formReporte) formReporte.reset();
    if (mensajeReporte) mensajeReporte.textContent = "";
    overlayReporte.classList.add("visible");
  }

  function cerrarModalReporte() {
    if (!overlayReporte) return;
    overlayReporte.classList.remove("visible");
    postSeleccionadoParaReporte = null;
  }

  // ---------- Filtros storage ----------
  function cargarFiltrosExplorarDesdeStorageEnModal() {
    if (!formFiltros) return;
    const raw = localStorage.getItem("explorarFiltros");
    if (!raw) {
      formFiltros.reset();
      return;
    }
    try {
      const filtros = JSON.parse(raw);
      if (inputFiltroNombre && typeof filtros.nombre === "string") inputFiltroNombre.value = filtros.nombre;
      if (selectFiltroPosicion && typeof filtros.posicion === "string") selectFiltroPosicion.value = filtros.posicion;
      if (selectFiltroCiudad && typeof filtros.ciudad === "string") selectFiltroCiudad.value = filtros.ciudad;
      if (selectFiltroNivel && typeof filtros.nivel === "string") selectFiltroNivel.value = filtros.nivel;
    } catch {}
  }

  function guardarFiltrosExplorarEnStorage() {
    if (!formFiltros) return;
    const filtros = {
      nombre: (inputFiltroNombre?.value || "").trim(),
      posicion: (selectFiltroPosicion?.value || "").trim(),
      ciudad: (selectFiltroCiudad?.value || "").trim(),
      nivel: (selectFiltroNivel?.value || "").trim(),
    };
    const user = auth.currentUser;
    if (user) {
      localStorage.setItem(`explorarFiltros_${user.uid}`, JSON.stringify(filtros));
    }
    localStorage.removeItem("explorarFiltros");
  }

  // ---------- Render ----------
  function renderFeed(posts) {
    if (!contenedorFeed) return;

    contenedorFeed.innerHTML = "";

    if (!posts.length) {
      contenedorFeed.innerHTML = `<p style="opacity:.75">Aún no hay publicaciones.</p>`;
      return;
    }

    for (const p of posts) {
      const canDelete = currentUser && p.ownerUid === currentUser.uid;

      const fecha = formatDate(p.createdAt) || "—";
      const tipoTexto = p.type === "partido" ? "PARTIDO COMPLETO" : "HIGHLIGHT";
      const claseTipoExtra = p.type === "partido" ? " post-tipo-partido" : "";

      const autorTexto = [
        p.ownerNombre || "Jugador",
        p.ownerPosicion ? p.ownerPosicion : "",
        p.ownerCiudad ? p.ownerCiudad : "",
      ].filter(Boolean).join(" · ");

      const article = document.createElement("article");
      article.className = "post-card";
      article.dataset.postId = p.id;
      article.dataset.ownerUid = p.ownerUid || "";

      article.innerHTML = `
        <div class="post-meta">
          <div class="post-meta-left">
            <span class="post-fecha">${escapeHtml(fecha)}</span>
            <span class="post-tipo${claseTipoExtra}">${escapeHtml(tipoTexto)}</span>
          </div>
          <button type="button" class="btn-reportar" title="Reportar publicación">
            <i class="fa-solid fa-flag"></i>
          </button>
        </div>

        <h2 class="post-titulo">${escapeHtml(p.title)}</h2>
        <p class="post-descripcion">${escapeHtml(p.description || "")}</p>

        <div class="post-footer">
          <span class="post-autor">
            Jugador:
            <strong>
              <a href="perfilJugador.html?uid=${encodeURIComponent(p.ownerUid)}" style="color:inherit;text-decoration:none">
                ${escapeHtml(autorTexto)}
              </a>
            </strong>
          </span>

          <div class="post-actions">
            <a href="${escapeHtml(p.videoUrl)}" class="post-boton" target="_blank" rel="noopener">
              Ver video
            </a>

            ${
              canDelete
                ? `<button type="button" class="btn-eliminar">
                     <i class="fa-solid fa-trash-can"></i>
                     <span>Eliminar</span>
                   </button>`
                : ""
            }
          </div>
        </div>
      `;

      contenedorFeed.appendChild(article);
    }
  }

  // ---------- Firestore: suscripción feed ----------
  function subscribeFeed() {
    if (unsubscribeFeed) unsubscribeFeed();

    const q = query(
      collection(db, "posts"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    unsubscribeFeed = onSnapshot(
      q,
      (snap) => {
        const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderFeed(posts);
      },
      (err) => {
        console.error(err);
        if (contenedorFeed) {
          contenedorFeed.innerHTML =
            `<p style="color:#fecaca">Error cargando el feed. Revisa consola.</p>`;
        }
      }
    );
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
      console.error("Error leyendo mi profile:", e);
      myProfile = null;
    }
  }

  // ---------- Crear Post ----------

  async function crearPostDesdeModal({ titulo, descripcion, tipo, file }) {
    if (!currentUser) throw new Error("No hay sesión.");

    // Datos autor (snapshot) para que el feed no tenga que hacer joins
    const ownerNombre = myProfile
      ? `${(myProfile.nombres || "").trim()} ${(myProfile.apellidos || "").trim()}`.trim()
      : (currentUser.email || "Jugador");

    const ownerPosicion = myProfile?.posicion || "";
    const ownerCiudad = myProfile?.ciudad || "";

    // Creamos ID estable para que el path en Storage quede amarrado al post
    const postDocRef = doc(collection(db, "posts"));

    const { downloadURL, fullPath } = await uploadVideo({
      uid: currentUser.uid,
      postId: postDocRef.id,
      file,
      onProgress: setUploadProgress,
    });

    await setDoc(postDocRef, {
      ownerUid: currentUser.uid,
      ownerNombre,
      ownerPosicion,
      ownerCiudad,

      title: titulo,
      description: descripcion || "",
      type: tipo,          // "highlight" | "partido"
      videoUrl: downloadURL,
      videoPath: fullPath,

      visibility: "public",
      createdAt: serverTimestamp(),
    });
    

  }

  // ---------- Eliminar Post ----------
async function eliminarPost(postId) {
  if (!currentUser) return;
  await onPostDeleted(db, postId, currentUser.uid);
}



  // ---------- Reporte a Firestore ----------
  async function enviarReporteAFirestore({ motivo, comentarios, post }) {
    if (!currentUser) throw new Error("No hay sesión.");
    if (!post?.postId || !post?.ownerUid) throw new Error("Post inválido para reporte.");

    const reporterName = myProfile
      ? `${(myProfile.nombres || "").trim()} ${(myProfile.apellidos || "").trim()}`.trim()
      : (currentUser.email || "");

    await addDoc(collection(db, "post_reports"), {
      postId: String(post.postId),
      postOwnerUid: String(post.ownerUid),
      postTitle: String(post.titulo || ""),
      postLink: String(post.link || ""),

      reporterUid: currentUser.uid,
      reporterRole: String(currentRole || ""),
      reporterName: String(reporterName || ""),

      reason: String(motivo),
      comment: String(comentarios || ""),

      status: "open",
      createdAt: serverTimestamp(),
    });
  }

  // ---------- Listeners UI ----------
  if (btnAbrir) btnAbrir.addEventListener("click", abrirModal);
  if (btnCerrar) btnCerrar.addEventListener("click", cerrarModal);
  if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarModal(); });

  if (btnExplorar) btnExplorar.addEventListener("click", abrirModalFiltros);
  if (btnCerrarFiltros) btnCerrarFiltros.addEventListener("click", cerrarModalFiltros);
  if (overlayFiltros) overlayFiltros.addEventListener("click", (e) => { if (e.target === overlayFiltros) cerrarModalFiltros(); });

  if (btnResetFiltros && formFiltros) {
    btnResetFiltros.addEventListener("click", (e) => {
      e.preventDefault();
      formFiltros.reset();
      localStorage.removeItem("explorarFiltros");
    });
  }

  if (btnBuscarFiltros && formFiltros) {
    btnBuscarFiltros.addEventListener("click", (e) => {
      e.preventDefault();
      guardarFiltrosExplorarEnStorage();
      cerrarModalFiltros();
      window.location.href = "explorarJugadores.html";
    });
  }

  // Clicks en tarjetas (eliminar / reportar)
  if (contenedorFeed) {
    contenedorFeed.addEventListener("click", async (e) => {
      const btnEliminar = e.target.closest(".btn-eliminar");
      const btnReportar = e.target.closest(".btn-reportar");
      const card = e.target.closest(".post-card");

      const btnVerVideo = e.target.closest(".post-boton");
if (btnVerVideo) {
  e.preventDefault();
  const url = btnVerVideo.getAttribute("href");
  if (url) abrirModalVideo(url);
  return;
}


      if (!card) return;

      const postId = card.dataset.postId;
      const ownerUid = card.dataset.ownerUid;

      if (btnEliminar) {
        if (!currentUser || currentUser.uid !== ownerUid) return;
        try {
          await eliminarPost(postId);
        } catch (err) {
          console.error(err);
          alert("No se pudo eliminar. Revisa consola.");
        }
        return;
      }

      if (btnReportar) {
        const titulo = (card.querySelector(".post-titulo")?.textContent || "").trim();
        const link = card.querySelector(".post-boton")?.getAttribute("href") || "";
        abrirModalReporte({ postId, ownerUid, titulo, link });
        return;
      }
    });
  }

  // Submit del modal (crear post)
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorMsg) errorMsg.textContent = "";

      // ✅ Solo players publican
      if (currentRole !== "player") {
        if (errorMsg) errorMsg.textContent = "Por ahora solo los jugadores pueden publicar en el feed.";
        return;
      }

      const titulo = document.getElementById("titulo-publicacion")?.value.trim() || "";
      const descripcion = document.getElementById("descripcion-publicacion")?.value.trim() || "";
      const tipo = document.getElementById("tipo-publicacion")?.value || "";
      const file = inputVideo?.files?.[0] || null;

      if (!titulo || !tipo) {
        if (errorMsg) errorMsg.textContent = "Completa título y tipo.";
        return;
      }

      const fileErr = validateVideoFile(file);
      if (fileErr) {
        if (errorMsg) errorMsg.textContent = fileErr;
        return;
      }

    let uploaded = null;

    try {
      resetUploadUI();
      setModalEnabled(false);

      const ticket = await reservePostUploadSlot();

      uploaded = await uploadVideoToReservedPath({
        videoPath: ticket.videoPath,
        file,
        onProgress: setUploadProgress,
      });

      await finalizeReservedPostUpload({
        ticketId: ticket.ticketId,
        title: titulo,
        description: descripcion || "",
        type: tipo,
        videoPath: uploaded.fullPath,
      });

      form.reset();
      cerrarModal();
    } catch (err) {
      console.error(err);
      if (uploaded?.ref) await cleanupUploadedVideo(uploaded.ref);
      setModalError(normalizeCallableError(err, "Error publicando. Revisa consola / rules."));
    } finally {
      setModalEnabled(true);
      resetUploadUI();
    }
    });
  }

  // Submit reporte (Firestore)
  if (formReporte) {
    formReporte.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!postSeleccionadoParaReporte) return;

      const motivo = (selectMotivo?.value || "").trim();
      const comentarios = (textareaComentarios?.value || "").trim();

      if (!motivo) {
        if (mensajeReporte) mensajeReporte.textContent = "Selecciona un motivo.";
        return;
      }

      const btnSubmit = formReporte.querySelector("button[type='submit']");
      if (btnSubmit) btnSubmit.disabled = true;
      if (mensajeReporte) mensajeReporte.textContent = "Enviando reporte...";

      try {
        await enviarReporteAFirestore({
          motivo,
          comentarios,
          post: postSeleccionadoParaReporte,
        });

        if (mensajeReporte) {
          mensajeReporte.textContent =
            "Reporte enviado. Gracias por ayudarnos a cuidar la comunidad.";
        }

        setTimeout(cerrarModalReporte, 900);
      } catch (err) {
        console.error(err);
        if (mensajeReporte) {
          mensajeReporte.textContent = "No se pudo enviar el reporte. Revisa consola / rules.";
        }
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
      }
    });
  }

  if (btnCerrarReporte) btnCerrarReporte.addEventListener("click", cerrarModalReporte);
  if (btnCancelarReporte) btnCancelarReporte.addEventListener("click", cerrarModalReporte);
  if (overlayReporte) overlayReporte.addEventListener("click", (e) => { if (e.target === overlayReporte) cerrarModalReporte(); });

  // ---------- AUTH ----------
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (!user) {
      if (btnAbrir) btnAbrir.style.display = "none";
      if (contenedorFeed) contenedorFeed.innerHTML = "<p>Debes iniciar sesión.</p>";
      return;
    }

    const role = await getMyRole(user.uid);
    currentRole = role;

    if (btnAbrir) btnAbrir.style.display = (role === "player") ? "inline-flex" : "none";

    await loadMyProfile(user.uid);
    subscribeFeed();
  });
});
