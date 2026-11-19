"use client";
import { useState } from "react";
import { Button } from "./ui/button";

/** Copies text to the clipboard and says so. Lives in its own client component so server pages can use it. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }); }}>
      {done ? "Copied" : label}
    </Button>
  );
}
