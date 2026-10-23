import { Forbidden } from "@/components/forbidden";
import { TranscribeWorkspace } from "@/components/transcribe-workspace";
import { PageHeader } from "@/components/ui/page";
import { requirePageUser } from "@/lib/page-auth";

export default async function TranscribePage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("studio.use")) return <Forbidden />;
  return (
    <>
      <PageHeader title="Transcribe" description="Turn recordings into searchable text with speakers and timestamps." />
      <TranscribeWorkspace />
    </>
  );
}
