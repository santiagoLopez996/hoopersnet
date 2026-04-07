import { app } from "./firebase-init.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const functions = getFunctions(app, "us-central1");
const storage = getStorage(app);

const issueVideoUploadTicketFn = httpsCallable(functions, "issueVideoUploadTicket");
const finalizePostUploadFn = httpsCallable(functions, "finalizePostUpload");
const submitChallengeAttemptFn = httpsCallable(functions, "submitChallengeAttempt");

export function normalizeCallableError(err, fallback = "Ocurrió un error.") {
  const msg = String(err?.message || "").trim().replace(/^Error:\s*/i, "");
  return msg || fallback;
}

export async function reservePostUploadSlot() {
  const { data } = await issueVideoUploadTicketFn({ kind: "post" });
  return data;
}

export async function reserveChallengeUploadSlot(challengeId) {
  const { data } = await issueVideoUploadTicketFn({ kind: "challenge", challengeId });
  return data;
}

export function uploadVideoToReservedPath({ videoPath, file, onProgress }) {
  const ref = storageRef(storage, videoPath);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, {
      contentType: file?.type || undefined,
    });

    task.on(
      "state_changed",
      (snap) => {
        if (!onProgress) return;
        const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
        onProgress(pct);
      },
      (err) => reject(err),
      async () => {
        try {
          const downloadURL = await getDownloadURL(task.snapshot.ref);
          resolve({
            downloadURL,
            fullPath: task.snapshot.ref.fullPath,
            ref: task.snapshot.ref,
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

export async function finalizeReservedPostUpload({ ticketId, title, description, type, videoPath }) {
  const { data } = await finalizePostUploadFn({
    ticketId,
    title,
    description,
    type,
    videoPath,
  });
  return data;
}

export async function finalizeReservedChallengeUpload({ ticketId, videoPath }) {
  const { data } = await submitChallengeAttemptFn({
    ticketId,
    videoPath,
  });
  return data;
}

export async function cleanupUploadedVideo(refOrPath) {
  try {
    const ref = typeof refOrPath === "string" ? storageRef(storage, refOrPath) : refOrPath;
    await deleteObject(ref);
  } catch (_) {}
}