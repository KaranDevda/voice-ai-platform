"use client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Select } from "./ui/form";

export interface VoiceChoice { ref: string; name: string; gender: string; group: "cloned" | "stock"; provider: string; detail: string }

export function VoicePicker({ voices, value, onChange, id }: { voices: VoiceChoice[]; value: string; onChange: (ref: string) => void; id?: string }) {
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
  const shown = useMemo(() => voices.filter((v) => gender === "all" || v.gender === gender || v.ref === value), [voices, gender, value]);
  const cloned = shown.filter((v) => v.group === "cloned");
  const stock = shown.filter((v) => v.group === "stock");
  const current = voices.find((v) => v.ref === value);

  return (
    <div className="grid gap-2">
      <div className="flex gap-1" role="group" aria-label="Filter voices by gender">
        {(["all", "female", "male"] as const).map((g) => (
          <button key={g} type="button" onClick={() => setGender(g)} aria-pressed={gender === g}
            className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize", gender === g ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted")}>{g}</button>
        ))}
      </div>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Voice">
        {cloned.length > 0 && <optgroup label="Cloned staff voices">{cloned.map((v) => <option key={v.ref} value={v.ref}>{v.name} · {v.gender}</option>)}</optgroup>}
        <optgroup label="Stock voices (Deepgram)">{stock.map((v) => <option key={v.ref} value={v.ref}>{v.name} · {v.gender} · {v.detail}</option>)}</optgroup>
      </Select>
      {current && <p className="text-xs text-muted-foreground">{current.group === "cloned" ? "Cloned staff voice (consent on file)" : current.detail}</p>}
    </div>
  );
}
