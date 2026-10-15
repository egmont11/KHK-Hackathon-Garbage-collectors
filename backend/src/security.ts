import { createHash } from "node:crypto";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Reserve before asynchronous work; never evict active entries to admit another identity. */
export class WindowLimiter {
  private readonly entries = new Map<string, { count: number; until: number }>();
  constructor(private readonly capacity = 10_000) {}
  take(key: string, limit: number, windowMs: number, now = Date.now()): number {
    let entry = this.entries.get(key);
    if (entry && entry.until <= now) { this.entries.delete(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= this.capacity) {
        for (const [id, row] of this.entries) if (row.until <= now) this.entries.delete(id);
        if (this.entries.size >= this.capacity) return Math.ceil(windowMs / 1000);
      }
      entry = { count: 0, until: now + windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= limit) return Math.max(1, Math.ceil((entry.until - now) / 1000));
    entry.count++;
    return 0;
  }
}

/** CSV quoting alone does not make spreadsheet formulas safe. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
