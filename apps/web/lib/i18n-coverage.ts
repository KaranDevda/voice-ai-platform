/**
 * Measures, from the source files, how much of the interface text has a built-in translation. Used by i18n.test.ts so the numbers in the
 * docs are measured rather than claimed. A "string" is text a person reads: text between tags, and the title, description, label, hint,
 * placeholder, aria-label, alt and text attributes. Text that comes from the database or is built at run time is not counted.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const ENTITIES: Record<string, string> = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&ldquo;": "“", "&rdquo;": "”", "&lsquo;": "‘", "&rsquo;": "’", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&middot;": "·", "&larr;": "←", "&rarr;": "→" };
const decode = (s: string) => s.replace(/&[a-z]+;/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, " ").trim();
const ATTRS = new Set(["title", "description", "label", "hint", "placeholder", "aria-label", "alt", "text"]);
const SKIP_TAGS = new Set(["script", "style", "code", "pre"]);

/** Components that translate the text they are given as `title`, `description`, `label` or `hint`. */
const TRANSLATING = new Set(["Recorder", "CopyButton", "CardHeader", "Field", "PageHeader", "EmptyState", "Stat", "Kpi", "DashboardFrame", "Tf"]);
/** Elements whose text children are translated by the element itself. */
const WRAPPING = new Set(["T", "Button", "Badge", "Th", "Tf"]);
/** Attributes of ordinary elements that the page translates after it shows (see AttributeTranslator in components/t.tsx). */
/** Components that pass these attributes straight to an element. */
const DOM_LIKE = new Set(["Input", "Select", "Textarea", "Button", "Mic"]);
const DOM_ATTRS = new Set(["placeholder", "aria-label", "title", "alt"]);

/** `strings` are texts that reach the screen translated when a translation exists; `unwired` are texts shown as written, whatever the dictionary says. */
export interface FileStrings { file: string; strings: string[]; unwired: string[]; imports: string[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function stringsIn(file: string): FileStrings {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings: string[] = [], unwired: string[] = [], imports: string[] = [];
  const inWrapper = (n: ts.Node) => { for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isJsxElement(p) && WRAPPING.has(tag(p))) return true; return false; };
  const tag = (n: ts.Node | undefined) => (n && (ts.isJsxElement(n) ? n.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n) ? n.tagName.getText() : "")) || "";
  const letters = (s: string) => /[A-Za-z]{2}/.test(s);
  const literals = (x: ts.Expression, out: string[]) => {
    if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) out.push(x.text);
    else if (ts.isConditionalExpression(x)) { literals(x.whenTrue, out); literals(x.whenFalse, out); }
    else if (ts.isParenthesizedExpression(x)) literals(x.expression, out);
    else if (ts.isBinaryExpression(x) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(x.operatorToken.kind)) { literals(x.left, out); literals(x.right, out); }
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text);
    if (ts.isJsxText(n) && ts.isJsxElement(n.parent) && !SKIP_TAGS.has(tag(n.parent))) { const t = decode(n.text); if (letters(t)) (inWrapper(n) ? strings : unwired).push(t); }
    if (ts.isJsxAttribute(n) && n.initializer && ATTRS.has(n.name.getText())) {
      const x = ts.isStringLiteral(n.initializer) ? [n.initializer.text] : ts.isJsxExpression(n.initializer) && n.initializer.expression ? (() => { const o: string[] = []; literals(n.initializer.expression, o); return o; })() : [];
      const owner = tag(n.parent.parent), name = n.name.getText();
      const wired = /^[a-z]/.test(owner) || DOM_LIKE.has(owner) ? DOM_ATTRS.has(name) || (owner === "optgroup" && name === "label") : TRANSLATING.has(owner) || (WRAPPING.has(owner) && name === "text");
      for (const s of x) if (letters(s)) (wired ? strings : unwired).push(decode(s));
    }
    if (ts.isJsxExpression(n) && n.expression && ts.isJsxElement(n.parent) && !SKIP_TAGS.has(tag(n.parent))) { const o: string[] = []; literals(n.expression, o); for (const s of o) if (letters(s)) (inWrapper(n) || WRAPPING.has(tag(n.parent)) ? strings : unwired).push(decode(s)); }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { file, strings, unwired, imports };
}

export interface Coverage {
  routes: { file: string; own: number; translated: number }[];
  files: { file: string; total: number; translated: number }[];
  strings: { total: number; translated: number; missing: string[]; unwired: string[] };
}

/**
 * `has(text)` says whether the text has a built-in translation. Each route's own strings are those in the page file and in the components
 * only it (or at most two other routes) uses; the menu, the shared building blocks and anything used by many pages are counted once, as files.
 * A text counts as translated only when it has a built-in translation AND is shown through something that translates it (T, Tf, a
 * button, badge, heading or field label, or an attribute the page translates after it shows).
 */
export function measureCoverage(webRoot: string, has: (text: string) => boolean): Coverage {
  const files = [...walk(join(webRoot, "app")), ...walk(join(webRoot, "components"))].map(stringsIn);
  const byFile = new Map(files.map((f) => [f.file, f]));
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(webRoot, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const c of [`${base}.tsx`, join(base, "index.tsx")]) if (existsSync(c) && byFile.has(c)) return c;
    return null;
  };
  const pages = files.filter((f) => /\/page\.tsx$/.test(f.file) || /\/not-found\.tsx$/.test(f.file));
  const closure = (page: string) => {
    const seen = new Set<string>([page]), stack = [page];
    while (stack.length) for (const spec of byFile.get(stack.pop()!)!.imports) { const r = resolveImport(page, spec); if (r && !seen.has(r)) { seen.add(r); stack.push(r); } }
    return seen;
  };
  const closures = new Map(pages.map((p) => [p.file, closure(p.file)]));
  const users = new Map<string, number>();
  for (const set of closures.values()) for (const f of set) users.set(f, (users.get(f) ?? 0) + 1);

  const routes = pages.map((p) => {
    const own = [...closures.get(p.file)!].filter((f) => f === p.file || (users.get(f) ?? 0) <= 3).flatMap((f) => { const x = byFile.get(f)!; return [...x.strings, ...x.unwired.map((u) => `\u0000${u}`)]; });
    const unique = [...new Set(own)];
    return { file: relative(webRoot, p.file), own: unique.length, translated: unique.filter((u) => !u.startsWith("\u0000") && has(u)).length };
  });
  const perFile = files.map((f) => { const u = [...new Set(f.strings)], w = new Set(f.unwired); return { file: relative(webRoot, f.file), total: u.length + w.size, translated: u.filter(has).length }; });
  const wired = [...new Set(files.flatMap((f) => f.strings))];
  const unwired = [...new Set(files.flatMap((f) => f.unwired))].filter((u) => !wired.includes(u));
  return { routes, files: perFile, strings: { total: wired.length + unwired.length, translated: wired.filter(has).length, missing: wired.filter((s) => !has(s)), unwired } };
}
