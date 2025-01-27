type Primitive = string | number | boolean | Date;

// Type to get all possible paths to primitive values in an object type

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

// Remove empty string from union type
type NonEmptyString<T> = T extends '' ? never : T;

// Get all possible paths as a union type
type DeepKeys<T> = NonEmptyString<DotNotation<T>>;

/**
 * A utility function to sort an array of objects by one or more properties
 * @param arr The array to sort
 * @param properties The properties to sort by (can be a single string or an array of strings)
 * @param orders Optional array of sort orders ('asc' or 'desc') corresponding to properties
 * @returns A new sorted array
 */
export function sortBy<T extends object>(
  arr: T[],
  properties: DeepKeys<T> | DeepKeys<T>[],
  orders?: ('asc' | 'desc')[]
): T[] {
  // Convert single property to array for consistent handling
  const props = Array.isArray(properties) ? properties : [properties];
  const sortOrders = orders || props.map(() => 'asc');

  // Validate input
  if (props.length === 0) {
    return [...arr];
  }
  if (sortOrders.length !== props.length) {
    throw new Error('Number of sort orders must match number of properties');
  }

  // Create a copy of the array to avoid mutating the original
  return [...arr].sort((a, b) => {
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      const order = sortOrders[i];

      // Get property values, handling nested properties using dot notation
      const aVal = getPropValue(a, prop);
      const bVal = getPropValue(b, prop);

      // Compare values
      const comparison = compareValues(aVal, bVal);

      // If values are different, return comparison based on sort order
      if (comparison !== 0) {
        return order === 'asc' ? comparison : -comparison;
      }
    }
    return 0;
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

/**
 * Helper function to compare any two values
 */
function compareValues(a: any, b: any): number {
  // Handle null/undefined
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;

  // Handle different types
  if (typeof a !== typeof b) {
    return typeof a < typeof b ? -1 : 1;
  }

  // Compare based on type
  if (typeof a === 'string') {
    return a.localeCompare(b);
  }
  if (typeof a === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  if (a instanceof Date) {
    return a.getTime() - b.getTime();
  }

  // For objects, convert to string for comparison
  return String(a).localeCompare(String(b));
}
