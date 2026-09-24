/** Annonce à ses abonnés, et rappelle aussitôt la dernière valeur à un abonné tardif. */
export function latch<T>() {
  const listeners = new Set<(value: T) => void>();
  let last: { value: T } | null = null;
  return {
    fire(value: T): void {
      last = { value };
      for (const cb of [...listeners]) cb(value);
    },
    on(cb: (value: T) => void): () => void {
      listeners.add(cb);
      if (last) cb(last.value);
      return () => void listeners.delete(cb);
    },
  };
}
