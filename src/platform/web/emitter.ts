// Node's EventEmitter for browsers (which have none): its methods, with the same behaviour —
// listeners run in order, synchronously; an 'error' event with no listener throws.

type Listener = (...args: any[]) => void;

export class EventEmitter {
  private events = new Map<string | symbol, Listener[]>();

  on(event: string | symbol, listener: Listener): this {
    const list = this.events.get(event);
    if (list) list.push(listener);
    else this.events.set(event, [listener]);
    return this;
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener);
  }

  prependListener(event: string | symbol, listener: Listener): this {
    this.events.set(event, [listener, ...(this.events.get(event) ?? [])]);
    return this;
  }

  prependOnceListener(event: string | symbol, listener: Listener): this {
    const once: Listener & { listener?: Listener } = (...args) => {
      this.off(event, once);
      listener.apply(this, args);
    };
    once.listener = listener;
    return this.prependListener(event, once);
  }

  once(event: string | symbol, listener: Listener): this {
    const once: Listener & { listener?: Listener } = (...args) => {
      this.off(event, once);
      listener.apply(this, args);
    };
    once.listener = listener;
    return this.on(event, once);
  }

  off(event: string | symbol, listener: Listener): this {
    const list = this.events.get(event);
    if (!list) return this;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === listener || (list[i] as { listener?: Listener }).listener === listener) {
        list.splice(i, 1);
        break;
      }
    }
    if (list.length === 0) this.events.delete(event);
    return this;
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.events.clear();
    else this.events.delete(event);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.events.get(event);
    if (!list || list.length === 0) {
      if (event === 'error') throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error: ${String(args[0])}`);
      return false;
    }
    for (const l of [...list]) l.apply(this, args);
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this.events.get(event)?.length ?? 0;
  }

  listeners(event: string | symbol): Listener[] {
    return (this.events.get(event) ?? []).map((l) => (l as { listener?: Listener }).listener ?? l);
  }

  rawListeners(event: string | symbol): Listener[] {
    return [...(this.events.get(event) ?? [])];
  }

  /** (No limit is enforced: kept for Node.js compatibility.) */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this.maxListeners;
  }

  private maxListeners = 10;

  eventNames(): (string | symbol)[] {
    return [...this.events.keys()];
  }
}
