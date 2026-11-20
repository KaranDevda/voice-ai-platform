"use client";
import { fmt } from "@/lib/i18n";
import { Children, createContext, useContext, useEffect, type ReactNode } from "react";

/** The words of the page for the chosen language (built-in plus anything staff changed). English is the empty dictionary: text with no entry shows as written. */
const Dict = createContext<Record<string, string>>({});
const LangCtx = createContext("en");
/** The active interface language code, for dates and numbers. */
export const useLang = () => useContext(LangCtx);

export function I18nProvider({ dict, lang = "en", children }: { dict: Record<string, string>; lang?: string; children: ReactNode }) {
  return <LangCtx.Provider value={lang}><Dict.Provider value={dict}><AttributeTranslator dict={dict} />{children}</Dict.Provider></LangCtx.Provider>;
}

/** For text a component builds itself (placeholders, labels, messages): the translation, or the text unchanged. `vars` fills `{name}` after translating. */
export function useT(): (text: string, vars?: Record<string, string | number>) => string {
  const d = useContext(Dict);
  return (text, vars) => fmt(d[text] ?? text, vars);
}

/** Keeps the spaces around a piece of text when it is translated (a dictionary key has none). */
function translateKeepingSpace(d: Record<string, string>, s: string): string {
  const core = s.trim();
  const hit = core && d[core.replace(/\s+/g, " ")];
  return hit ? s.slice(0, s.length - s.trimStart().length) + hit + s.slice(s.trimEnd().length) : s;
}

/** Translates the plain-text pieces of `children`; anything else (icons, elements, numbers) passes through untouched. Works on the server too, because the dictionary comes from the layout. */
export function T({ children }: { children?: ReactNode }) {
  const d = useContext(Dict);
  const one = (c: ReactNode) => (typeof c === "string" ? translateKeepingSpace(d, c) : c);
  return <>{Array.isArray(children) ? Children.map(children, one) : one(children)}</>;
}

/** A whole sentence with `{name}` values: it is translated as one piece (so word order can differ), then the values are put in. */
export function Tf({ text, vars }: { text: string; vars?: Record<string, string | number> }) {
  const d = useContext(Dict);
  return <>{fmt(d[text] ?? text, vars)}</>;
}

const ATTRS = ["placeholder", "aria-label", "title", "alt", "label"] as const;
/**
 * Placeholders, aria-labels, titles and alt texts are attributes, which a component cannot translate as children. After the page shows, this
 * translates them in place (and again when React changes one). English pages do nothing: the dictionary is empty.
 */
function AttributeTranslator({ dict }: { dict: Record<string, string> }) {
  useEffect(() => {
    if (!Object.keys(dict).length) return;
    const fix = (el: Element) => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        const hit = v && dict[v.trim()];
        if (hit && hit !== v) el.setAttribute(a, hit);
      }
    };
    const all = (root: ParentNode) => { if (root instanceof Element) fix(root); root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")).forEach(fix); };
    all(document.body);
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "attributes" && m.target instanceof Element) fix(m.target);
        else m.addedNodes.forEach((n) => { if (n instanceof Element) all(n); });
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => obs.disconnect();
  }, [dict]);
  return null;
}
