import { listJobs, platformListKyc, platformNumbers } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PlatformPanel } from "@/components/platform-panel";
import { PageHeader } from "@/components/ui/page";
import { requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function PlatformPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const [kyc, nums, jobs] = await Promise.all([platformListKyc(getDb(), user), platformNumbers(getDb(), user), listJobs(getDb(), user)]);
  return (
    <>
      <PageHeader title="Platform" description="Staff only: reviews, phone numbers, acting as a customer, and background jobs." />
      <PlatformPanel
        kyc={kyc.map((k) => ({ ...k, createdAt: k.createdAt.toISOString() }))} numbers={nums.numbers} orgs={nums.orgs}
        requests={nums.requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        jobs={jobs.map((j) => ({ ...j, lastRunAt: j.lastRunAt.toISOString() }))}
      />
    </>
  );
}
