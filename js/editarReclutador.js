import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function setMsg(text, ok=false) {
  const el = $("mensaje");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#16a34a" : "#dc2626";
}

function v(id) { return ($(`${id}`)?.value || "").trim(); }

async function loadRecruiter(uid) {
  const snap = await getDoc(doc(db, "profiles", uid));
  if (!snap.exists()) throw new Error("Perfil no existe");

  const p = snap.data();
  $("nombres").value = p.nombres || "";
  $("apellidos").value = p.apellidos || "";
  $("genero").value = p.genero || "";
  $("fechaNacimiento").value = p.fechaNacimiento || "";
  $("rol").value = p.rol || "";
  $("organizacion").value = p.organizacion || "";
  $("pais").value = p.pais || "";
  $("ciudad").value = p.ciudad || "";
  $("categoria").value = p.categoria || "";
  $("nivel-busqueda").value = p.nivelBusqueda || "";
  $("bio-corta").value = p.bioCorta || "";
  $("web").value = p.web || "";
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn-cancelar")?.addEventListener("click", () => {
    window.location.href = "/html/perfilReclutador.html";
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/html/login.html";
      return;
    }

    // ✅ Guard de rol: solo reclutadores pueden editarReclutador.html
try {
  const uSnap = await getDoc(doc(db, "users", user.uid));
  const role = uSnap.exists() ? uSnap.data().role : null;

  if (role !== "recruiter") {
    // si es jugador (o rol inválido), lo mandamos a su perfil
    window.location.href = "/html/perfilJugador.html";
    return;
  }
} catch (err) {
  console.error("No se pudo validar role:", err);
  window.location.href = "/html/feed.html";
  return;
}


    try {
      await loadRecruiter(user.uid);
    } catch (e) {
      console.error(e);
      setMsg("No se pudo cargar tu perfil.");
    }

    $("form-editar-reclutador")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setMsg("");

      const payload = {
        nombres: v("nombres"),
        apellidos: v("apellidos"),
        genero: v("genero"),
        fechaNacimiento: v("fechaNacimiento"),
        rol: v("rol"),
        organizacion: v("organizacion"),
        pais: v("pais"),
        ciudad: v("ciudad"),
        categoria: v("categoria"),
        nivelBusqueda: v("nivel-busqueda"),
        bioCorta: v("bio-corta"),
        web: v("web") || "",
        updatedAt: serverTimestamp(),
      };

      // Validación mínima
      const required = ["nombres","apellidos","rol","organizacion","pais","ciudad","categoria","nivelBusqueda"];
      for (const k of required) {
        if (!payload[k]) {
          setMsg("Completa todos los campos obligatorios.");
          return;
        }
      }

      try {
        await updateDoc(doc(db, "profiles", user.uid), payload);
        setMsg("✅ Perfil actualizado. Redirigiendo...", true);
        setTimeout(() => window.location.href = "/html/perfilReclutador.html", 600);
      } catch (err) {
        console.error(err);
        setMsg("No se pudo guardar. Revisa consola (rules/permisos).");
      }
    });
  });
});
