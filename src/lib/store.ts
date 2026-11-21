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

// The Anthropic API key lives only in this browser and is sent only to api.anthropic.com.
const API_KEY = "feynman.apiKey";
export const loadKey = () => localStorage.getItem(API_KEY) ?? "";
export const saveKey = (key: string) => (key ? localStorage.setItem(API_KEY, key) : localStorage.removeItem(API_KEY));
