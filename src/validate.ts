import { SupersynthError } from './errors.js';
import type { NativeEngine } from './engine.js';

/** Events the engine's command queue holds before they are rendered (see `docs/synth.md`). */
export const QUEUE_CAPACITY = 32768;

/** `value` if it is a finite number; otherwise a {@link SupersynthError} naming `name`. */
export function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SupersynthError(`${name} must be a finite number, got ${describe(value)}`);
  }
  return value;
}

/** A finite number of at least `min`. */
export function atLeast(value: unknown, min: number, name: string): number {
  const v = finite(value, name);
  if (v < min) throw new SupersynthError(`${name} must be at least ${min}, got ${v}`);
  return v;
}

/** A finite number above 0. */
export function positive(value: unknown, name: string): number {
  const v = finite(value, name);
  if (v <= 0) throw new SupersynthError(`${name} must be greater than 0, got ${v}`);
  return v;
}

/** An integer in [min, max]. */
export function integer(value: unknown, min: number, max: number, name: string): number {
  const v = finite(value, name);
  if (!Number.isInteger(v) || v < min || v > max) throw new SupersynthError(`${name} must be an integer ${min}-${max}, got ${v}`);
  return v;
}

/** A note velocity, rounded and clamped to 1–127 (0 would be a key-off in the engine). */
export function velocity(value: unknown, name = 'velocity'): number {
  return Math.max(1, Math.min(127, Math.round(finite(value, name))));
}

/** `value` clamped to [lo, hi], after checking it is finite. */
export function clamp(value: unknown, lo: number, hi: number, name: string): number {
  return Math.max(lo, Math.min(hi, finite(value, name)));
}

function describe(v: unknown): string {
  return typeof v === 'string' ? `'${v}'` : String(v);
}

/**
 * @internal The native engine behind a guard: every number passed is checked to be finite (a
 * NaN reaching the engine silences it for good) and every native error becomes a
 * {@link SupersynthError}. The public methods validate their arguments with clearer messages;
 * this is the backstop.
 */
export function guardEngine(engine: NativeEngine): NativeEngine {
  const wrapped = new Map<PropertyKey, unknown>();
  return new Proxy(engine, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      let w = wrapped.get(prop);
      if (!w) {
        const fn = v as (...args: unknown[]) => unknown;
        w = (...args: unknown[]) => {
          for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (typeof a === 'number' && !Number.isFinite(a)) {
              throw new SupersynthError(`${String(prop)}: argument ${i + 1} must be a finite number, got ${a}`);
            }
          }
          try {
            return fn.apply(target, args);
          } catch (e) {
            throw nativeError(e);
          }
        };
        wrapped.set(prop, w);
      }
      return w;
    },
  });
}

/** A native error as a {@link SupersynthError}. */
function nativeError(e: unknown): SupersynthError {
  if (e instanceof SupersynthError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/queue is full/.test(msg)) {
    return new SupersynthError(`The engine's command queue is full (it holds ${QUEUE_CAPACITY} events not yet rendered): render, or let real-time output catch up, before scheduling more`);
  }
  const err = new SupersynthError(msg);
  if (e instanceof Error) err.cause = e;
  return err;
}
