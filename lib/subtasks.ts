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
      // A malformed `createdAt` used to become an Invalid Date here and then
      // failed Mongoose's cast on save, turning one bad subtask into a 500 that
      // rejected the whole task. Drop just the unusable timestamp instead.
      const createdAt = s?.createdAt ? new Date(s.createdAt) : null;
      return {
        text,
        completed: s?.completed === true,
        ...(createdAt && !isNaN(createdAt.getTime()) ? { createdAt } : {}),
      };
    })
    .filter((s): s is NormalizedSubtask => s !== null)
    .slice(0, 100);
}