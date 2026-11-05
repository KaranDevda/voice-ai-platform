import { cloningReady, highQualityReady } from "@/lib/providers";
import { Forbidden } from "@/components/forbidden";
import { StudioEditor } from "@/components/studio-editor";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/page-auth";
import { voiceOptionsFor } from "@/lib/voices";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ voice?: string }> }) {
  const user = await requirePageUser();
  if (!user.permissions.includes("studio.use")) return <Forbidden />;
  // Seeded placeholder voices have no audio behind them, so they are not offered.
  const [voices, sp] = [(await voiceOptionsFor(user)).filter((v) => !v.detail.startsWith("Demo")), await searchParams];
  return (
    <>
      <PageHeader title="Studio" description="Turn a script into speech in any stock or cloned staff voice." />
      <StudioEditor voices={voices} initialVoice={sp.voice} cloningReady={cloningReady()} highQualityReady={highQualityReady()} />
    </>
  );
}
