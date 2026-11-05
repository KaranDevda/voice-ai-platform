import { BookOpen } from "lucide-react";
import { listKnowledge } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { KnowledgeAdd } from "@/components/knowledge-add";
import { PostButton } from "@/components/post-button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Notice } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDate } from "@/lib/utils";

export default async function KnowledgePage() {
  const user = await requirePageUser();
  const docs = await allowed(() => listKnowledge(getDb(), user));
  if (!docs) return <Forbidden />;
  const canWrite = user.permissions.includes("kb.write");

  return (
    <>
      <PageHeader title="Knowledge base" description="Documents the AI answers from. Answers are grounded in these, not invented." />
      <div className="mb-6"><Notice>Search currently matches keywords. Smarter meaning-based search turns on once AskG1&apos;s embedding service is connected; your documents will not need re-uploading.</Notice></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`Documents (${docs.length})`} />
          {docs.length === 0 ? (
            <EmptyState icon={BookOpen} title="No documents yet" description={canWrite ? "Add your first document on the right." : "An Org Admin can add documents."} />
          ) : (
            <Table>
              <thead><tr><Th>Title</Th><Th>Source</Th><Th>Passages</Th><Th>Added</Th>{canWrite && <Th />}</tr></thead>
              <tbody>
                {docs.map((d) => (
                  <Tr key={d.id}>
                    <Td className="font-medium">{d.title}</Td><Td className="max-w-48 truncate text-muted-foreground">{d.sourceUrl ?? "Added in app"}</Td><Td className="tabular-nums">{d.chunks}</Td><Td>{formatDate(d.createdAt)}</Td>
                    {canWrite && <Td className="text-right"><PostButton url={`/api/knowledge/${d.id}`} method="DELETE" variant="ghost" size="sm" confirm={`Delete "${d.title}"? The AI will stop using it.`}>Delete</PostButton></Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        {canWrite && <KnowledgeAdd />}
      </div>
    </>
  );
}
