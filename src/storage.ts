import { useEffect, useRef, useState } from 'react';
import { PREFIX } from './syncMerge';

// Small settings that should survive a reload (level, threshold, username...).

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * State that is saved when it changes. The first render saves nothing: a default nobody chose must not look like
 * a new change, or a new device would overwrite the settings in the cloud when it signs in (see cloud.ts).
 * For simple values (string, number, boolean).
 */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readStored(key, initial));
  const saved = useRef(value);
  useEffect(() => {
    if (Object.is(saved.current, value)) return;
    saved.current = value;
    writeStored(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
