"use client";
import { Children, createContext, useContext, type ReactNode } from "react";

/** The words of the page for the chosen language (built-in plus anything staff changed). English is the empty dictionary: text with no entry shows as written. */
const Dict = createContext<Record<string, string>>({});

export function I18nProvider({ dict, children }: { dict: Record<string, string>; children: ReactNode }) {
  return <Dict.Provider value={dict}>{children}</Dict.Provider>;
}

/** For text a component builds itself (placeholders, labels): the translation, or the text unchanged. */
export function useT(): (text: string) => string {
  const d = useContext(Dict);
  return (text) => d[text] ?? text;
}

/** Translates the plain-text pieces of `children`; anything else (icons, elements, numbers) passes through untouched. Works on the server too, because the dictionary comes from the layout. */
export function T({ children }: { children?: ReactNode }) {
  const d = useContext(Dict);
  const one = (c: ReactNode) => (typeof c === "string" ? d[c.trim()] ?? c : c);
  return <>{Array.isArray(children) ? Children.map(children, one) : one(children)}</>;
}
