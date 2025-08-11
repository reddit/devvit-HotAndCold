export function formatOrdinal(value: number): string {
  const integer = Math.trunc(value);
  const abs = Math.abs(integer);
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 13) return `${integer}th`;

  switch (abs % 10) {
    case 1:
      return `${integer}st`;
    case 2:
      return `${integer}nd`;
    case 3:
      return `${integer}rd`;
    default:
      return `${integer}th`;
  }
}
