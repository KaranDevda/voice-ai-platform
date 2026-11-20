import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BODY } from "./i18n-body";
import { measureCoverage } from "./i18n-coverage";
import { PAGES_1 } from "./i18n-pages-1";
import { PAGES_2 } from "./i18n-pages-2";
import { PAGES_3 } from "./i18n-pages-3";
import { PAGES_4 } from "./i18n-pages-4";
import { PAGES_5 } from "./i18n-pages-5";
import { PAGES_6 } from "./i18n-pages-6";
import { PAGES_7 } from "./i18n-pages-7";
import { PAGES_8 } from "./i18n-pages-8";
import { LANGUAGES, RTL, TRANSLATABLE, builtInTranslation, fmt, tr } from "./i18n";

const BUILT_IN = ["es", "fr", "ar", "zh", "hi", "pt", "ru", "ja", "de"];
const PARTS = { BODY, PAGES_1, PAGES_2, PAGES_3, PAGES_4, PAGES_5, PAGES_6, PAGES_7, PAGES_8 };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("built-in translations", () => {
  it("ships the ten languages and marks Arabic as right to left", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["en", ...BUILT_IN]);
    expect(RTL).toContain("ar");
  });

  for (const [name, part] of Object.entries(PARTS)) {
    it(`${name}: every text has all nine translations, none empty, and keeps its {values}`, () => {
      const problems: string[] = [];
      for (const [key, row] of Object.entries(part)) {
        if (row.length !== BUILT_IN.length) problems.push(`${key.slice(0, 50)}: ${row.length} columns`);
        else row.forEach((t, i) => {
          if (!t) problems.push(`${key.slice(0, 50)}: empty ${BUILT_IN[i]}`);
          else if (vars(t) !== vars(key)) problems.push(`${key.slice(0, 50)}: {values} differ in ${BUILT_IN[i]}`);
        });
      }
      expect(problems).toEqual([]);
    });
  }

  it("is found through the same lookup the pages use", () => {
    expect(tr("de", "Save")).toBe("Speichern");
    expect(tr("ar", "Receipt")).toBe("إيصال");
    expect(builtInTranslation("en", "anything")).toBe("anything");
    expect(tr("fr", "A text nobody translated")).toBe("A text nobody translated");
    for (const key of Object.keys(PAGES_3)) expect(TRANSLATABLE).toContain(key);
  });

  it("fills {values} after translating the whole sentence", () => {
    expect(fmt("Step {n} of {m}", { n: 1, m: 3 })).toBe("Step 1 of 3");
    expect(fmt("No values")).toBe("No values");
    expect(fmt("Keeps {unknown}", { n: 1 })).toBe("Keeps {unknown}");
  });
});

describe("how much of the interface is translated", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cov = measureCoverage(root, (s) => BUILT_IN.every((l) => builtInTranslation(l, s) !== ""));
  const routesWithText = cov.routes.filter((r) => r.own > 0);
  const routesWithTranslation = routesWithText.filter((r) => r.translated > 0);
  const routesMostly = routesWithText.filter((r) => r.translated / r.own >= 0.8);
  const filesWithTranslation = cov.files.filter((f) => f.translated > 0);

  it("reports the measured numbers", () => {
    const pct = Math.round((100 * cov.strings.translated) / cov.strings.total);
    console.log(
      `i18n coverage: ${cov.routes.length} page routes (${routesWithText.length} with text of their own); ${routesWithTranslation.length} have at least one translated text, ` +
      `${routesMostly.length} have 80% or more; ${filesWithTranslation.length} of ${cov.files.length} page and component files contain translated text; ` +
      `${cov.strings.translated} of ${cov.strings.total} distinct texts (${pct}%) translated; ${TRANSLATABLE.length} keys in the editor.`,
    );
    console.log(`Shown but with no translation (${cov.strings.missing.length}):\n` + cov.strings.missing.slice(0, 30).map((s) => ` - ${s.slice(0, 90)}`).join("\n"));
    console.log(`Not passed through a translating component (${cov.strings.unwired.length}):\n` + cov.strings.unwired.slice(0, 60).map((s) => ` - ${s.slice(0, 90)}`).join("\n"));
    expect(cov.routes.length).toBeGreaterThan(40);
  });

  // A floor that only goes up: new interface text must come with translations, or this number drops.
  it("keeps the share of translated texts from falling", () => {
    expect(cov.strings.translated / cov.strings.total).toBeGreaterThanOrEqual(0.5);
    expect(routesWithTranslation.length).toBeGreaterThanOrEqual(40);
  });
});
