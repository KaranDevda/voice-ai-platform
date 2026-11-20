"use client";
import { T, Tf } from "@/components/t";

/** The last safety net: used when even the page frame fails, so it brings its own <html> and no styles from the app. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ font: "15px system-ui, sans-serif", background: "#070b17", color: "#e6edfb", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center" }}>
        <main role="alert" style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 22 }}><T>Something went wrong</T></h1>
          <p style={{ opacity: 0.8 }}><Tf text={error.digest ? "Please try again. If it keeps happening, tell support and quote the reference {ref}." : "Please try again. If it keeps happening, tell support."} vars={{ ref: error.digest ?? "" }} /></p>
          <button type="button" onClick={reset} style={{ border: 0, borderRadius: 8, padding: "10px 16px", background: "#2563eb", color: "#fff", font: "inherit", cursor: "pointer" }}><T>Try again</T></button>
        </main>
      </body>
    </html>
  );
}
