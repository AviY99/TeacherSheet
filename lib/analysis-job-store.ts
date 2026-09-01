"use client";

import type { AnalyzeResponse, LocalAnalysisCheckpoint } from "./types";

const DB_NAME = "teachersheet-local-jobs";
const DB_VERSION = 1;
const STORE = "jobs";
const ACTIVE_KEY = "active";
const MAX_RESUME_AGE_MS = 30 * 60 * 1000;

export interface SavedAnalysisJob {
  key: typeof ACTIVE_KEY;
  id: string;
  sourceKind: "camera" | "image" | "pdf" | "word" | "text";
  file?: File | null;
  text?: string;
  startedAt: number;
  updatedAt: number;
  status: "running" | "checkpoint" | "completed";
  stage: string;
  progress: number;
  checkpoint?: LocalAnalysisCheckpoint;
  result?: AnalyzeResponse;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open analysis job database."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Analysis job storage failed."));
      tx.onerror = () => reject(tx.error || new Error("Analysis job transaction failed."));
    });
  } finally {
    db.close();
  }
}

export async function saveActiveAnalysisJob(job: Omit<SavedAnalysisJob, "key" | "updatedAt"> & { updatedAt?: number }) {
  if (typeof indexedDB === "undefined") return;

  // Persistence is only for an analysis that may need to resume. A completed
  // result must never become the application's next start screen.
  if (job.status === "completed") {
    await clearActiveAnalysisJob();
    return;
  }

  await withStore("readwrite", (store) => store.put({
    ...job,
    key: ACTIVE_KEY,
    updatedAt: job.updatedAt || Date.now()
  } as SavedAnalysisJob));
}

export async function loadActiveAnalysisJob(): Promise<SavedAnalysisJob | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const value = await withStore<SavedAnalysisJob | undefined>("readonly", (store) => store.get(ACTIVE_KEY));
    if (!value) return null;

    const tooOld = Date.now() - value.updatedAt > MAX_RESUME_AGE_MS;
    if (value.status === "completed" || tooOld) {
      await clearActiveAnalysisJob();
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

export async function clearActiveAnalysisJob() {
  if (typeof indexedDB === "undefined") return;
  try {
    await withStore("readwrite", (store) => store.delete(ACTIVE_KEY));
  } catch {
    // Resume persistence must never block the worksheet flow.
  }
}
