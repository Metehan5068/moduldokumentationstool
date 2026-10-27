import type { LectureState } from '../shared/state';

/** Throttle mit Nachlauf: Scrollen setzt den Termin nicht immer weiter zurück. */
export class PositionSession {
  state: LectureState;
  error?: string;
  private acknowledged: string;
  private lastStarted = Date.now();
  private timer?: ReturnType<typeof setTimeout>;
  private requests = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(readonly id: string, initial: LectureState) {
    this.state = { ...initial, selection: { ...initial.selection } };
    this.acknowledged = initial.updatedAt;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(); }
  private dirty() { return Date.parse(this.state.updatedAt) > Date.parse(this.acknowledged); }
  update(next: Omit<LectureState, 'updatedAt'>, touch = false) {
    if (!touch && JSON.stringify({ ...this.state, updatedAt: undefined }) === JSON.stringify({ ...next, updatedAt: undefined })) return;
    this.state = { ...next, selection: { ...next.selection }, maxPageVisited: Math.max(this.state.maxPageVisited, next.maxPageVisited),
      updatedAt: new Date(Math.max(Date.now(), Date.parse(this.state.updatedAt) + 1)).toISOString() };
    this.schedule();
  }
  private schedule(delay = Math.max(0, 1500 - (Date.now() - this.lastStarted))) {
    if (this.disposed || this.timer !== undefined || !this.dirty()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.requests.size === 0) void this.flush(false, false);
    }, delay);
  }
  async flush(keepalive = false, drain = true): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    if (!keepalive && this.requests.size) {
      if (!drain) return;
      await Promise.all(this.requests.values());
    }
    if (!this.dirty()) return;
    const snapshot = this.state;
    const version = snapshot.updatedAt;
    const pending = this.requests.get(version);
    if (pending) { await pending; return; }
    this.lastStarted = Date.now();
    const request = Promise.resolve().then(async () => {
      try {
        const response = await fetch(`/api/lectures/${this.id}/state`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), keepalive,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Date.parse(version) > Date.parse(this.acknowledged)) this.acknowledged = version;
        if (!this.dirty()) this.error = undefined;
      } catch {
        if (Date.parse(version) > Date.parse(this.acknowledged)) this.error = 'Leseposition konnte nicht gespeichert werden.';
      } finally {
        this.requests.delete(version);
        this.notify();
        if (this.dirty()) this.schedule(this.error ? 5000 : undefined);
      }
    });
    this.requests.set(version, request);
    await request;
    if (drain && !keepalive && !this.error && this.dirty()) await this.flush();
  }
  dispose() {
    clearTimeout(this.timer); this.timer = undefined; this.disposed = true;
    void this.flush(true); this.listeners.clear();
  }
}
