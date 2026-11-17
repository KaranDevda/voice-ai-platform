"use client";
import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonClass } from "./ui/button";
import { Input, Select } from "./ui/form";
import { useT } from "./t";

/** Server-rendered GET form: filters live in the URL, so they are shareable and need no client JS. */
export function FilterBar({ action, q, selects, textFilters, extra }: {
  action: string;
  q?: string;
  selects: Array<{ name: string; value?: string; label: string; options: Array<[string, string]> }>;
  textFilters?: Array<{ name: string; value?: string; label: string; placeholder: string }>;
  extra?: ReactNode;
}) {
  const t = useT();
  const active = !!q || selects.some((s) => s.value) || textFilters?.some((filter) => filter.value);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={q} placeholder={t("Search name or number")} className="ps-9" aria-label={t("Search")} />
      </div>
      {textFilters?.map((filter) => (
        <Input key={filter.name} name={filter.name} defaultValue={filter.value} placeholder={t(filter.placeholder)} aria-label={t(filter.label)} className="w-full sm:w-40" />
      ))}
      {selects.map((s) => (
        <Select key={s.name} name={s.name} defaultValue={s.value ?? ""} aria-label={t(s.label)} className="w-auto">
          <option value="">{t(s.label)}</option>
          {s.options.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </Select>
      ))}
      {extra}
      <Button type="submit" variant="soft">Apply</Button>
      {active && <Link href={action} className={buttonClass({ variant: "ghost" })}>Clear</Link>}
    </form>
  );
}
