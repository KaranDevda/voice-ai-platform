import { trServer } from "@/lib/i18n-server";
import type { ReactNode } from "react";

/** The title of a page. Server components only (it reads the language cookie): client components must not import this file. */
export async function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const shown = await trServer(title);
  const shownDescription = description ? await trServer(description) : description; // page titles follow the interface language (those with a translation); descriptions stay in English
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{shown}</h1>
        {shownDescription && <p className="mt-1 text-sm text-muted-foreground">{shownDescription}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
