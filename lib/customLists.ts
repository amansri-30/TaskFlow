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