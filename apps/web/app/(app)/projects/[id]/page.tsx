import { Mic2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAsset } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PostButton } from "@/components/post-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { WaveformPlayer } from "@/components/waveform-player";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { clockMs, formatDateTime } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;
interface Seg { speaker: number; startMs: number; endMs: number; text: string }

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser();
  const asset = await allowed(async () => getAsset(getDb(), user, id));
  if (asset === null) return <Forbidden />;
  if (!asset) notFound();
  const segments = (asset.meta.segments as Seg[] | undefined) ?? [];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/projects" className="text-muted-foreground hover:text-foreground">← Projects</Link></p>
      <PageHeader
        title={asset.title}
        description={`${asset.kind === "speech" ? "Speech" : "Transcript"} · ${formatDateTime(asset.createdAt)} · ${asset.ownerEmail}`}
        actions={<PostButton url={`/api/projects/${asset.id}`} method="DELETE" redirectTo="/projects" variant="outline" size="sm" confirm={`Delete "${asset.title}"?`}>Delete</PostButton>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          {asset.hasAudio && <Card><CardHeader title="Audio" /><CardBody><WaveformPlayer src={`/api/projects/${asset.id}/audio`} downloadName={`${asset.title.replace(/[^\w-]+/g, "_")}.${asset.mime?.includes("wav") ? "wav" : "mp3"}`} /></CardBody></Card>}
          <Card>
            <CardHeader title={asset.kind === "speech" ? "Script" : "Transcript"} />
            <CardBody>
              {asset.kind === "transcript" && segments.length > 0 ? (
                <ol className="grid gap-3">
                  {segments.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm"><span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{clockMs(s.startMs)}</span><div><span className="mr-2 text-xs font-medium text-primary">Speaker {s.speaker + 1}</span>{s.text}</div></li>
                  ))}
                </ol>
              ) : <p className="whitespace-pre-wrap text-sm leading-relaxed">{asset.text}</p>}
            </CardBody>
          </Card>
        </div>
        <Card className="content-start">
          <CardHeader title="Details" />
          <dl className="grid divide-y divide-border text-sm">
            <div className="flex justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Provider</dt><dd className="font-medium capitalize">{asset.provider}</dd></div>
            {asset.voiceRef && <div className="flex justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Voice</dt><dd className="font-medium">{asset.voiceRef.replace(/^dg:aura-2-/, "").replace(/-en$/, "").replace(/^profile:.*/, "Cloned voice")}</dd></div>}
            {typeof asset.meta.language === "string" && <div className="flex justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Language</dt><dd><Badge>{asset.meta.language}</Badge></dd></div>}
            {asset.kind === "speech" && asset.voiceRef && <div className="px-5 py-3"><Link href={`/studio?voice=${encodeURIComponent(asset.voiceRef)}`} className="inline-flex items-center gap-2 text-sm text-primary hover:underline"><Mic2 className="h-4 w-4" aria-hidden />Open this voice in Studio</Link></div>}
          </dl>
        </Card>
      </div>
    </>
  );
}
