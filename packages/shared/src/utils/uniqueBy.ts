type Primitive = string | number | boolean | Date;

type DotNotation<T> = T extends Primitive
  ? ''
  : T extends Array<any>
    ? ''
    : T extends object
      ? {
          [K in keyof T]-?: K extends string
            ? Required<T>[K] extends Primitive
              ? K
              : `${K}.${DotNotation<Required<T>[K]>}`
            : never;
        }[keyof T]
      : never;

type NonEmptyString<T> = T extends '' ? never : T;
type DeepKeys<T> = NonEmptyString<DotNotation<T>>;

/**
 * Returns a new array with duplicates removed based on a specified property,
 * keeping the first occurrence of each unique value.
 * @param arr The array to remove duplicates from
 * @param property The property to check for uniqueness (can use dot notation for nested properties)
 * @returns A new array with duplicates removed
 */
export function uniqueBy<T extends object>(arr: T[], property: DeepKeys<T>): T[] {
  const seen = new Set<any>();

  return arr.filter((item) => {
    const value = getPropValue(item, property);
    // Use JSON.stringify for objects/arrays to ensure deep comparison
    const key = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Helper function to get nested property value using dot notation
 */
function getPropValue<T extends object>(obj: T, path: DeepKeys<T>): any {
  return path.split('.').reduce((curr: any, key: string) => {
    return curr === null || curr === undefined ? curr : curr[key];
  }, obj);
}
