"use client";
import Link from "next/link";
import { useEffect } from "react";
import { T, Tf } from "@/components/t";

/** Shown when a page fails while it is being made. The cause is never shown to the person; the reference lets support find it in the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
      <p className="text-sm font-medium text-muted-foreground"><T>Something went wrong</T></p>
      <h1 className="text-2xl font-semibold tracking-tight"><T>This page could not be shown</T></h1>
      <p className="text-sm text-muted-foreground"><Tf text={error.digest ? "It is not something you did. Try again; if it keeps happening, tell support and quote the reference {ref}." : "It is not something you did. Try again; if it keeps happening, tell support."} vars={{ ref: error.digest ?? "" }} /></p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><T>Try again</T></button>
        <Link href="/dashboard" className="rounded-md border border-border px-4 py-2 text-sm font-medium"><T>Dashboard</T></Link>
      </div>
    </main>
  );
}
