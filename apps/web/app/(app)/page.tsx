import { AudioLines, ArrowUpRight, BarChart3, Bot, FileText, FolderOpen, Fingerprint, Library, LayoutDashboard, Mic2, Phone, PhoneCall, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { dashboardStats, listAssets, usageToday } from "@voiceai/db";
import { resolveScope } from "@voiceai/auth";
import { ProviderChips } from "@/components/provider-chips";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { checkProviders } from "@/lib/providers";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { cn, formatDateTime } from "@/lib/utils";

interface Tile { href: string; title: string; text: string; icon: LucideIcon; tone: string; show: boolean }

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** Decorative waveform for the hero: fixed heights so server and client render identically. */
const HERO_BARS = Array.from({ length: 56 }, (_, i) => 14 + Math.round(40 * Math.abs(Math.sin(i * 0.43) * Math.cos(i * 0.17)) + 10 * Math.abs(Math.sin(i * 1.7))));

export default async function Launchpad() {
  const user = await requirePageUser();
  const has = (p: string) => user.permissions.includes(p);
  const studio = has("studio.use");
  const recordScope = (b: "leads.read" | "calls.read") => { const s = resolveScope(user, b); return !!s && s !== "aggregate"; };

  const [providers, recent, usage, today] = await Promise.all([
    studio ? checkProviders() : null,
    studio ? allowed(() => listAssets(getDb(), user, { pageSize: 5 })) : null,
    studio ? allowed(() => usageToday(getDb(), user)) : null,
    allowed(() => dashboardStats(getDb(), user, 1)),
  ]);

  const tiles: Tile[] = [
    { href: "/studio", title: "Studio", text: "Turn a script into speech in any voice", icon: Mic2, tone: "text-primary bg-primary-soft", show: studio },
    { href: "/transcribe", title: "Transcribe", text: "Recordings to searchable text", icon: FileText, tone: "text-info bg-info-soft", show: studio },
    { href: "/live", title: "Live conversation", text: "Talk to the AI by voice and watch it respond", icon: AudioLines, tone: "text-primary bg-primary-soft", show: studio },
    { href: "/agent-console", title: "Agent console", text: "Test your AI agent by text or voice", icon: Bot, tone: "text-success bg-success-soft", show: studio },
    { href: "/clone", title: "Voice clone", text: "Clone a staff voice, with consent", icon: Fingerprint, tone: "text-warning bg-warning-soft", show: studio && has("voice_profiles.manage") },
    { href: "/library", title: "Voice library", text: "Audition every voice", icon: Library, tone: "text-primary bg-primary-soft", show: studio },
    { href: "/projects", title: "Projects", text: "Your generated audio and transcripts", icon: FolderOpen, tone: "text-info bg-info-soft", show: !!resolveScope(user, "projects.read") },
    { href: "/dashboard", title: "Dashboard", text: "Calls, sentiment and pipeline", icon: LayoutDashboard, tone: "text-success bg-success-soft", show: true },
    { href: "/leads", title: "Leads", text: "Every prospect and caller", icon: Users, tone: "text-warning bg-warning-soft", show: recordScope("leads.read") },
    { href: "/calls", title: "Call logs", text: "Recordings, transcripts, insights", icon: PhoneCall, tone: "text-primary bg-primary-soft", show: recordScope("calls.read") },
    { href: "/dialer", title: "Web dialer", text: "Call a lead from the browser", icon: Phone, tone: "text-info bg-info-soft", show: has("calls.place") },
    { href: "/reports", title: "Agent reports", text: "Productivity per agent", icon: BarChart3, tone: "text-success bg-success-soft", show: !!resolveScope(user, "reports.read") },
  ];

  return (
    <>
      <section className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 md:px-10 md:py-10">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 flex w-1/2 items-center justify-end gap-[3px] pr-6 opacity-40 md:opacity-70">
          {HERO_BARS.map((h, i) => <span key={i} className="w-[3px] rounded-full" style={{ height: h, background: i % 7 === 0 ? "var(--primary)" : "var(--wave)" }} />)}
        </div>
        <div className="relative max-w-xl">
          <p className="text-sm font-medium text-primary">{greeting()}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">What are we making today?</h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">Create voices, transcribe calls and test your AI agent, then run the call centre from the same place.</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Workflows</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.filter((t) => t.show).map(({ href, title, text, icon: Icon, tone }) => (
              <Link key={href} href={href} className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60 hover:bg-muted/40">
                <div className="flex items-center justify-between">
                  <span className={cn("grid h-10 w-10 place-items-center rounded-lg", tone)}><Icon className="h-5 w-5" aria-hidden /></span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </div>
                <div><div className="font-medium">{title}</div><div className="mt-0.5 text-sm text-muted-foreground">{text}</div></div>
              </Link>
            ))}
          </div>

          {recent && recent.rows.length > 0 && (
            <Card className="mt-6">
              <CardHeader title="Recent projects" action={<Link href="/projects" className="text-sm text-primary hover:underline">View all</Link>} />
              <ul className="divide-y divide-border">
                {recent.rows.map((a) => (
                  <li key={a.id}>
                    <Link href={`/projects/${a.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground">{a.kind === "speech" ? <Mic2 className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                      <Badge tone={a.kind === "speech" ? "primary" : "info"}>{a.kind === "speech" ? "Speech" : "Transcript"}</Badge>
                      <span className="hidden text-xs text-muted-foreground sm:block">{formatDateTime(a.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-6">
          {providers && <Card><CardHeader title="Connections" description="The services the studio runs on" /><CardBody><ProviderChips status={providers} /></CardBody></Card>}
          <Card>
            <CardHeader title="Last 24 hours" />
            <CardBody className="grid grid-cols-2 gap-4">
              {today && <div><div className="text-3xl font-semibold tabular-nums">{today.totals.total}</div><div className="text-xs text-muted-foreground">calls handled</div></div>}
              {usage && <div><div className="text-3xl font-semibold tabular-nums">{usage.calls}</div><div className="text-xs text-muted-foreground">studio requests{usage.errors ? `, ${usage.errors} failed` : ""}</div></div>}
              {!today && !usage && <p className="col-span-2 text-sm text-muted-foreground">Nothing to show for your role.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
