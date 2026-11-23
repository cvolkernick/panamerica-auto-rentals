/** Signed money from a CSV cell. Blank is null. Zero is allowed. */
export function parseMoneyToCents(raw: string): number | null {
  let text = raw.trim();
  if (!text) return null;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/[\s$,]/g, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (whole.length > 13) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  return negative ? -cents : cents;
}

/** Blank money cells are zero. A non-empty cell that does not parse is null. */
export function parseMoneyOrZero(raw: string): number | null {
  if (!raw.trim()) return 0;
  return parseMoneyToCents(raw);
}
