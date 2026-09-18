const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;

export function normalizeTags(raw: unknown): string[] {
  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    items = raw.split(",");
  } else {
    return [];
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.size >= MAX_TAGS) break;
    const tag = String(item)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, MAX_TAG_LENGTH);
    if (tag) seen.add(tag);
  }
  return Array.from(seen);
}