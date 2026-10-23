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
    // Normalize, not just validate. `addCustomList` stores trimmed and
    // lowercased names, but anything already in storage — a hand edit, or a
    // value written before that normalization existed — kept its original case.
    // The filter then rejected nothing, so "Work" and "work" both survived as
    // two entries that render identically, and the case-sensitive `list:`
    // comparison showed an empty list whenever the task's stored name didn't
    // match the one in the sidebar by character. Normalizing on read makes the
    // sidebar and the filter agree on one spelling, and dedupe collapses the
    // duplicates.
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const name of cache) {
      if (typeof name !== "string") continue;
      const clean = name.trim().toLowerCase();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      normalized.push(clean);
    }
    cache = normalized;
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

// Another tab writing the same key fires `storage` only in the *other* tabs,
// which is exactly where this module's own listener set never reached: `write`
// notifies same-tab subscribers, but a second tab kept serving its `cache`
// forever, so a list created on one side never appeared on the other and a
// deleted one stayed in the sidebar until reload. Invalidate the cache on the
// event and let subscribers re-read.
let storageBound = false;
function handleStorage(event: StorageEvent) {
  // `key === null` means clear(); both invalidate the cached array.
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = null;
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
  if (typeof window !== "undefined" && !storageBound) {
    window.addEventListener("storage", handleStorage);
    storageBound = true;
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && storageBound && listeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
      storageBound = false;
    }
  };
}

const EMPTY_SERVER_SNAPSHOT: string[] = [];

export function useCustomLists(): string[] {
  // A module-level constant, not a fresh `[]` per call: React invokes
  // getServerSnapshot twice during hydration and compares by reference, so a
  // new array each time fails that check and logs the "should be cached"
  // warning while forcing an extra re-render.
  return useSyncExternalStore(
    subscribeCustomLists,
    getCustomLists,
    () => EMPTY_SERVER_SNAPSHOT
  );
}