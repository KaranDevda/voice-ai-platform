import { listMyNumbers } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { NumbersPanel } from "@/components/numbers-panel";
import { PageHeader } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function NumbersPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listMyNumbers(getDb(), user));
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="Phone numbers" description="The numbers your organisation uses, and requests for new ones." />
      <NumbersPanel canRequest={user.permissions.includes("org_settings.write")} numbers={data.numbers.map((n) => ({ ...n, assignedAt: n.assignedAt?.toISOString() ?? null }))} requests={data.requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
    </>
  );
}
