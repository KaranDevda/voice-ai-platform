import { Forbidden } from "@/components/forbidden";
import { LibraryGrid } from "@/components/library-grid";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/page";
import { requirePageUser } from "@/lib/page-auth";
import { voiceOptionsFor } from "@/lib/voices";

export default async function LibraryPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("studio.use")) return <Forbidden />;
  const voices = await voiceOptionsFor(user);
  return (
    <>
      <PageHeader title="Voice library" description="Audition every voice before you use it in a script or on a call." />
      <div className="mb-6"><Notice>Stock voices are English only. Cloned staff voices carry a consent record and can be revoked at any time.</Notice></div>
      <LibraryGrid voices={voices} />
    </>
  );
}
