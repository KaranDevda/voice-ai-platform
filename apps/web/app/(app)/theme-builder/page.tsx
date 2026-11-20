import { getLandingText, setLandingText } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input, Textarea } from "@/components/ui/form";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { T, Tf } from "@/components/t";

export default async function ThemeBuilderPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const landing = await allowed(() => getLandingText(getDb()));
  if (!landing) return <Forbidden />;
  return (
    <>
      <PageHeader title="Theme & landing page" description="Customize the sign-in page headline and text. This is the first thing users see." />
      <Card>
        <CardHeader title="Sign-in page" description="Plain text only. No HTML/markdown." />
        <CardBody className="grid gap-4 max-w-2xl">
          <form action="/api/theme/landing" method="POST" className="grid gap-4">
            <div>
              <label htmlFor="headline" className="block text-sm font-medium mb-1"><T>Headline (max 60 chars)</T></label>
              <Input id="headline" name="headline" defaultValue={landing.headline} maxLength={60} required />
            </div>
            <div>
              <label htmlFor="text" className="block text-sm font-medium mb-1"><T>Sub-text (max 140 chars)</T></label>
              <Textarea id="text" name="text" defaultValue={landing.text} maxLength={140} required rows={3} />
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Theme preview" description="The app uses a dark/light theme stored in a cookie. Users can toggle it from their profile." />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <ThemePreview theme="light" />
            <ThemePreview theme="dark" />
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function ThemePreview({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={`rounded-lg border border-border p-4 ${theme === "dark" ? "bg-neutral-900 text-neutral-50" : "bg-white text-neutral-900"}`}>
      <div className="font-semibold mb-2"><T>{theme === "light" ? "Light mode" : "Dark mode"}</T></div>
      <div className="text-sm opacity-80"><Tf text={theme === "light" ? "This is how cards and text look in light mode." : "This is how cards and text look in dark mode."} /></div>
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"><T>Primary button</T></span>
        <span className="rounded border border-border px-3 py-1 text-xs"><T>Outline button</T></span>
      </div>
    </div>
  );
}