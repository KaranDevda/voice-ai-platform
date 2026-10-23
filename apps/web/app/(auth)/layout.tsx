import { AudioLines } from "lucide-react";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center justify-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><AudioLines className="h-6 w-6" aria-hidden /></span>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">Voice AI Studio</div>
            <div className="text-xs text-muted-foreground">Calls, voices and AI agents in one place</div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg shadow-black/10">{children}</div>
      </div>
    </main>
  );
}
