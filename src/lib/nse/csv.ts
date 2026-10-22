/**
 * Minimal RFC 4180 CSV reader. The official NSE files are plain comma
 * separated text, but quoted fields (e.g. names containing commas) and CRLF
 * line endings are still handled so a re-saved file does not break imports.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** "NAME OF COMPANY", " NAME_OF_COMPANY", "Name  of Company" -> "NAME_OF_COMPANY". */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}
