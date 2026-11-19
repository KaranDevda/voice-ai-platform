import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/page-auth";

type Status = "Live" | "Different" | "Open";
const ITEMS: Array<{ feature: string; how: string; status: Status; where?: string; check: string }> = [
  { feature: "KYC verification (Unverified / Basic / Business)", how: "Customer submits PAN (Basic) or PAN + GSTIN (Business); a platform admin approves or rejects.", status: "Live", where: "/kyc", check: "Submit on KYC, then approve under Platform > KYC waiting for review. The level changes." },
  { feature: "Two-factor authentication (TOTP)", how: "Authenticator-app code at sign-in, 8 one-time recovery codes, self-service on/off, admin reset. Compulsory for admin, manager and QA roles.", status: "Live", where: "/account", check: "Account > Two-factor authentication. Team & devices shows who has it and the Reset 2FA button." },
  { feature: "Role-based access control", how: "Six role bundles with scoped permissions (all / team / own / aggregate), editable in a matrix. Every query is also checked by the database (row-level security).", status: "Different", where: "/permissions", check: "Open Permissions (platform admin). Sign in as an agent and notice menus and data shrink." },
  { feature: "API token authentication", how: "Self-service bearer tokens: expiring, scoped to your own permissions, stored hashed, revocable at once. Custom, not Laravel Sanctum.", status: "Different", where: "/account", check: "Account > API tokens: create one, call the API with it, revoke it, call again (rejected)." },
  { feature: "Logs", how: "Audit trail, provider/call logs, CRM webhook deliveries, application error log.", status: "Live", where: "/audit", check: "Audit log shows sign-ins, 2FA changes and KYC reviews. Also Provider logs and Error log." },
  { feature: "Webhook verification", how: "Plivo and payment-gateway signatures are checked; payment notices without the gateway secret are refused. Twilio is not used (Plivo is the only carrier).", status: "Live", check: "Send a webhook with a wrong signature: it is rejected. Unit tests cover this." },
  { feature: "Rate limiting", how: "Sign-in and /api/auth: 20 per minute per address; other API: 600 per minute. Account lockout after 5 failed sign-ins. Per server, in memory.", status: "Live", check: "Fire 25 wrong sign-ins quickly: from the 21st you get HTTP 429." },
  { feature: "CSRF, XSS, SQL injection protection", how: "Same-origin check on every write, security headers + CSP, React output escaping, parameterised queries and validated inputs.", status: "Live", check: "A POST with a foreign Origin header is refused. View response headers on any page." },
  { feature: "Password hashing", how: "Argon2id (stronger than bcrypt), 12-character minimum.", status: "Different", where: "/account", check: "Account > Change password enforces the length rule." },
  { feature: "Independent penetration test", how: "Not done yet. Shared rate limits across servers and a nonce-based script CSP are also still to do.", status: "Open", check: "Listed so it is not overlooked." },
];
const tone = { Live: "success", Different: "primary", Open: "danger" } as const;

export default async function SecurityPage() {
  await requirePageUser();
  return (
    <>
      <PageHeader title="Security & compliance" description="What is in place, where to see it, and what is still open." />
      <Card>
        <CardHeader title="Controls" description="Live = built as asked. Different = built, but not with the named Laravel tool. Open = not done yet." />
        <Table>
          <thead><tr><Th>Feature</Th><Th>How it works</Th><Th>Status</Th><Th>How to check</Th></tr></thead>
          <tbody>
            {ITEMS.map((i) => (
              <Tr key={i.feature}>
                <Td className="font-medium">{i.where ? <Link href={i.where} className="underline">{i.feature}</Link> : i.feature}</Td>
                <Td className="text-sm text-muted-foreground">{i.how}</Td>
                <Td><Badge tone={tone[i.status]}>{i.status}</Badge></Td>
                <Td className="text-sm text-muted-foreground">{i.check}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
