import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Voice AI Studio", description: "Voice studio and call intelligence platform" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme lives in a cookie so the server renders the right one: no flash, no inline script.
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
