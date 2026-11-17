"use client";
import { Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Small play/pause button for list rows. Fetches the audio only when first pressed. */
export function AudioButton({ src, label = "Play" }: { src: string; label?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");

  useEffect(() => () => { audio.current?.pause(); if (url.current) URL.revokeObjectURL(url.current); }, []);

  async function toggle() {
    if (state === "playing") { audio.current?.pause(); return setState("idle"); }
    try {
      if (!audio.current) {
        setState("loading");
        const res = await fetch(src);
        if (!res.ok) throw new Error();
        url.current = URL.createObjectURL(await res.blob());
        audio.current = new Audio(url.current);
        audio.current.onended = () => setState("idle");
      }
      await audio.current.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={state === "playing" ? `Pause ${label}` : `${label}`}
      title={state === "error" ? "Could not play" : label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary hover:opacity-80"
    >
      {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : state === "playing" ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="ms-0.5 h-4 w-4" aria-hidden />}
    </button>
  );
}
