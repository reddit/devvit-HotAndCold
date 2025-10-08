// Minutes from UTC right now (DST included)
// Note: Date#getTimezoneOffset() returns minutes to add to local time to get UTC
// (i.e., positive west of UTC). Negate so positive values represent UTC+hh:mm.
export const getOffsetMinutes = () => -new Date().getTimezoneOffset();

// Optional: human label and IANA zone
export const getUtcLabel = (m = getOffsetMinutes()): `UTC${'+' | '-'}${string}:${string}` => {
  const sign = m >= 0 ? '+' : '-';
  const abs = Math.abs(m);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
};
