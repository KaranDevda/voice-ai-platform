import type { NextConfig } from "next";

/**
 * Sent on every response. The CSP only closes the doors that nothing here needs (framing, plug-ins, foreign form targets, a
 * changed <base>); it leaves script-src alone because Next injects inline scripts. The microphone is the one device the app uses.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@voiceai/db", "@voiceai/auth", "@voiceai/shared", "@voiceai/providers"],
  serverExternalPackages: ["pg", "@node-rs/argon2"],
  poweredByHeader: false,
  // Pages already visited re-open from the browser's memory for 30 s, and the icon library is split per icon.
  experimental: { staleTimes: { dynamic: 30 }, optimizePackageImports: ["lucide-react"] },
  async headers() {
    // The widget page is the one page other sites may frame (its calls are guarded by the widget's list of sites, checked when the voice pass is issued).
    const FRAMEABLE = [
      { key: "Content-Security-Policy", value: "frame-ancestors *; base-uri 'self'; object-src 'none'; form-action 'none'" },
      ...SECURITY_HEADERS.filter((h) => !["Content-Security-Policy", "X-Frame-Options"].includes(h.key)),
    ];
    return [
      { source: "/widget/frame", headers: FRAMEABLE },
      { source: "/:path((?!widget/frame$).*)", headers: SECURITY_HEADERS },
    ];
  },
};

export default config;
