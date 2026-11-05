import { getOrgSettings } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const s = await allowed(() => getOrgSettings(getDb(), user));
  if (!s) return <Forbidden />;
  return (
    <>
      <PageHeader title="Settings" description={`${s.name} · AI agent behaviour, calling hours and data retention`} />
      <SettingsForm settings={s.settings} dataRetentionDays={s.dataRetentionDays} recordingRetentionDays={s.recordingRetentionDays} canEdit={s.canEdit} />
    </>
  );
}
