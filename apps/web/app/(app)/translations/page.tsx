import { listExtraLanguagesOrg, listTranslationOverridesOrg, upsertTranslationOverride, deleteTranslationOverride } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { ExtraLanguagesForm, OverridesTable } from "@/components/translations-admin";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function TranslationsPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const [extras, overrides] = await Promise.all([
    allowed(() => listExtraLanguagesOrg(getDb(), user)),
    allowed(() => listTranslationOverridesOrg(getDb(), user)),
  ]);
  if (!extras || !overrides) return <Forbidden />;
  const extrasData = extras as Array<{ code: string; name: string; nativeName: string; rtl: boolean; enabled: boolean }>;
  const overridesData = overrides as Array<{ key: string; language: string; value: string }>;
  return (
    <>
      <PageHeader title="Translations & RTL" description="Manage extra languages and per-language string overrides. RTL is automatic for Arabic/Urdu." />
      <Card>
        <CardHeader title="Extra languages" description="Enabled languages appear in the user's language selector." />
        <CardBody>
          <ExtraLanguagesForm extras={extrasData} />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="String overrides" description="Override any UI string for a specific language. Use the key from the translation dictionary." />
        <CardBody>
          <OverridesTable overrides={overridesData} />
        </CardBody>
      </Card>
    </>
  );
}
