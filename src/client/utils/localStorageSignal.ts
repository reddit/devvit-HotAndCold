import { effect, signal, type Signal } from '@preact/signals';

export type Serializer<T> = {
  read: (raw: string) => T;
  write: (value: T) => string;
};

export type CreateLocalStorageSignalOptions<T> = {
  key: string;
  /** Initial value used when no stored value exists or deserialization fails. */
  initialValue: T | (() => T);
  /** Custom (de)serialization. Defaults to JSON. */
  serializer?: Serializer<T>;
  /** Whether to sync across tabs via the storage event. Default: true */
  syncTabs?: boolean;
  /** Compare values to avoid redundant writes/updates. Default: Object.is */
  equality?: (a: T, b: T) => boolean;
  /** Provide a custom storage implementation (e.g., sessionStorage). Defaults to localStorage in browsers. */
  storage?: Storage;
  /** If value is null/undefined and this flag is true, remove the key instead of writing. Default: false */
  removeOnNullish?: boolean;
  /** Optional error handler. */
  onError?: (kind: 'read' | 'write' | 'storage', error: unknown) => void;
};

export type LocalStorageSignalResult<T> = {
  /** The reactive signal value */
  signal: Signal<T>;
  /** Remove listeners/effects when you no longer need this signal */
  dispose: () => void;
  /** Reset the signal and storage to the initial value */
  reset: () => void;
};

const defaultSerializer: Serializer<unknown> = {
  read: (raw: string) => JSON.parse(raw) as unknown,
  write: (value: unknown) => JSON.stringify(value),
};

function resolveInitial<T>(initialValue: T | (() => T)): T {
  return typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
}

/**
 * Create a Preact signal that stays in sync with localStorage and across tabs.
 * - Reads initial value from localStorage when available
 * - Writes on changes
 * - Listens for the `storage` event to update from other tabs
 */
export function createLocalStorageSignal<T>(
  options: CreateLocalStorageSignalOptions<T>
): LocalStorageSignalResult<T> {
  const {
    key,
    initialValue,
    serializer,
    syncTabs = true,
    equality = Object.is,
    storage,
    removeOnNullish = false,
    onError,
  } = options;

  const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  const ser = (serializer as Serializer<T>) ?? (defaultSerializer as Serializer<T>);
  const storageArea: Storage | undefined = storage ?? (isBrowser ? window.localStorage : undefined);

  // Hydrate from storage (if possible)
  let startingValue: T = resolveInitial(initialValue);
  // If a read error occurs during hydration, we remove the key and suppress the
  // initial persistence write so the key remains absent (test expectation).
  let suppressNextWrite = false;
  if (storageArea) {
    try {
      const existing = storageArea.getItem(key);
      if (existing != null) startingValue = ser.read(existing);
    } catch (error) {
      // Corrupt or incompatible data; remove key and use initial
      try {
        storageArea?.removeItem(key);
      } catch (_) {
        // ignore
      }
      // Ensure we do not immediately re-persist the initial value after a read error
      suppressNextWrite = true;
      if (onError) onError('read', error);

      if (!onError) console.warn(`[localStorageSignal] Failed to read key "${key}":`, error);
    }
  }

  const state = signal<T>(startingValue);

  // Persist on changes
  const stopPersistEffect = storageArea
    ? effect(() => {
        const next = state.value;
        const performWrite = () => {
          try {
            if (suppressNextWrite) {
              suppressNextWrite = false;
              return;
            }
            if (removeOnNullish && (next as unknown) == null) {
              storageArea.removeItem(key);
              return;
            }
            const encoded = ser.write(next);
            const currentRaw = storageArea.getItem(key);
            if (currentRaw !== encoded) {
              storageArea.setItem(key, encoded);
            }
          } catch (error) {
            if (onError) onError('write', error);

            if (!onError) console.warn(`[localStorageSignal] Failed to write key "${key}":`, error);
          }
        };

        performWrite();
      })
    : undefined;

  // React to cross-tab updates
  const onStorage = (ev: StorageEvent) => {
    if (!ev) return;
    // Only supported for the real window.localStorage
    if (storageArea !== window.localStorage) return;
    if (ev.storageArea !== window.localStorage) return;
    if (ev.key !== key) return;
    try {
      if (ev.newValue == null) {
        const reset = resolveInitial(initialValue);
        if (!equality(state.value, reset)) state.value = reset;
        return;
      }
      const incoming = ser.read(ev.newValue);
      if (!equality(state.value, incoming)) state.value = incoming;
    } catch (error) {
      if (onError) onError('storage', error);

      if (!onError)
        console.warn(`[localStorageSignal] Failed to handle storage for "${key}":`, error);
    }
  };

  if (isBrowser && syncTabs && storageArea === window.localStorage) {
    window.addEventListener('storage', onStorage);
  }

  const dispose = () => {
    if (isBrowser && syncTabs && storageArea === window.localStorage)
      window.removeEventListener('storage', onStorage);
    if (stopPersistEffect) stopPersistEffect();
  };

  const reset = () => {
    const next = resolveInitial(initialValue);
    state.value = next;
    try {
      if (storageArea) {
        if (removeOnNullish && (next as unknown) == null) storageArea.removeItem(key);
        else storageArea.setItem(key, ser.write(next));
      }
    } catch (error) {
      if (onError) onError('write', error);

      if (!onError) console.warn(`[localStorageSignal] Failed to reset key "${key}":`, error);
    }
  };

  return { signal: state, dispose, reset };
}

/**
 * Convenience helper when you only need the signal.
 * Returns just the signal; you can optionally supply a cleanup function later.
 */
export function localStorageSignal<T>(options: CreateLocalStorageSignalOptions<T>): Signal<T> {
  return createLocalStorageSignal(options).signal;
}
