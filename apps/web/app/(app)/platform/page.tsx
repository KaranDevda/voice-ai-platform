import { getLandingText, listExtraLanguages, listJobs, platformListKyc, platformNumbers, translationOverrides } from "@voiceai/db";
import { ContentPanel } from "@/components/content-panel";
import { Forbidden } from "@/components/forbidden";
import { PlatformPanel } from "@/components/platform-panel";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/page-auth";
import { builtInTranslation, LANGUAGES, TRANSLATABLE } from "@/lib/i18n";
import { getDb } from "@/lib/server";

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const [kyc, nums, jobs] = await Promise.all([platformListKyc(getDb(), user), platformNumbers(getDb(), user), listJobs(getDb(), user)]);
  const extras = await listExtraLanguages(getDb());
  const languages = [...LANGUAGES.filter((l) => l.code !== "en").map((l) => ({ code: l.code as string, name: l.name as string, added: false })), ...extras.map((l) => ({ code: l.code, name: l.name, added: true }))];
  const sp = await searchParams;
  const lang = languages.some((l) => l.code === sp.lang) ? sp.lang! : languages[0]!.code;
  const overrides = await translationOverrides(getDb(), lang);
  const rows = TRANSLATABLE.map((key) => ({ key, builtIn: builtInTranslation(lang, key), override: overrides[key] ?? "" }));
  const landing = await getLandingText(getDb());
  return (
    <>
      <PageHeader title="Platform" description="Staff only: reviews, phone numbers, acting as a customer, and background jobs." />
      <PlatformPanel
        kyc={kyc.map((k) => ({ ...k, createdAt: k.createdAt.toISOString() }))} numbers={nums.numbers} orgs={nums.orgs}
        requests={nums.requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        jobs={jobs.map((j) => ({ ...j, lastRunAt: j.lastRunAt.toISOString() }))}
      />
      <div className="mt-6"><ContentPanel landing={landing} languages={languages} lang={lang} rows={rows} /></div>
    </>
  );
}
