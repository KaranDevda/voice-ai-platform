"use client";
import { Loader2, Mic2, Pause, Play, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { buttonClass } from "./ui/button";
import { Input, Select } from "./ui/form";
import type { VoiceChoice } from "./voice-picker";

const SAMPLE = "Hello, thanks for calling. This is an AI assistant. How can I help you today?";

export function LibraryGrid({ voices }: { voices: VoiceChoice[] }) {
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [group, setGroup] = useState("");
  const [accent, setAccent] = useState("");
  const [state, setState] = useState<Record<string, "loading" | "playing" | "error">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, string>());
  const current = useRef<{ ref: string; audio: HTMLAudioElement } | null>(null);

  useEffect(() => () => { current.current?.audio.pause(); cache.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const accents = [...new Set(voices.filter((v) => v.group === "stock").map((v) => v.detail.split(" · ")[0]!))];
  const shown = voices.filter((v) =>
    (!q || `${v.name} ${v.detail}`.toLowerCase().includes(q.toLowerCase())) && (!gender || v.gender === gender) && (!group || v.group === group) && (!accent || v.detail.startsWith(accent)));

  const set = (ref: string, s?: "loading" | "playing" | "error") => setState((m) => { const n = { ...m }; if (s) n[ref] = s; else delete n[ref]; return n; });

  async function preview(v: VoiceChoice) {
    if (current.current?.ref === v.ref && state[v.ref] === "playing") { current.current.audio.pause(); return set(v.ref); }
    if (current.current) { current.current.audio.pause(); set(current.current.ref); }
    setErrors((e) => { const n = { ...e }; delete n[v.ref]; return n; });
    try {
      let url = cache.current.get(v.ref);
      if (!url) {
        set(v.ref, "loading");
        const res = await fetch("/api/studio/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: SAMPLE, voice: v.ref, save: false }) });
        if (!res.ok) { setErrors((e) => ({ ...e, [v.ref]: "" })); const err = await apiError(res); setErrors((e) => ({ ...e, [v.ref]: err.hint ?? err.message })); return set(v.ref, "error"); }
        url = URL.createObjectURL(await res.blob());
        cache.current.set(v.ref, url);
      }
      const audio = new Audio(url);
      audio.onended = () => set(v.ref);
      current.current = { ref: v.ref, audio };
      await audio.play();
      set(v.ref, "playing");
    } catch {
      set(v.ref, "error");
      setErrors((e) => ({ ...e, [v.ref]: "Could not play the preview." }));
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search voices" aria-label="Search voices" className="w-full sm:w-60" />
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Source" className="w-auto"><option value="">All sources</option><option value="cloned">Cloned staff voices</option><option value="stock">Stock voices</option></Select>
        <Select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender" className="w-auto"><option value="">Any gender</option><option value="female">Female</option><option value="male">Male</option></Select>
        <Select value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent" className="w-auto"><option value="">Any accent</option>{accents.map((a) => <option key={a}>{a}</option>)}</Select>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} of {voices.length} voices</span>
      </div>
      {shown.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No voices match these filters.</p> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((v) => {
            const s = state[v.ref];
            return (
              <div key={v.ref} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", v.group === "cloned" ? "border-primary/40" : "border-border")}>
                <div className="flex items-start gap-3">
                  <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-semibold", v.gender === "female" ? "bg-primary-soft text-primary" : "bg-info-soft text-info")}>{v.name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{v.name}</span>{v.group === "cloned" && <Badge tone="primary"><ShieldCheck className="mr-1 h-3 w-3" aria-hidden />Consent on file</Badge>}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground"><span className="capitalize">{v.gender}</span> · {v.group === "cloned" ? "Cloned staff voice" : v.detail}</div>
                  </div>
                </div>
                {errors[v.ref] && <p role="alert" className="text-xs text-danger">{errors[v.ref]}</p>}
                <div className="mt-auto flex items-center gap-2">
                  <button type="button" onClick={() => void preview(v)} className={buttonClass({ variant: "soft", size: "sm" })} aria-label={`Preview ${v.name}`}>
                    {s === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : s === "playing" ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    {s === "playing" ? "Stop" : "Preview"}
                  </button>
                  <Link href={`/studio?voice=${encodeURIComponent(v.ref)}`} className={buttonClass({ variant: "outline", size: "sm" })}><Mic2 className="h-4 w-4" aria-hidden />Use in Studio</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
