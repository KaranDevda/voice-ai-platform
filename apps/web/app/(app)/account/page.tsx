import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AccountPanel } from "@/components/account-panel";
import { ApiTokenManager } from "@/components/api-token-manager";
import { API_TOKEN_PERMISSIONS } from "@voiceai/db";
import { profileOf, requirePageUser } from "@/lib/page-auth";
import { titleCase } from "@/lib/utils";

export default async function AccountPage() {
  const user = await requirePageUser();
  const p = await profileOf(user);
  return (
    <>
      <PageHeader title="My account" description="Your sign-in details." />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="Who you are" />
          <CardBody className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <span className="text-muted-foreground">E-mail</span><span>{p.email}</span>
            <span className="text-muted-foreground">Organisation</span><span>{p.orgName}</span>
            <span className="text-muted-foreground">Role</span><span>{p.roles.map(titleCase).join(", ")}</span>
          </CardBody>
        </Card>
        <AccountPanel />
        <ApiTokenManager availablePermissions={API_TOKEN_PERMISSIONS(user)} />
      </div>
    </>
  );
}
