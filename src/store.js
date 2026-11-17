/**
 * store.js — the field log.
 *
 * Every observation is stored locally (localStorage) FIRST, so the log
 * works fully offline and without any account. When Firestore is available
 * (configured + signed in), entries are mirrored to the scout's private
 * collection and synced back on load. Photos are stored as small data URLs
 * locally; Firestore entries carry the analysis + metadata (photo bytes
 * stay on the device to keep documents small and private by default).
 */
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";

const LOCAL_KEY = "cropsentry.fieldLog.v1";
const STATS_KEY = "cropsentry.stats.v1";

function loadLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocal(entries) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries.slice(0, 100)));
  } catch {
    // Storage full (photos are big): drop photos from the oldest entries
    // and retry once rather than losing the log.
    try {
      const slim = entries
        .slice(0, 100)
        .map((entry, i) => (i > 20 ? { ...entry, photo: null } : entry));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(slim));
    } catch {
      /* give up quietly — the in-memory log still shows */
    }
  }
}

export function loadStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
    return {
      onDevice: parsed.onDevice || 0,
      inCloud: parsed.inCloud || 0,
      cloudTokens: parsed.cloudTokens || 0,
      reports: parsed.reports || 0,
    };
  } catch {
    return { onDevice: 0, inCloud: 0, cloudTokens: 0, reports: 0 };
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* non-critical */
  }
}

export function recordInference(source, usage) {
  const stats = loadStats();
  if (source === "on_device") stats.onDevice += 1;
  else if (source === "in_cloud") stats.inCloud += 1;
  if (usage && typeof usage.totalTokenCount === "number") {
    stats.cloudTokens += usage.totalTokenCount;
  }
  saveStats(stats);
  return stats;
}

export function recordReport() {
  const stats = loadStats();
  stats.reports += 1;
  saveStats(stats);
  return stats;
}

export class FieldLog {
  constructor({ db, uid }) {
    this.db = db || null;
    this.uid = uid || null;
    this.entries = loadLocal();
  }

  list() {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id) {
    return this.entries.find((entry) => entry.id === id) || null;
  }

  /** Add an entry locally, then mirror to Firestore when available. */
  async add(entry) {
    const full = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      synced: false,
      ...entry,
    };
    this.entries.unshift(full);
    saveLocal(this.entries);
    await this.mirrorToFirestore(full);
    return full;
  }

  async update(id, patch) {
    const entry = this.get(id);
    if (!entry) return null;
    Object.assign(entry, patch);
    saveLocal(this.entries);
    return entry;
  }

  async mirrorToFirestore(entry) {
    if (!this.db || !this.uid) return;
    try {
      const { photo, ...rest } = entry; // photos stay on-device
      const ref = await addDoc(
        collection(this.db, "scouts", this.uid, "observations"),
        { ...rest, createdAt: serverTimestamp() }
      );
      entry.firestoreId = ref.id;
      entry.synced = true;
      saveLocal(this.entries);
    } catch (error) {
      console.warn("[CropSentry] Firestore mirror failed:", error);
    }
  }

  /** Pull the scout's cloud log and merge with local entries (local wins). */
  async syncFromFirestore() {
    if (!this.db || !this.uid) return this.list();
    try {
      const snap = await getDocs(
        query(
          collection(this.db, "scouts", this.uid, "observations"),
          orderBy("createdAt", "desc"),
          limit(50)
        )
      );
      const cloudEntries = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          id: `cloud-${doc.id}`,
          firestoreId: doc.id,
          synced: true,
          createdAt:
            data.createdAt && typeof data.createdAt.toMillis === "function"
              ? data.createdAt.toMillis()
              : Date.now(),
          photo: null,
        };
      });
      const seen = new Set(this.entries.map((e) => e.firestoreId).filter(Boolean));
      const merged = [
        ...this.entries,
        ...cloudEntries.filter((e) => !seen.has(e.firestoreId)),
      ];
      this.entries = merged.slice(0, 100);
      saveLocal(this.entries);
    } catch (error) {
      console.warn("[CropSentry] Firestore sync failed:", error);
    }
    return this.list();
  }
}
