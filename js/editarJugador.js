// /js/editarJugador.js
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

function byId(id) { return document.getElementById(id); }

function setMensaje(texto, tipo = "error") {
  const el = byId("mensaje");
  if (!el) return;
  el.textContent = texto || "";
  el.style.color = (tipo === "ok") ? "#16a34a" : "#dc2626";
}

function val(id) { return (byId(id)?.value || "").trim(); }

async function cargarPerfil(uid) {
  const snap = await getDoc(doc(db, "profiles", uid));
  if (!snap.exists()) throw new Error("Perfil no existe");

  const p = snap.data();

  byId("nombres").value = p.nombres || "";
  byId("apellidos").value = p.apellidos || "";
  byId("nacionalidad").value = p.nacionalidad || "";
  byId("departamento").value = p.departamento || "";
  byId("ciudad").value = p.ciudad || "";
  byId("fecha_nacimiento").value = p.fechaNacimiento || "";

  byId("posicion").value = p.posicion || "";
  byId("altura").value = (p.alturaCm ?? "") === null ? "" : String(p.alturaCm ?? "");
  byId("peso").value = (p.pesoKg ?? "") === null ? "" : String(p.pesoKg ?? "");
  byId("nivel").value = p.nivelActual || "";

  
  byId("contacto_reclutadores").value = p.contactoReclutadores || "";
  byId("institucion").value = p.institucion || "";
  byId("descripcion_breve").value = p.descripcionBreve || "";
}

document.addEventListener("DOMContentLoaded", () => {
  const form = byId("form-editar-jugador");
  const btnCancelar = byId("btn-cancelar");

  btnCancelar?.addEventListener("click", () => {
    window.location.href = "/html/perfilJugador.html";
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/html/login.html";
      return;
    }

    // ✅ Guard de rol: solo jugadores pueden editarJugador.html
try {
  const uSnap = await getDoc(doc(db, "users", user.uid));
  const role = uSnap.exists() ? uSnap.data().role : null;

  if (role !== "player") {
    // si es reclutador (o rol inválido), lo mandamos a su perfil
    window.location.href = "/html/perfilReclutador.html";
    return;
  }
} catch (err) {
  console.error("No se pudo validar role:", err);
  window.location.href = "/html/feed.html";
  return;
}


    try {
      await cargarPerfil(user.uid);
    } catch (e) {
      console.error(e);
      setMensaje("No se pudo cargar tu perfil.");
    }

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setMensaje("");

      const nombres = val("nombres");
      const apellidos = val("apellidos");
      const nacionalidad = val("nacionalidad");
      const departamento = val("departamento");
      const ciudad = val("ciudad");
      const fechaNacimiento = byId("fecha_nacimiento")?.value || "";

      const posicion = byId("posicion")?.value || "";
      const altura = val("altura");
      const peso = val("peso"); // opcional
      const nivel = byId("nivel")?.value || "";

      
      const contactoReclutadores = val("contacto_reclutadores");
      const institucion = val("institucion");
      const descripcionBreve = (byId("descripcion_breve")?.value || "").trim();

      if (!nombres || !apellidos || !nacionalidad || !departamento || !ciudad || !fechaNacimiento ||
          !posicion || !altura || !nivel || !contactoReclutadores || !institucion) {
        setMensaje("Por favor completa todos los campos obligatorios.");
        return;
      }

      try {
        await updateDoc(doc(db, "profiles", user.uid), {
          nombres,
          apellidos,
          nacionalidad,
          departamento,
          ciudad,
          fechaNacimiento,
          posicion,
          alturaCm: Number(altura),
          pesoKg: peso ? Number(peso) : null,
          nivelActual: nivel,
          institucion,
         
          contactoReclutadores,
          descripcionBreve,
          updatedAt: serverTimestamp(),
        });

        setMensaje("✅ Perfil actualizado. Redirigiendo...", "ok");
        setTimeout(() => {
          window.location.href = "/html/perfilJugador.html";
        }, 700);
      } catch (err) {
        console.error(err);
        setMensaje("No se pudo guardar. Revisa consola (rules/permisos).");
      }
    });
  });
});
