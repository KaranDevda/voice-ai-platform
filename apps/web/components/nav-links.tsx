"use client";
import {
  AudioLines, Bot, BarChart3, BookOpen, Fingerprint, LayoutDashboard, Library, FolderOpen, Mic2, Phone, PhoneCall,
  CreditCard, Hash, Plug, TrendingUp, Megaphone, Shield, ShieldCheck, MessageSquare, Repeat, Rocket, ScrollText, Settings, Activity, Users, UserCog, FileText, Monitor, Logs, Globe, Palette, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  launchpad: Rocket, studio: Mic2, clone: Fingerprint, transcribe: FileText, agent: Bot, live: AudioLines, library: Library, projects: FolderOpen,
  dashboard: LayoutDashboard, leads: Users, calls: PhoneCall, dialer: Phone, campaigns: Megaphone, sms: MessageSquare, billing: CreditCard, kyc: ShieldCheck, numbers: Hash, platform: Shield, profit: TrendingUp, integrations: Plug, sequences: Repeat, reports: BarChart3, permissions: Shield, translations: Globe, theme: Palette,
  voices: AudioLines, knowledge: BookOpen, team: UserCog, audit: ScrollText, logs: Logs, settings: Settings, monitor: Monitor,
};

interface Group { label: string; items: Array<{ href: string; label: string; icon: string }> }

export function NavLinks({ groups, orientation }: { groups: Group[]; orientation: "vertical" | "horizontal" }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const link = (href: string, label: string, icon: string) => {
    const Icon = ICONS[icon] ?? LayoutDashboard;
    const on = active(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex shrink-0 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
          on ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </Link>
    );
  };

  if (orientation === "horizontal") {
    return (
      <nav className="flex gap-1 overflow-x-auto px-3 py-2" aria-label="Main">
        {groups.flatMap((g) => g.items).map((i) => link(i.href, i.label, i.icon))}
      </nav>
    );
  }
  return (
    <nav className="grid gap-3.5" aria-label="Main">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.label}</div>
          <div className="grid gap-0.5">{g.items.map((i) => link(i.href, i.label, i.icon))}</div>
        </div>
      ))}
    </nav>
  );
}
