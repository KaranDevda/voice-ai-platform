import type { ReactNode } from "react";

export const metadata = { title: "Voice AI & Call Intelligence" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
