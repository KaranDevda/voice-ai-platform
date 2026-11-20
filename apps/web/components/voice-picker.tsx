"use client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Select } from "./ui/form";
import { T } from "./t";

export interface VoiceChoice { ref: string; name: string; gender: string; group: "cloned" | "stock"; provider: string; detail: string; hindi?: boolean; hindiOwn?: boolean }

export function VoicePicker({ voices, value, onChange, id, language = "en" }: { voices: VoiceChoice[]; value: string; onChange: (ref: string) => void; id?: string; /** The language being written. Voices that cannot speak it are marked, and Hindi-capable ones come first. */ language?: "en" | "hi" | "hinglish" }) {
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
  const shown = useMemo(() => voices.filter((v) => gender === "all" || v.gender === gender || v.ref === value), [voices, gender, value]);
  const needsHindi = language !== "en";
  const cloned = shown.filter((v) => v.group === "cloned").sort((a, b) => (needsHindi ? Number(!!b.hindi) - Number(!!a.hindi) : 0));
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
        {cloned.length > 0 && <optgroup label="Cloned staff voices">{cloned.map((v) => <option key={v.ref} value={v.ref}>{v.name} · {v.gender}<T>{needsHindi && !v.hindi ? " · no Hindi yet" : ""}</T></option>)}</optgroup>}
        <optgroup label={needsHindi ? "Stock voices (English only)" : "Stock voices (Deepgram)"}>{stock.map((v) => <option key={v.ref} value={v.ref}>{v.name} · {v.gender} · {v.detail}</option>)}</optgroup>
      </Select>
      {current && <p className="text-xs text-muted-foreground"><T>{current.group === "cloned" ? "Cloned staff voice (consent on file)" : current.detail}</T></p>}
    </div>
  );
}
