import type { Session } from "../types.ts";
import { normalize } from "./tree.ts";

const KEY = "feynman.sessions.v1";
const CURRENT = "feynman.current";

export function loadSessions(): Session[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Session[];
    return Array.isArray(raw) ? raw.map(normalize) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // Storage full or unavailable: the app still works for this visit.
  }
}

export const loadCurrent = () => localStorage.getItem(CURRENT);
export const saveCurrent = (id: string | null) => (id ? localStorage.setItem(CURRENT, id) : localStorage.removeItem(CURRENT));
