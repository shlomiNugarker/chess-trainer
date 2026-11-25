import { useSyncExternalStore } from 'react';

/** A value that only the components using it re-render for. */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    use: () =>
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => value,
      ),
  };
}
export type Store<T> = ReturnType<typeof createStore<T>>;
