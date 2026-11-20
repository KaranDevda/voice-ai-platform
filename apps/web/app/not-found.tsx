import Link from "next/link";
import { T } from "@/components/t";

/** Shown for any address that does not exist (and for a record the person may not see). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground"><T>Error 404</T></p>
      <h1 className="text-2xl font-semibold tracking-tight"><T>We could not find that page</T></h1>
      <p className="text-sm text-muted-foreground"><T>The address may be wrong, the item may have been removed, or you may not have access to it.</T></p>
      <Link href="/dashboard" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><T>Go to the dashboard</T></Link>
    </main>
  );
}
