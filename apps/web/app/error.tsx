"use client";
import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page fails while it is being made. The cause is never shown to the person; the reference lets support find it in the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
      <p className="text-sm font-medium text-muted-foreground">Something went wrong</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page could not be shown</h1>
      <p className="text-sm text-muted-foreground">It is not something you did. Try again; if it keeps happening, tell support{error.digest ? ` and quote the reference ${error.digest}` : ""}.</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
        <Link href="/dashboard" className="rounded-md border border-border px-4 py-2 text-sm font-medium">Dashboard</Link>
      </div>
    </main>
  );
}
