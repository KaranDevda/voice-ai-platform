import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AccountPanel } from "@/components/account-panel";
import { ApiTokenManager } from "@/components/api-token-manager";
import { MfaPanel } from "@/components/mfa-panel";
import { API_TOKEN_PERMISSIONS, getMfaStatus } from "@voiceai/db";
import { getDb } from "@/lib/server";
import { profileOf, requirePageUser } from "@/lib/page-auth";
import { titleCase } from "@/lib/utils";
import { T } from "@/components/t";

export default async function AccountPage() {
  const user = await requirePageUser();
  const p = await profileOf(user);
  const mfa = await getMfaStatus(getDb(), user);
  return (
    <>
      <PageHeader title="My account" description="Your sign-in details." />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="Who you are" />
          <CardBody className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <span className="text-muted-foreground"><T>E-mail</T></span><span>{p.email}</span>
            <span className="text-muted-foreground"><T>Organisation</T></span><span>{p.orgName}</span>
            <span className="text-muted-foreground"><T>Role</T></span><span>{p.roles.map(titleCase).join(", ")}</span>
          </CardBody>
        </Card>
        <div id="password" className="scroll-mt-20"><AccountPanel /></div>
        <div id="two-factor" className="scroll-mt-20"><MfaPanel {...mfa} /></div>
        <div id="api-tokens" className="scroll-mt-20"><ApiTokenManager availablePermissions={API_TOKEN_PERMISSIONS(user)} /></div>
      </div>
    </>
  );
}
