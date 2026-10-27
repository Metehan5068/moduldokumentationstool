/** Alle Dateien einer Vorlesung werden innerhalb derselben Promise-Kette geschrieben. */
export class WriteQueue {
  private queues = new Map<string, Promise<unknown>>();
  run<T>(id: string, job: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(job);
    const settled = result.catch(() => undefined);
    this.queues.set(id, settled);
    void settled.then(() => { if (this.queues.get(id) === settled) this.queues.delete(id); });
    return result;
  }
}
