import { listLeadOptions } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { LiveVoice } from "@/components/live-voice";
import { PageHeader } from "@/components/ui/page";
import { requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { voiceOptionsFor } from "@/lib/voices";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LivePage({ searchParams }: { searchParams: Promise<{ lead?: string; voice?: string }> }) {
  const user = await requirePageUser();
  if (!user.permissions.includes("studio.use")) return <Forbidden />;
  const { lead: leadId, voice } = await searchParams;
  const voices = (await voiceOptionsFor(user)).filter((v) => !v.detail.startsWith("Demo"));
  // Only a lead this person is allowed to call is shown; anything else is ignored rather than trusted from the address bar.
  const lead = leadId && UUID.test(leadId) && user.permissions.includes("calls.place") ? (await listLeadOptions(getDb(), user)).find((l) => l.id === leadId) : undefined;
  return (
    <>
      <PageHeader title="Live conversation" description="Talk to the AI by voice, as a caller would. It listens, thinks, answers aloud, and stops when you interrupt." />
      <LiveVoice voices={voices} lead={lead && { id: lead.id, name: lead.name, phone: lead.phone }} initialVoice={voice} />
    </>
  );
}
