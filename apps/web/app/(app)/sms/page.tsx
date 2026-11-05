import { listSms, listSmsTemplates } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { SmsAdmin } from "@/components/sms-admin";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function SmsPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listSms(getDb(), user));
  const templates = await allowed(() => listSmsTemplates(getDb(), user));
  if (!data || !templates) return <Forbidden />;
  return (
    <>
      <PageHeader title="SMS" description="Texts to everyone with a tag. They are sent inside the calling hours (9:00 to 21:00 India time), never to Do Not Disturb numbers." />
      <SmsAdmin templates={templates} counts={data.counts} rows={data.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
    </>
  );
}
