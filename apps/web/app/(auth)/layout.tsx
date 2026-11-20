import { getLandingText } from "@voiceai/db";
import type { ReactNode } from "react";
import { BizfyMark } from "@/components/brand";
import { getDb } from "@/lib/server";
import { T } from "@/components/t";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // The headline and the line under it can be changed by platform staff (Platform page); the standard text shows until they do.
  const landing = await getLandingText(getDb()).catch(() => ({ headline: "", text: "" }));
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center justify-center gap-3">
          <BizfyMark className="h-11 w-11" />
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight"><T>{landing.headline || "Bizfy Voice AI"}</T></div>
            <div className="text-xs text-muted-foreground"><T>{landing.text || "Calls, voices and AI agents in one place"}</T></div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg shadow-black/10">{children}</div>
      </div>
    </main>
  );
}
