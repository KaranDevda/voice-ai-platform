import { listVoiceAdmin } from "@voiceai/db";
import { CloneWizard } from "@/components/clone-wizard";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function ClonePage() {
  const user = await requirePageUser();
  const data = user.permissions.includes("studio.use") ? await allowed(() => listVoiceAdmin(getDb(), user)) : null;
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="Voice clone" description="Create a cloned staff voice in three steps: consent, a short sample, then clone." />
      <CloneWizard
        staff={data.staff}
        consents={data.consents.filter((c) => !c.revokedAt && !c.inUse).map((c) => ({ id: c.id, subjectId: c.subjectId, purpose: c.purpose, grantedAt: c.grantedAt.toISOString() }))}
        elevenConfigured={!!process.env.ELEVENLABS_API_KEY?.trim()}
      />
    </>
  );
}
