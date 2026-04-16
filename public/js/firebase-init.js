// js/firebase-init.js
// Usamos el SDK modular de Firebase desde el CDN.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// 👉 Pega aquí tu configuración de Firebase
// (la que te dio la consola: apiKey, authDomain, projectId, etc.)
const firebaseConfig = {
  // TODO: reemplaza esto con tu config real
  apiKey: "AIzaSyB5JKuSVz0p8R_Cxb8z9v-ceH737fTtNtA",
  authDomain: "hoopersnet-e2d5d.firebaseapp.com",
  projectId: "hoopersnet-e2d5d",
  storageBucket: "hoopersnet-e2d5d.firebasestorage.app",
  messagingSenderId: "281016409082",
  appId: "1:281016409082:web:2dabb1ab052e2b48146243"
};

// Inicializar app
export const app = initializeApp(firebaseConfig);

// Servicios que usaremos
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
