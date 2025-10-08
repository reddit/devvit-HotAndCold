export type Path = Array<string | number>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  // Only traverse plain JSON-like objects. Treat Dates, Maps, Sets, Errors, etc. as atomic values.
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** Depth-first pre-order walk over any JS value. */
export function walkValue(
  value: unknown,
  fn: (value: unknown, path: Path) => void,
  path: Path = []
): void {
  fn(value, path);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      walkValue(value[i]!, fn, [...path, i]);
  } else if (isPlainObject(value)) {
    for (const k of Object.keys(value)) walkValue(value[k], fn, [...path, k]);
  }
}

/** Deep map that returns a transformed copy. Mapper can replace any node. */
export function mapValue<T>(
  value: T,
  fn: (value: unknown, path: Path) => unknown,
  path: Path = []
): T {
  const replaced = fn(value, path);
  if (Array.isArray(replaced)) {
    const mapped = replaced.map((v, i) => mapValue(v, fn, [...path, i]));
    return mapped as unknown as T;
  } else if (isPlainObject(replaced)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(replaced)) {
      out[k] = mapValue(replaced[k], fn, [...path, k]);
    }
    return out as unknown as T;
  }
  return replaced as T;
}

export type KeyMapper = (key: string, path: Path) => string;

/** Deep map that can also transform object keys. */
export function mapValueWithKeys<T>(
  value: T,
  mapNode: (value: unknown, path: Path) => unknown,
  mapKey?: KeyMapper,
  path: Path = []
): T {
  const replaced = mapNode(value, path);
  if (Array.isArray(replaced)) {
    const mapped = replaced.map((v, i) =>
      mapValueWithKeys(v, mapNode, mapKey, [...path, i])
    );
    return mapped as unknown as T;
  } else if (isPlainObject(replaced)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const originalKey of Object.keys(replaced)) {
      const nextKey = mapKey
        ? mapKey(originalKey, [...path, originalKey])
        : originalKey;
      // Recurse using the original key in the path to avoid path/key drift.
      out[nextKey] = mapValueWithKeys(replaced[originalKey], mapNode, mapKey, [
        ...path,
        originalKey,
      ]);
    }
    return out as unknown as T;
  }
  return replaced as T;
}
