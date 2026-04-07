// js/cargarPerfilReclutador.js
import { auth, db, storage } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc, getDoc,
  collection, getDocs,
  setDoc, serverTimestamp,
  query, where, orderBy, onSnapshot, limit
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";


function byId(id) {
  return document.getElementById(id);
}


// ---------- Helpers UI ----------
function safeTextByID(id, value, fallback = "—") {
  const el = document.getElementById(id);
  if (!el) return;
  const txt = (value ?? "").toString().trim();
  el.textContent = txt ? txt : fallback;
}

function safeMailLink(id, email, fallback = "—") {
  const a = document.getElementById(id);
  if (!a) return;

  const e = (email ?? "").toString().trim();
  if (!e) {
    a.textContent = fallback;
    a.removeAttribute("href");
    return;
  }
  a.textContent = e;
  a.href = `mailto:${e}`;
}

function safeWebLink(id, url, fallback = "—") {
  const a = document.getElementById(id);
  if (!a) return;

  let u = (url ?? "").toString().trim();
  if (!u) {
    a.textContent = fallback;
    a.removeAttribute("href");
    a.removeAttribute("target");
    return;
  }

  if (!/^https?:\/\//i.test(u)) u = "https://" + u;

  a.textContent = url.trim();
  a.href = u;
  a.target = "_blank";
  a.rel = "noopener";
}

function wireLogout() {
  const btn = byId("btnLogout") || byId("btn-logout");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/html/login.html";
  });
}

function initHeaderMenu() {
  const wrap = byId("menu-perfil");
  const btnMenu = byId("btn-menu");
  const dropdown = byId("menu-dropdown");
  const itemEditar = byId("menu-editar");
  const itemLogout = byId("menu-logout");

  const btnEditarReal = byId("btn-editar-perfil");
  const btnLogoutReal = byId("btnLogout") || byId("btn-logout");

  if (!wrap || !btnMenu || !dropdown) return;

  const close = () => {
    dropdown.style.display = "none";
    btnMenu.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    dropdown.style.display = "block";
    btnMenu.setAttribute("aria-expanded", "true");
  };

  btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    isOpen ? close() : open();
  });

  // cerrar al click afuera
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  // cerrar con Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  if (itemEditar) {
    itemEditar.addEventListener("click", () => {
      close();
      btnEditarReal?.click();
    });
  }

  if (itemLogout) {
    itemLogout.addEventListener("click", () => {
      close();
      btnLogoutReal?.click();
    });
  }

  // para que setOwnerUI pueda forzar cierre
  window.__closeRecruiterMenu = close;
}


// ---------- Tabs ----------
function initRecruiterTabs({ isOwner }) {
  const tabs = document.getElementById("perfil-tabs");
  const btnP = document.getElementById("tab-btn-principal");
  const btnF = document.getElementById("tab-btn-favoritos");
  const btnS = document.getElementById("tab-btn-solicitudes");
  const btnR = document.getElementById("tab-btn-retos"); // 👈 usa aquí tu id real si es distinto


  const viewP = document.getElementById("view-principal");
  const viewF = document.getElementById("view-favoritos");
  const viewS = document.getElementById("view-solicitudes");
  const viewR = document.getElementById("view-retos"); // 👈 usa aquí tu id real si es distinto


  if (!tabs || !btnP || !viewP || !viewR) return;

  // Mostrar barra tabs (evita flash antes de auth)
  tabs.style.display = "flex";

  // Favoritos y Solicitudes: solo owner
  if (btnF) btnF.style.display = isOwner ? "inline-flex" : "none";
  if (btnS) btnS.style.display = isOwner ? "inline-flex" : "none";

if (btnR) btnR.style.display = "inline-flex";


  const setActive = (which) => {
    const activeClass = "tab-activo";

    // buttons
    [btnP, btnF, btnS, btnR].forEach(b => b && b.classList.remove(activeClass));

    if (which === "principal") btnP.classList.add(activeClass);
    if (which === "favoritos" && btnF) btnF.classList.add(activeClass);
    if (which === "solicitudes" && btnS) btnS.classList.add(activeClass);
    if (which === "retos" && btnR) btnR.classList.add(activeClass);


    // views
    if (viewP) viewP.style.display = (which === "principal") ? "block" : "none";
    if (viewF) viewF.style.display = (which === "favoritos") ? "block" : "none";
    if (viewS) viewS.style.display = (which === "solicitudes") ? "block" : "none";
    if (viewR) viewR.style.display = (which === "retos") ? "block" : "none";

  };

  // Default
  setActive("principal");

  btnP.onclick = () => setActive("principal");
  if (btnF) btnF.onclick = () => setActive("favoritos");
  if (btnS) btnS.onclick = () => setActive("solicitudes");
  if (btnR) btnR.onclick = () => setActive("retos");

}

function setOwnerUI(isOwner, signedIn) {
  const btnEditar = document.getElementById("btn-editar-perfil");
  const btnLogout = byId("btnLogout") || byId("btn-logout");

  const menuWrap = byId("menu-perfil");

if (menuWrap) {
  // Solo owner ve el menú (y por tanto sus acciones)
  menuWrap.style.display = isOwner ? "inline-flex" : "none";

  // Los controles reales quedan ocultos (el menú los dispara por .click())
  if (btnEditar) btnEditar.style.display = "none";
  if (btnLogout) btnLogout.style.display = "none";

  if (!isOwner && window.__closeRecruiterMenu) window.__closeRecruiterMenu();
  return; // <- importante para que no se ejecute el comportamiento viejo
}



  if (btnEditar) btnEditar.style.display = isOwner ? "inline-flex" : "none";

  // ✅ según lo que vienes manejando: logout SOLO en tu propio perfil
  if (btnLogout) btnLogout.style.display = (signedIn && isOwner) ? "inline-flex" : "none";
}

let CURRENT_USER_UID = null;
let CURRENT_IS_OWNER = false;

function calcEdad(fecha) {
  if (!fecha) return "";

  let d;
  if (typeof fecha === "string") d = new Date(fecha);
  else if (fecha?.toDate) d = fecha.toDate();   // Firestore Timestamp
  else d = new Date(fecha);

  if (Number.isNaN(d.getTime())) return "";

  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) edad--;
  return edad >= 0 ? String(edad) : "";
}



function initVerificationModal() {
  const overlay = byId("overlay-verificacion");
  const btnOpen = byId("btn-solicitar-verificacion");
  const btnClose = byId("btn-cerrar-verificacion");
  const btnCancel = byId("btn-cancelar-verificacion");
  const form = byId("form-verificacion");
  const msg = byId("verif-msg");

  const inOrg = byId("verif-org");
  const inRol = byId("verif-rol");
  const inWeb = byId("verif-web");
  const inEmail = byId("verif-email");
  const inPdf = byId("verif-pdf");

  const verifText = byId("verif-status-text");

  if (!overlay || !btnOpen || !form) return;

  const setMsg = (t, ok = false) => {
    if (!msg) return;
    msg.textContent = t || "";
    msg.style.color = ok ? "#16a34a" : "#dc2626";
  };

  const open = () => {
    if (!CURRENT_IS_OWNER) return; // seguridad extra
    overlay.style.display = "flex"; // o "grid" si tu CSS lo usa

    setMsg("");

    // Prefill desde lo que ya cargas en el perfil
    const orgTxt = byId("organizacionReclutador")?.textContent || "";
    const rolTxt = byId("rolReclutador")?.textContent || "";
    const emailTxt = byId("emailReclutador")?.textContent || "";
    const webTxt = byId("webReclutador")?.textContent || "";

    if (inOrg) inOrg.value = orgTxt === "—" ? "" : orgTxt;
    if (inRol) inRol.value = rolTxt === "—" ? "" : rolTxt;
    if (inEmail) inEmail.value = emailTxt === "—" ? "" : emailTxt;
    if (inWeb) inWeb.value = webTxt === "—" ? "" : webTxt;
    if (inPdf) inPdf.value = "";
  };

  const close = () => {
    overlay.style.display = "none";
    setMsg("");
  };

  btnOpen.addEventListener("click", open);
  btnClose?.addEventListener("click", close);
  btnCancel?.addEventListener("click", close);

  // click afuera
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") close();
  });

  // Enviar solicitud (Firestore + Storage)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");

    if (!CURRENT_IS_OWNER || !CURRENT_USER_UID) {
      setMsg("No autorizado.");
      return;
    }

    const org = (inOrg?.value || "").trim();
    const rol = (inRol?.value || "").trim();
    const web = (inWeb?.value || "").trim();
    const email = (inEmail?.value || "").trim();
    const pdfFile = inPdf?.files?.[0];

    if (!org || !rol || !email || !pdfFile) {
      setMsg("Completa organización, rol, email y adjunta el PDF.");
      return;
    }


    try {
      setMsg("Enviando…", true);

      // 1) Subir PDF a Storage
      const safeName = pdfFile.name.replace(/[^\w.\-]+/g, "_");
      const fileName = `${Date.now()}_${safeName}`;
      const path = `verification_docs/${CURRENT_USER_UID}/${fileName}`;
      const sref = ref(storage, path);


      await uploadBytes(sref, pdfFile, { contentType: pdfFile.type || "application/pdf" });
      const pdfUrl = await getDownloadURL(sref);

      // 2) Guardar/actualizar solicitud en Firestore (docId = uid)
      const reqRef = doc(db, "verification_requests", CURRENT_USER_UID);
      const existing = await getDoc(reqRef);

      const data = {
        uid: CURRENT_USER_UID,
        org,
        rol,
        web: web || "",
        contactEmail: email,
        pdfUrl,
        pdfPath: path,
        pdfName: pdfFile.name,
        pdfSize: pdfFile.size,

        status: "pending",
        updatedAt: serverTimestamp(),
      };

      if (!existing.exists()) {
        data.createdAt = serverTimestamp();
      }

      await setDoc(reqRef, data, { merge: true });

      // UI
      if (verifText) verifText.textContent = "✅ Solicitud enviada. En revisión.";
      btnOpen.style.display = "none";

      setMsg("Solicitud enviada ✅", true);
      setTimeout(close, 900);

    } catch (err) {
      console.error("Error enviando verificación:", err);
      setMsg("No se pudo enviar. Revisa consola (permisos/Storage).");
    }
  });
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB

function paintRecruiterAvatar(profileData) {
  const img = byId("avatar-img");
  const fb = byId("avatar-fallback");
  if (!img || !fb) return;

  const raw = (profileData?.photoURL || "").toString().trim();
  const v = Number(profileData?.photoVersion) || 0;

  if (!raw) {
    img.removeAttribute("src");
    img.style.display = "none";
    fb.style.display = "grid";
    return;
  }

  const src = `${raw}${raw.includes("?") ? "&" : "?"}v=${v}`;

  img.onerror = () => {
    img.style.display = "none";
    fb.style.display = "grid";
  };

  img.src = src;
  img.style.display = "block";
  fb.style.display = "none";
}

function initRecruiterAvatarUploader(uidToLoad, isOwner) {
  const btn = byId("btn-avatar-edit");
  const input = byId("avatar-file");
  const img = byId("avatar-img");
  const fb = byId("avatar-fallback");

  if (!btn || !input) return;

  // Solo owner ve el lápiz
  btn.style.display = isOwner ? "inline-flex" : "none";
  if (!isOwner) return;

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    // Validaciones
    if (!file.type || !file.type.startsWith("image/")) {
      alert("Selecciona una imagen válida (jpg/png/webp).");
      input.value = "";
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      alert("La imagen es muy pesada. Máximo 2MB.");
      input.value = "";
      return;
    }

    try {
      // UI feedback rápido
      btn.disabled = true;

      const ext = file.type.includes("png") ? "png"
        : file.type.includes("webp") ? "webp"
        : "jpg";

      const path = `profile_photos/${uidToLoad}/avatar.${ext}`;
      const sref = ref(storage, path);

      await uploadBytes(sref, file, { contentType: file.type });
      const photoURL = await getDownloadURL(sref);

      const photoVersion = Date.now();

      // Guardar en profiles/{uid}
      await setDoc(doc(db, "profiles", uidToLoad), {
        photoURL,
        photoPath: path,
        photoVersion,
        photoUpdatedAt: serverTimestamp(),
      }, { merge: true });

      // Pintar inmediatamente (sin esperar recarga)
      paintRecruiterAvatar({ photoURL, photoVersion });

      // (opcional) asegurar fallback oculto
      if (img) img.style.display = "block";
      if (fb) fb.style.display = "none";

    } catch (err) {
      console.error("Error subiendo avatar reclutador:", err);
      alert("No se pudo subir la foto. Revisa consola / Storage rules.");
    } finally {
      btn.disabled = false;
      input.value = "";
    }
  });
}

async function paintRecruiterEmailVisibility({ recruiterUidToLoad, viewerUser, isOwner }) {
  // owner: lee users/{uid}
  if (isOwner) {
    const uSnap = await getDoc(doc(db, "users", recruiterUidToLoad));
    const email = (uSnap.data()?.contactEmail || "").toString().trim();
    safeMailLink("emailReclutador", email, "—");
    return;
  }

  // jugador viendo recruiter: solo si existe reveal accepted (playerUid = viewerUser.uid)
  try {
    const rRef = doc(db, "contact_reveals", viewerUser.uid, "items", recruiterUidToLoad);
    const rSnap = await getDoc(rRef);
    const email = (rSnap.data()?.recruiterEmail || "").toString().trim();
    if (email) {
      safeMailLink("emailReclutador", email, "—");
      return;
    }
  } catch (_) {}

  // default
  const a = document.getElementById("emailReclutador");
  if (a) {
    a.textContent = "🔒 Oculto";
    a.removeAttribute("href");
  }
}


// ---------- Recruiter header + blocks ----------
async function loadRecruiter(uid, isOwner) {
  const snap = await getDoc(doc(db, "profiles", uid));

  if (!snap.exists()) {
    console.warn("No existe profiles/{uid} para este usuario");
    return;
  }

  const p = snap.data();

//Header
const fullName = `${p.nombres || "—"} ${p.apellidos || "—"}`.trim();
safeTextByID("nombreReclutadorTxt", fullName);
const ub = [p.ciudad || "", p.pais || ""].filter(Boolean).join(" · ");
safeTextByID("ubicacionReclutador", ub || "—");

//Datos personales

safeTextByID("dato-nombre", fullName);
safeTextByID("genero", p.genero);
safeTextByID("dato-ubicacion", ub || "—");

  // safeTextByID("nombreReclutador", `${p.nombres || "—"} ${p.apellidos || "—"}`.trim());
  safeTextByID("rolOrganizacion", `${p.rol || "—"} · ${p.organizacion || "—"}`);



  // Bloque datos profesionales
  safeTextByID("rolReclutador", p.rol);
  safeTextByID("organizacionReclutador", p.organizacion);
  safeMailLink("emailReclutador", p.emailContacto || p.email);
  safeWebLink("webReclutador", p.web);
  safeTextByID("categoriaBusqueda", p.categoria);
  safeTextByID("nivelBusqueda", p.nivelBusqueda);
  safeTextByID("busqueda-bio", p.bioCorta);


const fechaNac = p.fechaNacimiento || p.fecha_nacimiento || p.fechaNac || null;
safeTextByID("fechaNacimiento", calcEdad(fechaNac), "—");



// Verificación (badge + tarjeta)
const badge = document.getElementById("badge-verificado");
const verifCard = document.getElementById("card-verificacion");
const verifText = document.getElementById("verif-status-text");
const btnSolicitar = document.getElementById("btn-solicitar-verificacion");

const verifiedPublic = p.verified === true;

  // ✅ Avatar
  paintRecruiterAvatar(p);
  initRecruiterAvatarUploader(uid, isOwner);


// Si eres el dueño, sí puedes leer users/{uid} (por rules) y ver el verified real
let verifiedOwner = false;
if (isOwner) {
  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    verifiedOwner = uSnap.exists() && uSnap.data()?.verified === true;
  } catch (e) {
    console.warn("No se pudo leer users/{uid} para verified:", e);
  }
}

const verified = verifiedPublic || verifiedOwner;

// ✅ Badge al lado del nombre
if (badge) badge.style.display = verified ? "inline-flex" : "none";

// ✅ Tarjeta de verificación (solo owner)
if (verifCard) {
  if (!isOwner) {
    verifCard.style.display = "none";
  } else {
    verifCard.style.display = "block";

    if (verified) {
      if (verifText) verifText.textContent = "✅ Tu cuenta está verificada. Ya puedes solicitar contacto.";
      if (btnSolicitar) btnSolicitar.style.display = "none";
    } else {
      if (verifText) verifText.textContent = "⏳ Aún no estás verificado. Envía tu info y un PDF para revisión.";
      if (btnSolicitar) btnSolicitar.style.display = "inline-flex";
    }
  }
}

}

// ---------- Favoritos ----------
function getInitials(fullName) {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts[1]?.[0] || "";
  return (a + b).toUpperCase() || "HN";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function crearCardJugador(uid, data) {
  const nombre = `${data.nombres || ""} ${data.apellidos || ""}`.trim()
    || data.nombreCompleto
    || data.nombre
    || "Jugador";

  const posicion = data.posicion || "—";

  const alturaCm = Number(data.alturaCm ?? data.altura);
  const alturaTxt = Number.isFinite(alturaCm) ? `${(alturaCm / 100).toFixed(2)} m` : "—";

  const ciudad = data.ciudad || "—";
  const nivel = data.nivelActual || data.nivel || "—";
  const depto = data.departamento || data.depto || "—";

  const iniciales = getInitials(nombre);

  const card = document.createElement("div");
  card.className = "card-jugador";

  card.innerHTML = `
    <div class="card-top">
      <div class="avatar">${escapeHtml(iniciales)}</div>
      <div class="info">
        <h3>${escapeHtml(nombre)}</h3>
        <p>${escapeHtml(posicion)} • ${escapeHtml(alturaTxt)}</p>
        <p class="meta">${escapeHtml(ciudad)} • ${escapeHtml(nivel)} • ${escapeHtml(depto)}</p>
      </div>
    </div>
    <a href="perfilJugador.html?uid=${encodeURIComponent(uid)}" class="btn-ver-perfil">Ver perfil</a>
  `;

  return card;
}

async function cargarFavoritos(recruiterUid) {
  const grid = document.getElementById("favoritosGrid");
  const count = document.getElementById("favoritosCount");
  const empty = document.getElementById("favoritosEmpty");

  if (!grid || !count) return;

  grid.innerHTML = "";
  count.textContent = "Cargando favoritos...";
  if (empty) empty.style.display = "none";

  try {
    // Favoritos desde: users/{recruiterUid}/favorites/{playerUid}
    const favRef = collection(db, "users", recruiterUid, "favorites");
    const favSnap = await getDocs(favRef);

    const playerUids = favSnap.docs.map(d => d.id);

    if (playerUids.length === 0) {
      count.textContent = "Mostrando 0 jugadores guardados";
      if (empty) empty.style.display = "block";
      return;
    }

    const profileSnaps = await Promise.all(
      playerUids.map(uid => getDoc(doc(db, "profiles", uid)))
    );

    let pintados = 0;
    profileSnaps.forEach((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      if (data.type && data.type !== "player") return;

      grid.appendChild(crearCardJugador(snap.id, data));
      pintados++;
    });

    count.textContent = `Mostrando ${pintados} jugadores guardados`;
    if (empty) empty.style.display = pintados ? "none" : "block";

  } catch (err) {
    console.error("Error cargando favoritos:", err);
    count.textContent = "Error cargando favoritos. Revisa consola.";
    if (empty) {
      empty.style.display = "block";
      empty.textContent = "Error cargando favoritos. Revisa consola.";
    }
  }
}

// ---------- Retos creados (Recruiter) ----------
let __unsubRetosCreados = null;

function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}

function difficultyLabel(d) {
  const x = (d || "").toString().toLowerCase();
  if (x === "easy") return "Fácil";
  if (x === "hard") return "Difícil";
  return "Media";
}

function statusLabel(s) {
  return (s === "closed") ? "Cerrado" : "Activo";
}

function renderRetosCreadosInto(elGrid, elEmpty, retos) {
  if (!elGrid) return;

  elGrid.innerHTML = "";

  if (!retos.length) {
    if (elEmpty) elEmpty.style.display = "block";
    return;
  }
  if (elEmpty) elEmpty.style.display = "none";

  retos.forEach((ch) => {
    const card = document.createElement("article");
    card.className = "reto-creado-card";

    const title = escapeHtml(ch.title || "Reto");
    const dif = difficultyLabel(ch.difficulty);
    const st = statusLabel(ch.status);
    const createdAt = fmtDate(ch.createdAt);
    const closesAt = fmtDate(ch.closesAt);

    const slots = Number(ch.slots || 0);
    const used = Number(ch.slotsUsed || 0);
    const cuposTxt = slots > 0 ? `${used} / ${slots}` : `${used}`;

    card.innerHTML = `
      <div class="reto-top">
        <h3 class="reto-title">${title}</h3>
        <div class="reto-badges">
          <span class="reto-chip">${escapeHtml(dif)}</span>
          <span class="reto-chip ${st === "Cerrado" ? "chip-closed" : "chip-active"}">${escapeHtml(st)}</span>
        </div>
      </div>

      <div class="reto-meta">
        <div><span class="k">Creado:</span> <span class="v">${escapeHtml(createdAt)}</span></div>
        <div><span class="k">Cierra:</span> <span class="v">${escapeHtml(closesAt)}</span></div>
        <div><span class="k">Cupos:</span> <span class="v">${escapeHtml(cuposTxt)}</span></div>
      </div>

      <div class="reto-actions">
        <a class="btn-ver-reto" href="/html/retos.html?open=${encodeURIComponent(ch.id)}">
          Ver reto
        </a>
      </div>
    `;

    elGrid.appendChild(card);
  });
}

function subscribeRetosCreados(recruiterUidToLoad) {
  const grid = document.getElementById("retos-creados-grid");
  const empty = document.getElementById("retos-creados-empty");

  if (!grid) return;

  // limpiar sub anterior si cambian de perfil
  try { __unsubRetosCreados?.(); } catch {}
  __unsubRetosCreados = null;

  grid.innerHTML = `<p style="opacity:.85;">Cargando retos…</p>`;
  if (empty) empty.style.display = "none";

  // challenges creados por este recruiter
  const qy = query(
    collection(db, "challenges"),
    where("createdByUid", "==", recruiterUidToLoad),
    orderBy("createdAt", "desc"),
    limit(200)
  );

  __unsubRetosCreados = onSnapshot(qy, (snap) => {
    const retos = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    renderRetosCreadosInto(grid, empty, retos);
  }, (err) => {
    console.error("Error cargando retos creados:", err);
    grid.innerHTML = `<p style="opacity:.85;">No se pudieron cargar los retos. Revisa consola.</p>`;
    if (empty) empty.style.display = "none";
  });
}


// ---------- Boot ----------
function getUidFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("uid");
}

document.addEventListener("DOMContentLoaded", () => {
  wireLogout();
  initHeaderMenu();
  initVerificationModal();



  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/html/login.html";
      return;
    }

    // si hay ?uid=... carga ese perfil, si no, carga el propio
    const uidParam = getUidFromURL();
    const uidToLoad = uidParam || user.uid;

    const signedIn = !!user;
    const isOwner = signedIn && (user.uid === uidToLoad);
    CURRENT_USER_UID = user.uid;
    CURRENT_IS_OWNER = isOwner;


    setOwnerUI(isOwner, signedIn);
    initRecruiterTabs({ isOwner });

    // click editar (solo owner)
    const btnEditar = document.getElementById("btn-editar-perfil");
    if (btnEditar) {
      btnEditar.onclick = () => {
        if (!isOwner) return;
        window.location.href = "/html/editarReclutador.html";
      };
    }

    // carga perfil del uid correcto
    await loadRecruiter(uidToLoad, isOwner);
    await paintRecruiterEmailVisibility({ recruiterUidToLoad: uidToLoad, viewerUser: user, isOwner });
    // Retos creados del reclutador que estás viendo (uidToLoad)
subscribeRetosCreados(uidToLoad);



    // favoritos: solo si es tu propio perfil (por rules)
    if (isOwner) {
      await cargarFavoritos(user.uid);
    }
  });
});
