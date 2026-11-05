import Link from "next/link";

/** Shown for any address that does not exist (and for a record the person may not see). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">Error 404</p>
      <h1 className="text-2xl font-semibold tracking-tight">We could not find that page</h1>
      <p className="text-sm text-muted-foreground">The address may be wrong, the item may have been removed, or you may not have access to it.</p>
      <Link href="/dashboard" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go to the dashboard</Link>
    </main>
  );
}
