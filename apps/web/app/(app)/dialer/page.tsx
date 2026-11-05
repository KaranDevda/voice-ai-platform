import { getCallingWindow, listLeadOptions, listSelectableVoices } from "@voiceai/db";
import { Dialer } from "@/components/dialer";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function DialerPage() {
  const user = await requirePageUser();
  const data = await allowed(async () => {
    const db = getDb();
    const [leads, voices, window] = await Promise.all([listLeadOptions(db, user), listSelectableVoices(db, user.orgId), getCallingWindow(db, user)]);
    return { leads, voices: voices.map((v) => ({ id: v.id, label: v.label, gender: v.gender })), window };
  });
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="Web dialer" description="Call a lead from your browser, or have the AI call for you." />
      <Dialer {...data} />
    </>
  );
}
