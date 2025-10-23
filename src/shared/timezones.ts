export const getBrowserIanaTimeZone = (): string | undefined => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz : undefined;
  } catch {
    return undefined;
  }
};
