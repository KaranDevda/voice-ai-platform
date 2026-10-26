import { BizfyMark } from "@/components/brand";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center justify-center gap-3">
          <BizfyMark className="h-11 w-11" />
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">Bizfy Voice AI</div>
            <div className="text-xs text-muted-foreground">Calls, voices and AI agents in one place</div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg shadow-black/10">{children}</div>
      </div>
    </main>
  );
}
