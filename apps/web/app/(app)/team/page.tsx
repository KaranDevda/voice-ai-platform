import { Smartphone } from "lucide-react";
import { listTeam } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PostButton } from "@/components/post-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, timeAgo, titleCase } from "@/lib/utils";

export default async function TeamPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listTeam(getDb(), user));
  if (!data) return <Forbidden />;

  return (
    <>
      <PageHeader title="Team & devices" description="People you can see, and the agent phones that sync calls to the CRM." />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="People" />
          <Table>
            <thead><tr><Th>Email</Th><Th>Roles</Th><Th>Status</Th><Th>2FA</Th><Th>Last sign-in</Th></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.email}</Td>
                  <Td><div className="flex gap-1">{m.roles.map((r) => <Badge key={r} tone="primary">{titleCase(r)}</Badge>)}</div></Td>
                  <Td><Badge tone={m.status === "active" ? "success" : "danger"}>{titleCase(m.status)}</Badge></Td>
                  <Td>{m.mfa ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</Td>
                  <Td>{m.lastLoginAt ? timeAgo(m.lastLoginAt) : "Never"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Agent phones" description="Revoking a device stops it syncing immediately" />
          {data.devices.length === 0 ? (
            <EmptyState icon={Smartphone} title="No devices registered" />
          ) : (
            <Table>
              <thead><tr><Th>Agent</Th><Th>Platform</Th><Th>Work SIM</Th><Th>Last sync</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {data.devices.map((d) => (
                  <Tr key={d.id}>
                    <Td className="font-medium">{d.email}</Td><Td>{titleCase(d.platform)}</Td><Td>SIM {(d.workSimSlot ?? 0) + 1}</Td>
                    <Td>{d.lastSyncAt ? formatDateTime(d.lastSyncAt) : "Never"}</Td>
                    <Td>{d.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}</Td>
                    <Td className="text-right">
                      {data.canRevoke && !d.revokedAt && <PostButton url={`/api/devices/${d.id}/revoke`} variant="outline" size="sm" confirm={`Revoke ${d.email}'s phone? It will stop syncing.`}>Revoke</PostButton>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
