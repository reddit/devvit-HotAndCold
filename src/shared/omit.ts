type CustomOmit<T, K extends keyof T> = {
  [P in Exclude<keyof T, K>]: T[P];
};

export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): CustomOmit<T, K> {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result as CustomOmit<T, K>;
}
