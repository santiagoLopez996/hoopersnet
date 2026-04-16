// /js/puntos.js
import {
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

export const POINTS = {
  easy: 70,
  medium: 100,
  hard: 150,
};

export const RECENT_WINDOW_DAYS = 15;
export const RECENT_WEIGHT = 0.65;
export const TOTAL_WEIGHT = 0.35;
export const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Acepta: "Fácil", "facil", "easy", "medio", "medium", "difícil", "hard", etc.
export function normalizeDifficulty(d) {
  const s = String(d || "").toLowerCase().trim();

  if (["facil", "fácil", "easy", "e"].includes(s)) return "easy";
  if (["medio", "medium", "m"].includes(s)) return "medium";
  if (["dificil", "difícil", "hard", "h"].includes(s)) return "hard";

  return null;
}

export function basePointsForDifficulty(difficulty) {
  const key = normalizeDifficulty(difficulty);
  return key ? POINTS[key] : 0;
}

export function isAcceptedStatus(status) {
  const s = String(status || "").toLowerCase();
  // compatibilidad por si quedaron docs viejos
  return s === "accepted" || s === "approved";
}

// Para puntaje reciente: usa reviewedAt (cuando fue aceptado) si existe; si no, createdAt.
export function pickRelevantTimestamp(sub) {
  return sub.reviewedAt || sub.acceptedAt || sub.updatedAt || sub.createdAt || null;
}

export function pointsFromSubmission(sub) {
  // Preferimos el valor persistido en el doc (más barato y consistente)
  const p = Number(sub.basePoints);
  if (Number.isFinite(p) && p > 0) return p;

  // fallback: deduce por difficulty
  const key = normalizeDifficulty(sub.difficultyKey || sub.difficulty);
  return key ? POINTS[key] : 0;
}

function timestampToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toDate === "function") {
    const d = ts.toDate();
    return Number.isNaN(d?.getTime?.()) ? 0 : d.getTime();
  }
  if (ts instanceof Date) {
    return Number.isNaN(ts.getTime()) ? 0 : ts.getTime();
  }
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts;
  }
  return 0;
}

export function computeRankingScore(recentPoints, totalPoints) {
  const recent = Number(recentPoints) || 0;
  const total = Number(totalPoints) || 0;
  return RECENT_WEIGHT * recent + TOTAL_WEIGHT * total;
}

export function isWithinRecentWindow(ts, now = Date.now()) {
  const t = timestampToMillis(ts);
  if (!t) return false;
  return now - t <= RECENT_WINDOW_MS;
}

export function computeScoresFromSubs(subs) {
  const accepted = subs.filter((s) => isAcceptedStatus(s.status));

  const totalPoints = accepted.reduce((acc, s) => acc + pointsFromSubmission(s), 0);

  const now = Date.now();

  const points30d = accepted.reduce((acc, s) => {
    const ts = pickRelevantTimestamp(s);
    return isWithinRecentWindow(ts, now) ? acc + pointsFromSubmission(s) : acc;
  }, 0);

  const rankingScore = computeRankingScore(points30d, totalPoints);

  return {
    totalPoints,
    points30d,
    rankingScore,
  };
}

// Lee submissions aceptados del jugador (para su propio perfil)
export async function fetchAcceptedChallengeSubsForPlayer(db, playerUid) {
  // "in" con accepted+approved para compatibilidad (puede requerir índice)
  const qy = query(
    collection(db, "challenge_submissions"),
    where("playerUid", "==", playerUid),
    where("status", "in", ["accepted", "approved"])
  );

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function computePlayerChallengeScores(db, playerUid) {
  const subs = await fetchAcceptedChallengeSubsForPlayer(db, playerUid);
  return computeScoresFromSubs(subs);
}