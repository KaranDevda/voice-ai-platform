import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeadDetail, listSmsForLead } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Badge } from "@/components/ui/badge";
import { LeadSms } from "@/components/lead-sms";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDate } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function SmsThreadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  if (!UUID.test(leadId)) notFound();
  const user = await requirePageUser();
  const detail = await allowed(async () => getLeadDetail(getDb(), user, leadId));
  if (!detail) return <Forbidden />;
  const texts = await allowed(() => listSmsForLead(getDb(), user, leadId));
  const { lead } = detail;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/leads" className="text-muted-foreground hover:text-foreground">← Leads</Link></p>
      <PageHeader title="Text conversation" description={lead.phoneE164} actions={<span className="text-xs text-muted-foreground">{lead.tags.length ? lead.tags.map((t) => <span key={t} className="inline-block me-1"><Badge>{t}</Badge></span>) : "No tags"}</span>} />
      <Card>
        <CardHeader title={lead.name ?? "Unknown caller"} description={`Messages with ${lead.phoneE164} · oldest first · created ${formatDate(lead.createdAt)}`} />
        {texts && <LeadSms leadId={lead.id} history={texts.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))} />}
      </Card>
    </>
  );
}
