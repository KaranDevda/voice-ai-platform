/**
 * Personalising a text: "Hi {{name|there}}, your {{plan}} offer ends soon." The name, first_name and phone come from the person; any other word
 * is a custom column from the contact import (city, company, ...). `{{word|fallback}}` uses the fallback when the person has no value.
 * A word with no value and no fallback becomes empty, so a text never contains a raw "{{...}}".
 */
export interface TemplatePerson { name?: string | null; fields?: Record<string, string> | null }

export function renderTemplate(body: string, person: TemplatePerson): string {
  const first = (person.name ?? "").trim().split(/\s+/)[0] ?? "";
  const vars: Record<string, string> = { ...(person.fields ?? {}), name: (person.name ?? "").trim(), first_name: first };
  return body
    .replace(/\{\{\s*([\p{L}\p{N}_ -]{1,40}?)\s*(?:\|([^}]{0,60}))?\}\}/gu, (_m, key: string, fallback?: string) => {
      const v = vars[key.trim().toLowerCase().replace(/[ -]+/g, "_")] ?? vars[key.trim().toLowerCase()] ?? "";
      return v || (fallback ?? "").trim();
    })
    .replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?।])/g, "$1").trim();
}

/** The words a template uses, so a form can tell what it needs. */
export const templateVariables = (body: string): string[] => [...new Set([...body.matchAll(/\{\{\s*([\p{L}\p{N}_ -]{1,40}?)\s*(?:\|[^}]{0,60})?\}\}/gu)].map((m) => m[1]!.trim().toLowerCase()))];
