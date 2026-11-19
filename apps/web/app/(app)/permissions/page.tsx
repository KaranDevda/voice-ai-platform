import { listRoles } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PermissionRow, FlagRow } from "@/components/permissions-admin";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Th } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { FLAG_PERMISSIONS, SCOPED_PERMISSIONS } from "@voiceai/auth";

const SCOPED_BASES = Object.keys(SCOPED_PERMISSIONS) as Array<keyof typeof SCOPED_PERMISSIONS>;

export default async function PermissionsPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const roles = (await allowed(() => listRoles(getDb(), user))) as Array<{ id: string; key: string; name: string; permissions: string[] }> | null;
  if (!roles) return <Forbidden />;
  return (
    <>
      <PageHeader title="Permission matrix" description="Pick how far each role can reach (none, own, team, all) and switch on/off permissions. Each change saves straight away, is written to the audit log, and applies to everyone with that role." />
      <Card>
        <CardHeader title="Scoped permissions (leads, calls, recordings, etc.)" description="Reach, widest first: all (everyone) > team (their team) > own (their own records) > aggregate (totals only). none = no access. Only the choices that make sense for each permission are offered." />
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
                  <PermissionRow bases={SCOPED_BASES} allowed={SCOPED_PERMISSIONS} key={r.key} role={r} />
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
                  <FlagRow flags={FLAG_PERMISSIONS} key={r.key} role={r} />
                ))}
              </tbody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
