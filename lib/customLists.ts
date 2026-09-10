import { useSyncExternalStore } from "react";

const STORAGE_KEY = "taskflow:customLists";
const MAX_LISTS = 20;

let listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : [];
    if (!Array.isArray(cache)) cache = [];
    cache = cache.filter(
      (name): name is string =>
        typeof name === "string" && !!name.trim().toLowerCase()
    );
  } catch {
    cache = [];
  }
  return cache;
}

function write(lists: string[]) {
  cache = lists;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
    } catch {
      // ignore storage errors
    }
  }
  listeners.forEach((listener) => listener());
}

export function getCustomLists(): string[] {
  return read();
}

export function addCustomList(name: string): {
  added: boolean;
  lists: string[];
} {
  const trimmed = name.trim().toLowerCase();
  const current = read();
  if (!trimmed || current.includes(trimmed) || current.length >= MAX_LISTS) {
    return { added: false, lists: current };
  }
  const next = [...current, trimmed];
  write(next);
  return { added: true, lists: next };
}

export function removeCustomList(name: string): string[] {
  const next = read().filter((item) => item !== name);
  write(next);
  return next;
}

export function subscribeCustomLists(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCustomLists(): string[] {
  return useSyncExternalStore(subscribeCustomLists, getCustomLists, () => []);
}