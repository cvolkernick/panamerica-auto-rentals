export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(
  text: string
): { ok: true; table: CsvTable } | { ok: false; error: string } {
  const input = text.replace(/^\uFEFF/, "");
  if (input.includes("\u0000")) return { ok: false, error: "The CSV is not valid text." };
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) records.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (inQuotes) return { ok: false, error: "The CSV has an unclosed quote." };
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) records.push(row);
  }
  if (records.length === 0) return { ok: false, error: "The CSV has no header row." };
  const headers = records[0].map((header) => header.trim());
  if (headers.some((header) => header === "")) {
    return { ok: false, error: "The CSV has a blank column name." };
  }
  const rows = records.slice(1).map((cells) => headers.map((_, index) => cells[index] ?? ""));
  return { ok: true, table: { headers, rows } };
}

export function rowRecord(headers: readonly string[], cells: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (header in record) return;
    record[header] = cells[index] ?? "";
  });
  return record;
}

export function missingHeaders(headers: readonly string[], required: readonly string[]): string[] {
  const present = new Set(headers);
  return required.filter((name) => !present.has(name));
}
