import { FileText, FolderOpen, Mic2 } from "lucide-react";
import Link from "next/link";
import { listAssets } from "@voiceai/db";
import { AudioButton } from "@/components/audio-button";
import { FilterBar } from "@/components/filter-bar";
import { Forbidden } from "@/components/forbidden";
import { PostButton } from "@/components/post-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime } from "@/lib/utils";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; page?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const kind = sp.kind === "speech" || sp.kind === "transcript" ? sp.kind : undefined;
  const data = await allowed(() => listAssets(getDb(), user, { q: sp.q, kind, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;
  const showOwner = user.permissions.includes("projects.read.all");

  return (
    <>
      <PageHeader title="Projects" description="Everything you generated or transcribed in the studio." />
      <Card>
        <FilterBar action="/projects" q={sp.q} selects={[{ name: "kind", value: kind, label: "All types", options: [["speech", "Speech"], ["transcript", "Transcripts"]] }]} />
        {data.rows.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No projects yet" description="Generate speech in the Studio or transcribe a recording and save it here." />
        ) : (
          <ul className="divide-y divide-border">
            {data.rows.map((a) => (
              <li key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                {a.kind === "speech" && a.hasAudio ? <AudioButton src={`/api/projects/${a.id}/audio`} label={`Play ${a.title}`} /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">{a.kind === "speech" ? <Mic2 className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}</span>}
                <div className="min-w-0 flex-1">
                  <Link href={`/projects/${a.id}`} className="block truncate font-medium hover:text-primary">{a.title}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge tone={a.kind === "speech" ? "primary" : "info"}>{a.kind === "speech" ? "Speech" : "Transcript"}</Badge>
                    <span>{formatDateTime(a.createdAt)}</span>{showOwner && <span>· {a.ownerEmail}</span>}
                  </div>
                </div>
                <PostButton url={`/api/projects/${a.id}`} method="DELETE" variant="ghost" size="sm" confirm={`Delete "${a.title}"? This cannot be undone.`}>Delete</PostButton>
              </li>
            ))}
          </ul>
        )}
        <Pager basePath="/projects" params={{ q: sp.q, kind }} page={data.page} hasMore={data.hasMore} />
      </Card>
    </>
  );
}
