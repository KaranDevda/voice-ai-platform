import { cn } from "@/lib/utils";
import type { ProviderStatus } from "@/lib/providers";
import { T } from "./t";

const NAMES = { deepgram: "Deepgram", elevenlabs: "ElevenLabs", askg1: "AskG1" } as const;

export function ProviderChips({ status }: { status: Record<keyof typeof NAMES, ProviderStatus> }) {
  return (
    <ul className="grid gap-3">
      {(Object.keys(NAMES) as Array<keyof typeof NAMES>).map((k) => {
        const s = status[k];
        const ok = s.configured && s.reachable !== false;
        return (
          <li key={k} className="flex items-start gap-3 text-sm">
            <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", ok ? "bg-success" : s.configured ? "bg-warning" : "bg-muted-foreground/50")} />
            <div><div className="font-medium">{NAMES[k]}<span className="sr-only"> — <T>{ok ? "working" : "not working"}</T></span></div><div className="text-xs text-muted-foreground">{s.note}</div></div>
          </li>
        );
      })}
    </ul>
  );
}
