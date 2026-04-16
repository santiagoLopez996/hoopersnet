// /js/puntosPublicaciones.js
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

export const POST_POINTS = 10;

const RECENT_WINDOW_DAYS = 15;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const RECENT_WEIGHT = 0.65;
const TOTAL_WEIGHT = 0.35;

console.log("[HN] puntosPublicaciones.js cargado ✅");

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.toDate === "function") {
    const d = ts.toDate();
    return Number.isNaN(d?.getTime?.()) ? 0 : d.getTime();
  }
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? 0 : ts.getTime();
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  return 0;
}

function isWithinRecentWindow(ts, now = Date.now()) {
  const t = tsToMs(ts);
  if (!t) return false;
  return now - t <= RECENT_WINDOW_MS;
}

function computeRankingScore(recentPoints, totalPoints) {
  const recent = Number(recentPoints) || 0;
  const total = Number(totalPoints) || 0;
  return RECENT_WEIGHT * recent + TOTAL_WEIGHT * total;
}

function isAcceptedStatus(status) {
  const s = String(status || "").toLowerCase().trim();
  return s === "accepted" || s === "approved";
}

function pickPostPoints(post) {
  const pts = Number(post?.pointsAwarded);
  if (Number.isFinite(pts) && pts > 0) return pts;
  return POST_POINTS;
}

function pickChallengePoints(sub) {
  const pts = Number(sub?.basePoints);
  if (Number.isFinite(pts) && pts > 0) return pts;
  return 0;
}

function pickRelevantPostTimestamp(post) {
  return post.createdAt || post.pointsAwardedAt || post.updatedAt || null;
}

function pickRelevantChallengeTimestamp(sub) {
  return sub.reviewedAt || sub.acceptedAt || sub.updatedAt || sub.createdAt || null;
}

async function fetchPostsForOwner(db, ownerUid) {
  const qy = query(
    collection(db, "posts"),
    where("ownerUid", "==", ownerUid)
  );

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function fetchChallengeSubsForPlayer(db, playerUid) {
  const qy = query(
    collection(db, "challenge_submissions"),
    where("playerUid", "==", playerUid)
  );

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

function computePostScores(posts = []) {
  const now = Date.now();
  let totalPoints = 0;
  let recentPoints = 0;

  for (const post of posts) {
    if (post?.deleted === true || post?.isDeleted === true) continue;

    const pts = pickPostPoints(post);
    totalPoints += pts;

    const ts = pickRelevantPostTimestamp(post);
    if (isWithinRecentWindow(ts, now)) {
      recentPoints += pts;
    }
  }

  return { totalPoints, recentPoints };
}

function computeChallengeScores(subs = []) {
  const now = Date.now();
  let totalPoints = 0;
  let recentPoints = 0;

  for (const sub of subs) {
    if (!isAcceptedStatus(sub?.status)) continue;

    const pts = pickChallengePoints(sub);
    totalPoints += pts;

    const ts = pickRelevantChallengeTimestamp(sub);
    if (isWithinRecentWindow(ts, now)) {
      recentPoints += pts;
    }
  }

  return { totalPoints, recentPoints };
}

async function recomputeAndPersistProfileScores(db, uid) {
  const [posts, subs] = await Promise.all([
    fetchPostsForOwner(db, uid),
    fetchChallengeSubsForPlayer(db, uid),
  ]);

  const postScores = computePostScores(posts);
  const challengeScores = computeChallengeScores(subs);

  const scoreTotal =
    (Number(postScores.totalPoints) || 0) +
    (Number(challengeScores.totalPoints) || 0);

  const score30d =
    (Number(postScores.recentPoints) || 0) +
    (Number(challengeScores.recentPoints) || 0);

  const rankingScore = computeRankingScore(score30d, scoreTotal);

  await setDoc(
    doc(db, "profiles", uid),
    {
      scoreTotal,
      score30d,
      rankingScore,
      updatedAt: serverTimestamp(),
      scoreUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { scoreTotal, score30d, rankingScore };
}

// Compatibilidad: si algún flujo viejo todavía llama esto
export async function onPostCreated(db, postId, ownerUid, points = POST_POINTS) {
  console.log("[HN] onPostCreated()", { postId, ownerUid, points });
  await recomputeAndPersistProfileScores(db, ownerUid);
}

export async function onPostDeleted(db, postId, currentUid) {
  console.log("[HN] onPostDeleted()", { postId, currentUid });

  const postRef = doc(db, "posts", postId);
  const snap = await getDoc(postRef);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  if (data.ownerUid !== currentUid) {
    throw new Error("No autorizado.");
  }

  await deleteDoc(postRef);
  await recomputeAndPersistProfileScores(db, currentUid);
}