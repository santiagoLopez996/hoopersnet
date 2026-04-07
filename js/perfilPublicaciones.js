// /js/perfilPublicaciones.js (MODULE) - Publicaciones reales del perfil desde Firestore
import { auth, db } from "./firebase-init.js";
import { onPostDeleted } from "./puntosPublicaciones.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
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
  const btnAbrir = document.getElementById("btn-abrir-modal");
  const btnCerrar = document.getElementById("btn-cerrar-modal");
  const overlay = document.getElementById("modal-overlay");
  const form = document.getElementById("form-publicacion");
  const errorMsg = document.getElementById("modal-error");
  const lista = document.getElementById("lista-publicaciones-jugador");

  const inputVideo = document.getElementById("video-publicacion");
  const uploadWrap = document.getElementById("upload-wrap");
  const uploadBar = document.getElementById("upload-progreso");
  const uploadTexto = document.getElementById("upload-texto");

  const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
  const storage = getStorage();

  // ----- MODAL VIDEO (perfil) -----
const videoOverlay = document.getElementById("modal-video-overlay");
const videoPlayer = document.getElementById("modal-video-player");
const btnCerrarVideo = document.getElementById("btn-cerrar-video");

function abrirModalVideo(url) {
  if (!videoOverlay || !videoPlayer) return;
  videoPlayer.src = url;
  videoOverlay.style.display = "flex";
  videoOverlay.classList.add("visible");
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

if (videoOverlay) {
  videoOverlay.addEventListener("click", (e) => {
    if (e.target === videoOverlay) cerrarModalVideo();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarModalVideo();
});

lista.addEventListener("click", (e) => {
  const btnVerVideo = e.target.closest(".post-boton");
  if (!btnVerVideo) return;
  e.preventDefault();
  const url = btnVerVideo.getAttribute("href");
  if (url) abrirModalVideo(url);
});


  if (!overlay || !form || !lista) return;

  function getProfileUid() {
    return window.__HN_PROFILE_UID || null;
  }
  function isOwner() {
    return window.__HN_IS_OWNER === true;
  }

  async function waitForProfileContext(timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const uid = getProfileUid();
      if (uid) return uid;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = meses[d.getMonth()];
    const anio = d.getFullYear();
    return `${dia} ${mes} ${anio}`;
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
      if (/^[a-z0-9]{1,6}$/.test(ext)) return ext;
    }
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

  function setModalEnabled(enabled) {
    form
      .querySelectorAll("input, textarea, select, button[type='submit']")
      .forEach((el) => (el.disabled = !enabled));
  }

  function abrirModal() {
    if (!isOwner()) return;
    if (errorMsg) errorMsg.textContent = "";
    form.reset();
    overlay.classList.add("visible");
  }

  function cerrarModal() {
    overlay.classList.remove("visible");
  }

  if (btnAbrir) btnAbrir.addEventListener("click", abrirModal);
  if (btnCerrar) btnCerrar.addEventListener("click", cerrarModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarModal(); });

  function renderLista(posts) {
    lista.innerHTML = "";

    if (!posts.length) {
      lista.innerHTML = `
        <article class="post-card" data-placeholder="true">
          <div class="post-meta">
            <span class="post-fecha">—</span>
            <span class="post-tipo">PUBLICACIÓN</span>
          </div>
          <h3 class="post-titulo">Aún no hay publicaciones</h3>
          <p class="post-descripcion">Cuando este jugador publique highlights o partidos, aparecerán aquí.</p>
        </article>
      `;
      return;
    }

    for (const p of posts) {
      const fecha = formatDate(p.createdAt);
      const tipoTexto = p.type === "partido" ? "PARTIDO COMPLETO" : "HIGHLIGHT";
      const claseTipoExtra = p.type === "partido" ? " post-tipo-partido" : "";
      const canDelete = isOwner() && auth.currentUser && p.ownerUid === auth.currentUser.uid;

      const article = document.createElement("article");
      article.className = "post-card";
      article.dataset.postId = p.id;

      article.innerHTML = `
        <div class="post-meta">
          <span class="post-fecha">${escapeHtml(fecha)}</span>
          <span class="post-tipo${claseTipoExtra}">${escapeHtml(tipoTexto)}</span>
        </div>

        <h3 class="post-titulo">${escapeHtml(p.title)}</h3>
        <p class="post-descripcion">${escapeHtml(p.description || "")}</p>

        <div class="post-footer">
          <div></div>
          <div class="post-actions">
            <a href="${escapeHtml(p.videoUrl)}" class="post-boton" target="_blank" rel="noopener">Ver video</a>
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

      lista.appendChild(article);
    }
  }

  async function getOwnerSnapshot(uid) {
    try {
      const snap = await getDoc(doc(db, "profiles", uid));
      if (!snap.exists()) return null;
      const p = snap.data();
      return {
        ownerNombre: `${(p.nombres || "").trim()} ${(p.apellidos || "").trim()}`.trim(),
        ownerPosicion: p.posicion || "",
        ownerCiudad: p.ciudad || "",
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  // Delete
  lista.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-eliminar");
    if (!btn) return;
    if (!isOwner()) return;

    const card = btn.closest(".post-card");
    const postId = card?.dataset.postId;
    if (!postId) return;

    try {
  const viewer = auth.currentUser;
  if (!viewer) {
    alert("Debes iniciar sesión.");
    return;
  }
  await onPostDeleted(db, postId, viewer.uid);
} catch (err) {
  console.error(err);
  alert("No se pudo eliminar. Revisa consola.");
}

  });

  // Create
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isOwner()) return;
    if (errorMsg) errorMsg.textContent = "";

    const viewer = auth.currentUser;
    if (!viewer) {
      if (errorMsg) errorMsg.textContent = "Debes iniciar sesión.";
      return;
    }

    const uidPerfil = getProfileUid();
    if (!uidPerfil || uidPerfil !== viewer.uid) {
      if (errorMsg) errorMsg.textContent = "No eres el dueño de este perfil.";
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

    const snap = await getOwnerSnapshot(viewer.uid);

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
      if (errorMsg) errorMsg.textContent = normalizeCallableError(err, "Error publicando. Revisa consola.");
    } finally {
      setModalEnabled(true);
      resetUploadUI();
    }
  });

  // INIT
  (async () => {
    const uidPerfil = await waitForProfileContext();
    if (!uidPerfil) return;

    // Si no soy dueño, oculto el +
    if (btnAbrir && !isOwner()) btnAbrir.style.display = "none";

    // Suscribir posts de este perfil
    const q = query(
      collection(db, "posts"),
      where("ownerUid", "==", uidPerfil),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    onSnapshot(
      q,
      (snap) => {
        const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderLista(posts);
      },
      (err) => {
        console.error(err);
        lista.innerHTML = `<p style="color:#fecaca">Error cargando publicaciones. Revisa consola.</p>`;
      }
    );
  })();

  // Solo para asegurar auth disponible (no bloquea lectura pública)
  onAuthStateChanged(auth, () => {});
});
