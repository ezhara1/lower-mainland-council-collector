const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

export function findDate(value: string): string | null {
  const iso = value.match(
    /\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})(?=\D|$)/,
  );
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const named = value.match(
    new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "i"),
  );
  if (named) {
    const parsed = new Date(`${named[1]} ${named[2]}, ${named[3]} UTC`);
    return parsed.toISOString().slice(0, 10);
  }
  const canadian = value.match(/(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](20\d{2})(?!\d)/);
  if (canadian) {
    let [day, month] = [Number(canadian[1]), Number(canadian[2])];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month > 12 || day > 31) return null;
    return `${canadian[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function inRange(
  date: string | null,
  dateFrom: string,
  dateTo: string,
) {
  return Boolean(date && date >= dateFrom && date <= dateTo);
}
