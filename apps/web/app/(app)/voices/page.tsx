import { listVoiceAdmin } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { VoiceAdmin } from "@/components/voice-admin";
import { Notice, PageHeader } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function VoicesPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listVoiceAdmin(getDb(), user));
  if (!data) return <Forbidden />;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  return (
    <>
      <PageHeader title="Voices & consent" description="Staff voice clones and the signed consent behind each one." />
      <div className="mb-6"><Notice>The AI never claims to be the real person. If a donor withdraws consent or leaves, revoke their voice here. It is removed from calls immediately and deleted at the provider.</Notice></div>
      <VoiceAdmin
        profiles={data.profiles.map((p) => ({ id: p.id, label: p.label, gender: p.gender, provider: p.provider, status: p.status, donorFirst: p.donorFirst, donorLast: p.donorLast, donorEmail: p.donorEmail, consentGrantedAt: p.consentGrantedAt.toISOString(), consentPurpose: p.consentPurpose, consentWithdrawn: iso(p.consentWithdrawn) }))}
        consents={data.consents.map((c) => ({ id: c.id, email: c.email, purpose: c.purpose, method: c.method, grantedAt: c.grantedAt.toISOString(), revokedAt: iso(c.revokedAt), inUse: c.inUse }))}
        staff={data.staff}
      />
    </>
  );
}
