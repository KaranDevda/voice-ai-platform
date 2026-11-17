import { listRoles, updateRole } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PermissionRow, FlagRow, SaveAllButton } from "@/components/permissions-admin";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Select } from "@/components/ui/form";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { FLAG_PERMISSIONS, type Permission, SCOPED_PERMISSIONS } from "@voiceai/auth";

const SCOPED_BASES = Object.keys(SCOPED_PERMISSIONS) as Array<keyof typeof SCOPED_PERMISSIONS>;
const SCOPES = ["all", "team", "own", "aggregate"] as const;
const ROLE_KEYS = ["super_admin", "org_admin", "manager", "agent", "qa_auditor", "viewer"] as const;

export default async function PermissionsPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const roles = (await allowed(() => listRoles(getDb(), user))) as Array<{ id: string; key: string; name: string; permissions: Permission[] }> | null;
  if (!roles) return <Forbidden />;
  return (
    <>
      <PageHeader title="Permission matrix" description="Edit which scoped permissions each role receives. Flag permissions are on/off per role. Changes take effect on next login." actions={<SaveAllButton roles={roles} />} />
      <Card>
        <CardHeader title="Scoped permissions (leads, calls, recordings, etc.)" description="Each cell = scope level. 'all' > 'team' > 'own' > 'aggregate'." />
        <CardBody>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Role</Th>
                  {SCOPED_BASES.map((base) => <Th key={base} className="text-center min-w-[100px]">{base.replace(/_/g, " ")}</Th>)}
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <PermissionRow bases={SCOPED_BASES} key={r.key} role={r} roles={roles} />
                ))}
              </tbody>
            </Table>
          </div>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Flag permissions (on/off)" description="These are not scoped — a role either has them or not." />
        <CardBody>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>Role</Th>{FLAG_PERMISSIONS.map((f) => <Th key={f} className="text-center min-w-[140px]">{f}</Th>)}</tr></thead>
              <tbody>
                {roles.map((r) => (
                  <FlagRow flags={FLAG_PERMISSIONS} key={r.key} role={r} roles={roles} />
                ))}
              </tbody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
