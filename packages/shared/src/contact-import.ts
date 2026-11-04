import { normalizePhone } from "./phone";

/** Reading a contact list (CSV) into clean rows: valid phone numbers, no duplicates, tags and extra columns kept as custom fields. */
export interface ContactRow { name: string | null; phone: string; email: string | null; tags: string[]; fields: Record<string, string> }
export interface RowProblem { row: number; reason: string }
export const MAX_IMPORT_ROWS = 5000;
const MAX_TAGS = 10, MAX_FIELDS = 20;

/** CSV with quoted fields, doubled quotes and line breaks inside quotes; a comma, semicolon or tab between columns. Returns rows of cells. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const PHONE = new Set(["phone", "mobile", "number", "phone number", "mobile number", "contact", "contact number", "whatsapp", "फ़ोन", "फोन", "मोबाइल"]);
const NAME = new Set(["name", "full name", "contact name", "नाम"]);
const EMAIL = new Set(["email", "e-mail", "email address", "ईमेल"]);
const TAGS = new Set(["tags", "tag", "labels", "label", "list", "group"]);
const cleanTag = (t: string) => t.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);

/** Tags typed by a person ("diwali, vip"), cleaned, without repeats. */
export const splitTags = (raw: string | string[]) =>
  [...new Set((Array.isArray(raw) ? raw : raw.split(/[,;|]/)).map(cleanTag).filter(Boolean))].slice(0, MAX_TAGS);

export function parseContacts(text: string, extraTags: string[] = []): { contacts: ContactRow[]; problems: RowProblem[]; duplicates: number } {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new RangeError("the file is empty");
  const header = rows[0]!.map((h) => h.normalize("NFC").trim().toLowerCase());
  const phoneCol = header.findIndex((h) => PHONE.has(h));
  if (phoneCol < 0) throw new RangeError('add a first row with column names, including one called "phone"');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new RangeError(`at most ${MAX_IMPORT_ROWS} contacts at a time`);
  const nameCol = header.findIndex((h) => NAME.has(h)), emailCol = header.findIndex((h) => EMAIL.has(h)), tagCol = header.findIndex((h) => TAGS.has(h));
  const base = splitTags(extraTags);
  const seen = new Set<string>();
  const contacts: ContactRow[] = [], problems: RowProblem[] = [];
  let duplicates = 0;
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2; // as a spreadsheet shows it: the header is row 1
    const phone = normalizePhone(cells[phoneCol] ?? "");
    if (!phone) return void problems.push({ row: rowNo, reason: `not a valid phone number: "${(cells[phoneCol] ?? "").trim().slice(0, 30)}"` });
    if (seen.has(phone)) { duplicates++; return; }
    seen.add(phone);
    const email = emailCol >= 0 ? (cells[emailCol] ?? "").trim() : "";
    const fields: Record<string, string> = {};
    header.forEach((h, c) => {
      if (!h || c === phoneCol || c === nameCol || c === emailCol || c === tagCol) return;
      const v = (cells[c] ?? "").trim();
      if (v && Object.keys(fields).length < MAX_FIELDS) fields[h.slice(0, 40)] = v.slice(0, 200);
    });
    contacts.push({
      name: nameCol >= 0 ? (cells[nameCol] ?? "").normalize("NFC").trim().slice(0, 120) || null : null,
      phone,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 200) : null,
      tags: splitTags([...base, ...(tagCol >= 0 ? splitTags(cells[tagCol] ?? "") : [])]),
      fields,
    });
  });
  return { contacts, problems, duplicates };
}
