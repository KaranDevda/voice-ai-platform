import { listSequences } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { SequencesAdmin } from "@/components/sequences-admin";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function SequencesPage() {
  const user = await requirePageUser();
  const rows = await allowed(() => listSequences(getDb(), user));
  if (!rows) return <Forbidden />;
  return (
    <>
      <PageHeader title="Follow-up sequences" description="A series of texts sent automatically, each some time after the one before. A person who replies STOP, or is on Do Not Disturb, is taken out." />
      <SequencesAdmin sequences={rows.map((s) => ({ id: s.id, name: s.name, status: s.status, steps: s.steps, counts: s.counts, stepProgress: s.stepProgress, stepTrackingEnabled: s.stepTrackingEnabled, outcomes: s.outcomes, messageCounts: s.messageCounts }))} />
    </>
  );
}
