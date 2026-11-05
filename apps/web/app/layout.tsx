import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { asLang, LANG_COOKIE, RTL } from "@/lib/i18n";
import "./globals.css";

export const metadata = { title: "Bizfy Voice AI", description: "Bizfy Voice AI: voice studio and call intelligence platform" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme lives in a cookie so the server renders the right one: no flash, no inline script.
  const jar = await cookies();
  const theme = jar.get("theme")?.value === "light" ? "light" : "dark";
  const lang = asLang(jar.get(LANG_COOKIE)?.value);
  return (
    <html lang={lang} dir={RTL.includes(lang) ? "rtl" : "ltr"} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
