export const isEmptyObject = <T extends object>(obj: T): boolean => {
  return Object.keys(obj).length === 0;
};
