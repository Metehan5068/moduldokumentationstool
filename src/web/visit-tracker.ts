/** Verweildauer zählt nur innerhalb einer ununterbrochenen Sichtbarkeit im sichtbaren Tab. */
export class VisitTracker {
  private since = new Map<number, number>();
  constructor(public maximum: number) {}
  update(pages: number[], foreground: boolean, now = performance.now()): number {
    const visible = new Set(foreground ? pages : []);
    for (const page of this.since.keys()) if (!visible.has(page) || page <= this.maximum) this.since.delete(page);
    for (const page of visible) {
      if (page <= this.maximum) continue;
      const start = this.since.get(page) ?? now;
      this.since.set(page, start);
      if (now - start >= 3000) this.edited(page);
    }
    return this.maximum;
  }
  edited(page: number) {
    this.maximum = Math.max(this.maximum, page);
    for (const candidate of this.since.keys()) if (candidate <= this.maximum) this.since.delete(candidate);
  }
  nextDelay(now = performance.now()): number | undefined {
    return this.since.size ? Math.max(0, Math.min(...this.since.values()) + 3000 - now) : undefined;
  }
}
