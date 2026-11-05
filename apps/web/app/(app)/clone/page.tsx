import { builtInHindi, cloningReady, hindiConversionOn } from "@/lib/providers";
import { listVoiceAdmin } from "@voiceai/db";
import { AddLanguage } from "@/components/add-language";
import { CloneWizard } from "@/components/clone-wizard";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function ClonePage() {
  const user = await requirePageUser();
  const data = user.permissions.includes("studio.use") ? await allowed(() => listVoiceAdmin(getDb(), user)) : null;
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="Voice clone" description="Create a cloned staff voice in three steps: consent, a short sample, then clone." />
      <div className="grid gap-8">
      <CloneWizard
        staff={data.staff}
        consents={data.consents.filter((c) => !c.revokedAt && !c.inUse).map((c) => ({ id: c.id, subjectId: c.subjectId, purpose: c.purpose, grantedAt: c.grantedAt.toISOString() }))}
        cloningReady={cloningReady()}
        builtInHindi={builtInHindi()}
        ownVoiceHindi={hindiConversionOn()}
      />
      {(!builtInHindi() || hindiConversionOn()) && <AddLanguage
        voices={data.profiles.filter((p) => p.status === "active" && p.provider === "pocket_tts").map((p) => ({ id: p.id, label: p.label, gender: p.gender, donorName: [p.donorFirst, p.donorLast].filter(Boolean).join(" ") || p.donorEmail }))}
        hindiReady={hindiConversionOn() || (!!process.env.POCKET_TTS_HI_URL?.trim() && !!process.env.POCKET_TTS_BIN?.trim())}
        ownVoice={hindiConversionOn()}
      />}
      </div>
    </>
  );
}
