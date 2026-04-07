const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

const VIDEO_WINDOW_DAYS = 7;
const VIDEO_WINDOW_MS = VIDEO_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const MAX_VIDEOS_PER_WINDOW = 3;
const VIDEO_TICKET_TTL_MINUTES = 30;
const POST_POINTS = 10;

const RECENT_WINDOW_DAYS = 15;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const RECENT_WEIGHT = 0.65;
const TOTAL_WEIGHT = 0.35;

function quotaExceededMessage() {
  return "Se agotaron tus subidas de videos semanales. Podrás volver a subir dentro de 7 dias.";
}

function nowMs() {
  return Date.now();
}

function timestampFromMs(ms) {
  return admin.firestore.Timestamp.fromMillis(ms);
}

function timestampToMs(ts) {
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

function normalizeDifficulty(d) {
  const s = String(d || "").toLowerCase().trim();
  if (["facil", "fácil", "easy", "e"].includes(s)) return "easy";
  if (["medio", "medium", "m"].includes(s)) return "medium";
  if (["dificil", "difícil", "hard", "h"].includes(s)) return "hard";
  return null;
}

function basePointsForDifficulty(difficulty) {
  const key = normalizeDifficulty(difficulty);
  if (key === "easy") return 70;
  if (key === "hard") return 150;
  return 100;
}

function challengeIsClosed(ch) {
  if (!ch) return true;

  const status = String(ch.status || "").toLowerCase().trim();
  if (status === "closed") return true;

  const slots = Number(ch.slots || 0);
  const used = Number(ch.slotsUsed || 0);
  if (slots > 0 && used >= slots) return true;

  const closesAtMs = ch.closesAt?.toMillis ? ch.closesAt.toMillis() : null;
  if (Number.isFinite(closesAtMs) && closesAtMs <= nowMs()) return true;

  return false;
}

function pruneRecentUploads(rawList, baseNowMs = nowMs()) {
  const cutoff = baseNowMs - VIDEO_WINDOW_MS;

  return (Array.isArray(rawList) ? rawList : [])
    .map((value) => {
      if (value?.toMillis) return value.toMillis();
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      return null;
    })
    .filter((ms) => Number.isFinite(ms) && ms >= cutoff)
    .sort((a, b) => a - b)
    .map((ms) => timestampFromMs(ms));
}

async function ensureQuotaState(uid) {
  const quotaRef = db.doc(`video_upload_state/${uid}`);
  const existing = await quotaRef.get();

  if (existing.exists) {
    return { ref: quotaRef, data: existing.data() || {} };
  }

  const since = timestampFromMs(nowMs() - VIDEO_WINDOW_MS);

  const [postsSnap, submissionsSnap] = await Promise.all([
    db.collection("posts")
      .where("ownerUid", "==", uid)
      .where("createdAt", ">=", since)
      .get(),
    db.collection("challenge_submissions")
      .where("playerUid", "==", uid)
      .where("createdAt", ">=", since)
      .get(),
  ]);

  const recentUploadsMs = [];

  postsSnap.forEach((docSnap) => {
    const ts = docSnap.get("createdAt");
    if (ts?.toMillis) recentUploadsMs.push(ts.toMillis());
  });

  submissionsSnap.forEach((docSnap) => {
    const ts = docSnap.get("createdAt");
    if (ts?.toMillis) recentUploadsMs.push(ts.toMillis());
  });

  const uniqueSorted = [...new Set(recentUploadsMs)]
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b)
    .map((ms) => timestampFromMs(ms));

  try {
    await quotaRef.create({
      recentUploads: uniqueSorted,
      bootstrappedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (_) {}

  const fresh = await quotaRef.get();
  return {
    ref: quotaRef,
    data: fresh.exists ? (fresh.data() || {}) : { recentUploads: uniqueSorted },
  };
}

async function getUserDoc(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function getProfileDoc(uid) {
  const snap = await db.doc(`profiles/${uid}`).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function getTicketOrThrow(ticketId) {
  const ticketRef = db.doc(`video_upload_tickets/${ticketId}`);
  const ticketSnap = await ticketRef.get();

  if (!ticketSnap.exists) {
    throw new HttpsError("not-found", "No encontré el ticket de subida.");
  }

  return { ref: ticketRef, data: ticketSnap.data() || {} };
}

function assertPlayerRole(userData) {
  if (String(userData.role || "") !== "player") {
    throw new HttpsError("permission-denied", "Solo los jugadores pueden subir videos.");
  }
}

async function getDownloadUrlFromPath(fullPath) {
  const file = bucket.file(fullPath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError("failed-precondition", "El video no existe en Storage.");
  }

  const [metadata] = await file.getMetadata();
  const meta = metadata.metadata || {};

  let token = meta.firebaseStorageDownloadTokens || meta.downloadTokens || "";
  if (!token) {
    token = crypto.randomUUID();
    await file.setMetadata({
      metadata: {
        ...meta,
        firebaseStorageDownloadTokens: token,
      },
    });
  }

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fullPath)}?alt=media&token=${token}`;
}

function isAcceptedStatus(status) {
  const s = String(status || "").toLowerCase().trim();
  return s === "accepted" || s === "approved";
}

function computeRankingScore(recentPoints, totalPoints) {
  const recent = Number(recentPoints) || 0;
  const total = Number(totalPoints) || 0;
  return RECENT_WEIGHT * recent + TOTAL_WEIGHT * total;
}

function isWithinRecentWindow(ts, now = Date.now()) {
  const t = timestampToMs(ts);
  if (!t) return false;
  return now - t <= RECENT_WINDOW_MS;
}

function pickRelevantSubmissionTimestamp(sub) {
  return sub.reviewedAt || sub.acceptedAt || sub.updatedAt || sub.createdAt || null;
}

function pickRelevantPostTimestamp(post) {
  return post.createdAt || post.pointsAwardedAt || post.updatedAt || null;
}

function pointsFromSubmissionForRanking(sub) {
  const persisted = Number(sub.basePoints);
  if (Number.isFinite(persisted) && persisted > 0) return persisted;

  const fallback = basePointsForDifficulty(sub.difficultyKey || sub.difficulty);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function pointsFromPostForRanking(post) {
  const persisted = Number(post.pointsAwarded);
  if (Number.isFinite(persisted) && persisted > 0) return persisted;
  return POST_POINTS;
}

async function fetchPostsForOwner(uid) {
  const snap = await db.collection("posts")
    .where("ownerUid", "==", uid)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function fetchChallengeSubsForPlayer(uid) {
  const snap = await db.collection("challenge_submissions")
    .where("playerUid", "==", uid)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

function computeScoresFromPostsForProfile(posts = []) {
  const now = Date.now();
  let totalPoints = 0;
  let points30d = 0; // se mantiene el nombre por compatibilidad

  for (const post of posts) {
    if (post?.deleted === true || post?.isDeleted === true) continue;

    const pts = pointsFromPostForRanking(post);
    totalPoints += pts;

    const ts = pickRelevantPostTimestamp(post);
    if (isWithinRecentWindow(ts, now)) {
      points30d += pts;
    }
  }

  return { totalPoints, points30d };
}

function computeScoresFromChallengeSubsForProfile(subs = []) {
  const accepted = subs.filter((s) => isAcceptedStatus(s.status));
  const now = Date.now();

  let totalPoints = 0;
  let points30d = 0; // se mantiene el nombre por compatibilidad

  for (const sub of accepted) {
    const pts = pointsFromSubmissionForRanking(sub);
    totalPoints += pts;

    const ts = pickRelevantSubmissionTimestamp(sub);
    if (isWithinRecentWindow(ts, now)) {
      points30d += pts;
    }
  }

  return { totalPoints, points30d };
}

async function recomputeAndPersistProfileScores(uid) {
  const [posts, subs] = await Promise.all([
    fetchPostsForOwner(uid),
    fetchChallengeSubsForPlayer(uid),
  ]);

  const postScores = computeScoresFromPostsForProfile(posts);
  const challengeScores = computeScoresFromChallengeSubsForProfile(subs);

  const scoreTotal =
    (Number(postScores.totalPoints) || 0) +
    (Number(challengeScores.totalPoints) || 0);

  const score30d =
    (Number(postScores.points30d) || 0) +
    (Number(challengeScores.points30d) || 0);

  const rankingScore = computeRankingScore(score30d, scoreTotal);

  await db.doc(`profiles/${uid}`).set({
    scoreTotal,
    score30d,
    rankingScore,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    scoreUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { scoreTotal, score30d, rankingScore };
}

exports.issueVideoUploadTicket = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const kind = String(request.data?.kind || "").trim();
  if (!["post", "challenge"].includes(kind)) {
    throw new HttpsError("invalid-argument", "Tipo de subida inválido.");
  }

  const userData = await getUserDoc(uid);
  assertPlayerRole(userData);

  const quotaState = await ensureQuotaState(uid);
  const recentUploads = pruneRecentUploads(quotaState.data.recentUploads);

  if (recentUploads.length >= MAX_VIDEOS_PER_WINDOW) {
    throw new HttpsError("resource-exhausted", quotaExceededMessage());
  }

  const ticketRef = db.collection("video_upload_tickets").doc();
  const expiresAt = timestampFromMs(nowMs() + VIDEO_TICKET_TTL_MINUTES * 60 * 1000);

  if (kind === "post") {
    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError("failed-precondition", "Debes verificar tu correo antes de publicar.");
    }

    const postId = db.collection("posts").doc().id;
    const videoPath = `posts/${uid}/${ticketRef.id}/video`;

    await ticketRef.set({
      uid,
      kind: "post",
      status: "open",
      postId,
      videoPath,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    });

    return {
      ok: true,
      ticketId: ticketRef.id,
      postId,
      videoPath,
      remainingBeforeUpload: MAX_VIDEOS_PER_WINDOW - recentUploads.length,
    };
  }

  const challengeId = String(request.data?.challengeId || "").trim();
  if (!challengeId) {
    throw new HttpsError("invalid-argument", "challengeId es obligatorio.");
  }

  const challengeRef = db.doc(`challenges/${challengeId}`);
  const submissionId = `${challengeId}_${uid}`;
  const submissionRef = db.doc(`challenge_submissions/${submissionId}`);

  const [challengeSnap, submissionSnap] = await Promise.all([
    challengeRef.get(),
    submissionRef.get(),
  ]);

  if (!challengeSnap.exists) {
    throw new HttpsError("not-found", "El reto ya no existe.");
  }

  if (submissionSnap.exists) {
    throw new HttpsError("already-exists", "Ya enviaste un intento para este reto.");
  }

  const challenge = challengeSnap.data() || {};
  if (challengeIsClosed(challenge)) {
    throw new HttpsError("failed-precondition", "Este reto ya cerró.");
  }

  const videoPath = `challenge_submissions/${challengeId}/${uid}/${ticketRef.id}/video`;

  await ticketRef.set({
    uid,
    kind: "challenge",
    status: "open",
    challengeId,
    submissionId,
    videoPath,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  return {
    ok: true,
    ticketId: ticketRef.id,
    challengeId,
    submissionId,
    videoPath,
    remainingBeforeUpload: MAX_VIDEOS_PER_WINDOW - recentUploads.length,
  };
});

exports.finalizePostUpload = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const ticketId = String(request.data?.ticketId || "").trim();
  const title = String(request.data?.title || "").trim();
  const description = String(request.data?.description || "").trim();
  const type = String(request.data?.type || "").trim();
  const videoPath = String(request.data?.videoPath || "").trim();

  if (!ticketId || !title || !type || !videoPath) {
    throw new HttpsError("invalid-argument", "Faltan datos para finalizar la publicación.");
  }

  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Debes verificar tu correo antes de publicar.");
  }

  const userData = await getUserDoc(uid);
  assertPlayerRole(userData);

  const { data: ticketData } = await getTicketOrThrow(ticketId);
  if (ticketData.uid !== uid || ticketData.kind !== "post") {
    throw new HttpsError("permission-denied", "Este ticket no te pertenece.");
  }
  if (ticketData.status !== "open") {
    throw new HttpsError("failed-precondition", "Este ticket ya fue usado o ya no está disponible.");
  }
  if (ticketData.videoPath !== videoPath) {
    throw new HttpsError("failed-precondition", "La ruta del video no coincide con el ticket.");
  }

  const profileData = await getProfileDoc(uid);
  const ownerNombre = `${String(profileData.nombres || "").trim()} ${String(profileData.apellidos || "").trim()}`.trim()
    || String(request.auth?.token?.email || "Jugador").trim();
  const ownerPosicion = String(profileData.posicion || "").trim();
  const ownerCiudad = String(profileData.ciudad || "").trim();
  const postId = String(ticketData.postId || "").trim();
  const quotaRef = db.doc(`video_upload_state/${uid}`);
  const ticketRef = db.doc(`video_upload_tickets/${ticketId}`);
  const postRef = db.doc(`posts/${postId}`);
  const downloadURL = await getDownloadUrlFromPath(videoPath);

  await ensureQuotaState(uid);

  await db.runTransaction(async (tx) => {
    const quotaSnap = await tx.get(quotaRef);
    const ticketSnap = await tx.get(ticketRef);
    const postSnap = await tx.get(postRef);

    if (!ticketSnap.exists) {
      throw new HttpsError("not-found", "No encontré el ticket de subida.");
    }

    const freshTicket = ticketSnap.data() || {};
    if (freshTicket.uid !== uid || freshTicket.kind !== "post") {
      throw new HttpsError("permission-denied", "Este ticket no te pertenece.");
    }
    if (freshTicket.status !== "open") {
      throw new HttpsError("failed-precondition", "Este ticket ya fue usado o ya no está disponible.");
    }
    if (freshTicket.videoPath !== videoPath) {
      throw new HttpsError("failed-precondition", "La ruta del video no coincide con el ticket.");
    }
    if (!freshTicket.expiresAt?.toMillis || freshTicket.expiresAt.toMillis() <= nowMs()) {
      throw new HttpsError("deadline-exceeded", "La reserva de subida expiró. Vuelve a intentarlo.");
    }
    if (postSnap.exists) {
      throw new HttpsError("already-exists", "Esta publicación ya fue creada.");
    }

    const txNow = nowMs();
    const createdAt = timestampFromMs(txNow);
    const recentUploads = pruneRecentUploads(quotaSnap.exists ? quotaSnap.data()?.recentUploads : [], txNow);

    if (recentUploads.length >= MAX_VIDEOS_PER_WINDOW) {
      throw new HttpsError("resource-exhausted", quotaExceededMessage());
    }

    tx.set(postRef, {
      ownerUid: uid,
      ownerNombre,
      ownerPosicion,
      ownerCiudad,
      title,
      description,
      type,
      videoUrl: downloadURL,
      videoPath,
      visibility: "public",
      createdAt,
      pointsAwarded: POST_POINTS,
      pointsType: "post",
      pointsAwardedAt: createdAt,
    });

    tx.set(quotaRef, {
      recentUploads: [...recentUploads, createdAt],
      updatedAt: createdAt,
    }, { merge: true });

    tx.update(ticketRef, {
      status: "used",
      usedAt: createdAt,
      usedFor: "post",
    });
  });

  await recomputeAndPersistProfileScores(uid);

  return {
    ok: true,
    postId,
    videoUrl: downloadURL,
  };
});

exports.submitChallengeAttempt = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const ticketId = String(request.data?.ticketId || "").trim();
  const videoPath = String(request.data?.videoPath || "").trim();
  if (!ticketId || !videoPath) {
    throw new HttpsError("invalid-argument", "Faltan datos para enviar el intento.");
  }

  const userData = await getUserDoc(uid);
  assertPlayerRole(userData);

  const profileData = await getProfileDoc(uid);
  const playerName = `${String(profileData.nombres || "").trim()} ${String(profileData.apellidos || "").trim()}`.trim()
    || String(request.auth?.token?.email || "Jugador").trim();

  const { data: ticketData } = await getTicketOrThrow(ticketId);
  if (ticketData.uid !== uid || ticketData.kind !== "challenge") {
    throw new HttpsError("permission-denied", "Este ticket no te pertenece.");
  }
  if (ticketData.status !== "open") {
    throw new HttpsError("failed-precondition", "Este ticket ya fue usado o ya no está disponible.");
  }
  if (ticketData.videoPath !== videoPath) {
    throw new HttpsError("failed-precondition", "La ruta del video no coincide con el ticket.");
  }

  const challengeId = String(ticketData.challengeId || "").trim();
  const submissionId = String(ticketData.submissionId || `${challengeId}_${uid}`).trim();
  const quotaRef = db.doc(`video_upload_state/${uid}`);
  const ticketRef = db.doc(`video_upload_tickets/${ticketId}`);
  const challengeRef = db.doc(`challenges/${challengeId}`);
  const submissionRef = db.doc(`challenge_submissions/${submissionId}`);
  const downloadURL = await getDownloadUrlFromPath(videoPath);

  await ensureQuotaState(uid);

  await db.runTransaction(async (tx) => {
    const quotaSnap = await tx.get(quotaRef);
    const ticketSnap = await tx.get(ticketRef);
    const challengeSnap = await tx.get(challengeRef);
    const submissionSnap = await tx.get(submissionRef);

    if (!ticketSnap.exists) {
      throw new HttpsError("not-found", "No encontré el ticket de subida.");
    }

    const freshTicket = ticketSnap.data() || {};
    if (freshTicket.uid !== uid || freshTicket.kind !== "challenge") {
      throw new HttpsError("permission-denied", "Este ticket no te pertenece.");
    }
    if (freshTicket.status !== "open") {
      throw new HttpsError("failed-precondition", "Este ticket ya fue usado o ya no está disponible.");
    }
    if (freshTicket.videoPath !== videoPath) {
      throw new HttpsError("failed-precondition", "La ruta del video no coincide con el ticket.");
    }
    if (!freshTicket.expiresAt?.toMillis || freshTicket.expiresAt.toMillis() <= nowMs()) {
      throw new HttpsError("deadline-exceeded", "La reserva de subida expiró. Vuelve a intentarlo.");
    }

    if (!challengeSnap.exists) {
      throw new HttpsError("not-found", "El reto ya no existe.");
    }
    if (submissionSnap.exists) {
      throw new HttpsError("already-exists", "Ya enviaste un intento para este reto.");
    }

    const challenge = challengeSnap.data() || {};
    if (challengeIsClosed(challenge)) {
      throw new HttpsError("failed-precondition", "Este reto ya cerró.");
    }

    const txNow = nowMs();
    const createdAt = timestampFromMs(txNow);
    const recentUploads = pruneRecentUploads(quotaSnap.exists ? quotaSnap.data()?.recentUploads : [], txNow);

    if (recentUploads.length >= MAX_VIDEOS_PER_WINDOW) {
      throw new HttpsError("resource-exhausted", quotaExceededMessage());
    }

    const difficultyKey = normalizeDifficulty(challenge.difficulty) || "medium";
    const basePoints = basePointsForDifficulty(difficultyKey);
    const slots = Number(challenge.slots || 0);
    const used = Number(challenge.slotsUsed || 0);
    const newUsed = used + 1;

    if (slots > 0 && used >= slots) {
      throw new HttpsError("failed-precondition", "Cupos llenos.");
    }

    tx.set(submissionRef, {
      challengeId,
      playerUid: uid,
      playerName,
      videoUrl: downloadURL,
      videoPath,
      status: "pending",
      createdAt,
      difficultyKey,
      basePoints,
    });

    tx.update(challengeRef, {
      slotsUsed: newUsed,
      status: (slots > 0 && newUsed >= slots) ? "closed" : "active",
    });

    tx.set(quotaRef, {
      recentUploads: [...recentUploads, createdAt],
      updatedAt: createdAt,
    }, { merge: true });

    tx.update(ticketRef, {
      status: "used",
      usedAt: createdAt,
      usedFor: "challenge",
    });
  });

  return {
    ok: true,
    challengeId,
    submissionId,
    videoUrl: downloadURL,
  };
});

exports.awardChallengePoints = onDocumentUpdated(
  "challenge_submissions/{subId}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    const prevStatus = before.status;
    const newStatus = after.status;

    if (newStatus !== "accepted" || prevStatus === "accepted") return;

    const playerUid = after.playerUid;
    if (!playerUid) return;

    if (after.pointsAwarded === true) return;

    const pts = Number(after.basePoints || 0);
    if (!Number.isFinite(pts) || pts <= 0) return;

    const subRef = event.data.after.ref;

    await db.runTransaction(async (tx) => {
      tx.update(subRef, {
        pointsAwarded: true,
        pointsAwardedAt: admin.firestore.FieldValue.serverTimestamp(),
        pointsAwardedValue: pts,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await recomputeAndPersistProfileScores(playerUid);
  }
);

exports.createContactRevealOnAccept = onDocumentUpdated(
  "contact_requests/{playerUid}/items/{recruiterUid}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    if (after.status !== "accepted" || before.status === "accepted") return;

    const playerUid = event.params.playerUid;
    const recruiterUid = event.params.recruiterUid;

    const revealRef = db.doc(`contact_reveals/${playerUid}/items/${recruiterUid}`);
    const playerUserRef = db.doc(`users/${playerUid}`);
    const recruiterUserRef = db.doc(`users/${recruiterUid}`);

    await db.runTransaction(async (tx) => {
      const revealSnap = await tx.get(revealRef);
      if (revealSnap.exists) return;

      const pSnap = await tx.get(playerUserRef);
      const rSnap = await tx.get(recruiterUserRef);

      const authAdmin = admin.auth();

      let playerEmail = (pSnap.exists ? (pSnap.data()?.contactEmail || "") : "").toString().trim();
      let recruiterEmail = (rSnap.exists ? (rSnap.data()?.contactEmail || "") : "").toString().trim();

      if (!playerEmail) {
        try {
          const u = await authAdmin.getUser(playerUid);
          playerEmail = (u.email || "").toString().trim();
        } catch (_) {}
      }

      if (!recruiterEmail) {
        try {
          const u = await authAdmin.getUser(recruiterUid);
          recruiterEmail = (u.email || "").toString().trim();
        } catch (_) {}
      }

      if (!playerEmail && !recruiterEmail) return;

      tx.set(revealRef, {
        playerUid,
        recruiterUid,
        playerEmail,
        recruiterEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });

      if (playerEmail && !(pSnap.exists && (pSnap.data()?.contactEmail || "").toString().trim())) {
        tx.set(playerUserRef, { contactEmail: playerEmail }, { merge: true });
      }

      if (recruiterEmail && !(rSnap.exists && (rSnap.data()?.contactEmail || "").toString().trim())) {
        tx.set(recruiterUserRef, { contactEmail: recruiterEmail }, { merge: true });
      }

      tx.update(event.data.after.ref, {
        revealedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }
);