export function isIsoDate(value: string, minYear = 1980, maxYear = 2100): boolean {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < minYear || year > maxYear) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const TURO_STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/;

/** Turo trip stamps stay naive local text. Nothing is converted to UTC. */
export function parseTuroStamp(value: string): { text: string; date: string } | null {
  const text = value.trim().replace(/\s+/g, " ");
  const match = TURO_STAMP.exec(text);
  if (!match) return null;
  const date = match[1];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!isIsoDate(date) || hour < 1 || hour > 12 || minute > 59) return null;
  return { text, date };
}

export function clockFromSeconds(raw: string): string | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const seconds = Number(text);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86399) return null;
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export const PENDING_DEPOSIT_DATE = "0001-01-01";

export function classifyDeposit(raw: string): "pending" | "deposited" | "bad" {
  const text = raw.trim();
  if (text === PENDING_DEPOSIT_DATE) return "pending";
  if (!isIsoDate(text)) return "bad";
  return "deposited";
}
