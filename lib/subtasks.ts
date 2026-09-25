export type NormalizedSubtask = {
  text: string;
  completed: boolean;
  createdAt?: Date;
};

export function normalizeSubtasks(raw: unknown): NormalizedSubtask[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map((s: any) => {
      const text =
        typeof s?.text === "string" ? s.text.trim().slice(0, 200) : "";
      if (!text || seen.has(text.toLowerCase())) return null;
      seen.add(text.toLowerCase());
      return {
        text,
        completed: s?.completed === true,
        ...(s?.createdAt ? { createdAt: new Date(s.createdAt) } : {}),
      };
    })
    .filter((s): s is NormalizedSubtask => s !== null)
    .slice(0, 100);
}