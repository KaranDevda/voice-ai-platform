import { Smartphone } from "lucide-react";
import { currentLang } from "@/lib/i18n-server";
import { listOrgTeams, listTeam } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { AddPhone } from "@/components/add-phone";
import { AddTeamMember, MemberControls } from "@/components/team-admin";
import { PostButton } from "@/components/post-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, timeAgo, titleCase } from "@/lib/utils";
import { T } from "@/components/t";

export default async function TeamPage() {
  const lang = await currentLang();
  const user = await requirePageUser();
  const data = await allowed(() => listTeam(getDb(), user));
  if (!data) return <Forbidden />;
  // Adding people, changing roles and switching people off need users.write (Org admin and platform staff).
  const canManage = data.canResetMfa;
  const teams = canManage ? await listOrgTeams(getDb(), user) : [];

  return (
    <>
      <PageHeader title="Team & devices" description="People you can see, and the agent phones that sync calls to the CRM." />
      <div className="grid gap-6">
        {canManage && <AddTeamMember teams={teams} />}
        <Card>
          <CardHeader title="People" />
          <Table>
            <thead><tr><Th>Email</Th><Th>Roles</Th><Th>Status</Th><Th>2FA</Th><Th>Last sign-in</Th><Th /></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.email}</Td>
                  <Td><div className="flex gap-1">{m.roles.map((r) => <Badge key={r} tone="primary">{titleCase(r)}</Badge>)}</div></Td>
                  <Td><Badge tone={m.status === "active" ? "success" : "danger"}>{titleCase(m.status)}</Badge></Td>
                  <Td>{m.mfa ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</Td>
                  <Td><T>{m.lastLoginAt ? timeAgo(m.lastLoginAt, Date.now(), lang) : "Never"}</T></Td>
                  <Td className="text-end">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {canManage && m.id !== data.selfId && <MemberControls id={m.id} email={m.email} roles={m.roles} status={m.status} />}
                      {data.canResetMfa && m.mfa && m.id !== data.selfId && <PostButton url={`/api/team/${m.id}/mfa-reset`} variant="outline" size="sm" confirm={`Reset two-factor authentication for ${m.email}? They will need to set it up again.`}><T>Reset 2FA</T></PostButton>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Agent phones" description="Android and iPhone. Revoking a device stops it syncing immediately." action={data.canPair ? <AddPhone /> : undefined} />
          {data.devices.length === 0 ? (
            <EmptyState icon={Smartphone} title="No phones linked" description="Press Add a phone, then type the code into the Bizfy Voice AI app." />
          ) : (
            <Table>
              <thead><tr><Th>Agent</Th><Th>Phone</Th><Th>Platform</Th><Th>Work SIM</Th><Th>Last sync</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {data.devices.map((d) => (
                  <Tr key={d.id}>
                    <Td className="font-medium">{d.email}</Td><Td><T>{d.name ?? "Phone"}</T></Td><Td><T>{d.platform === "ios" ? "iPhone" : "Android"}</T></Td><Td>{d.platform === "ios" ? "n/a" : `SIM ${(d.workSimSlot ?? 0) + 1}`}</Td>
                    <Td><T>{d.lastSyncAt ? formatDateTime(d.lastSyncAt, lang) : "Never"}</T></Td>
                    <Td>{d.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}</Td>
                    <Td className="text-end">
                      {data.canRevoke && !d.revokedAt && <PostButton url={`/api/devices/${d.id}/revoke`} variant="outline" size="sm" confirm={`Revoke ${d.email}'s phone? It will stop syncing.`}><T>Revoke</T></PostButton>}
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
