"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

const TEMPLATES: Array<{ id: string; name: string; role: string; instructions: string; knowledge: string }> = [
  {
    id: "sales-closer",
    name: "Sales closer",
    role: "Outbound sales",
    instructions: "You are a friendly, persuasive sales agent calling leads who opted in. Speak briefly, build rapport in the first sentence, ask one qualifying question, and offer to book a callback with a human specialist. Never pressure. If the person says not interested, thank them and end the call politely.",
    knowledge: "Office hours: 9:00 to 21:00 India time. Bookings handled by the sales team within one business day.",
  },
  {
    id: "support-agent",
    name: "Customer support",
    role: "Inbound support",
    instructions: "You are a calm, helpful support agent. Acknowledge the problem, confirm the details, and give the next step or transfer to a human. Do not invent policies. If unsure, say a colleague will follow up.",
    knowledge: "Support hours: 9:00 to 18:00 India time. Urgent issues are escalated within one hour.",
  },
  {
    id: "appointment-setter",
    name: "Appointment setter",
    role: "Booking",
    instructions: "You call to confirm or book appointments. Offer two time slots, confirm the person's name and phone, and repeat the date and time back before ending. If they cannot make it, offer to reschedule.",
    knowledge: "Appointments are 30 minutes, 9:00 to 17:00 India time, Monday to Saturday.",
  },
  {
    id: "reminder-bot",
    name: "Appointment reminder",
    role: "Reminders",
    instructions: "You call to remind someone of an upcoming appointment. State the date, time, location and what to bring. Ask them to confirm attendance, and offer to reschedule if needed.",
    knowledge: "Reminders go out 24 hours and 2 hours before each appointment.",
  },
  {
    id: "debt-collector",
    name: "Payment reminder",
    role: "Collections",
    instructions: "You call about an overdue payment in a respectful, non-threatening way. State the amount owed and the due date, offer payment options, and suggest speaking with the billing team if there is a dispute.",
    knowledge: "Payments can be made by card, UPI or bank transfer. Billing team hours: 10:00 to 18:00 India time.",
  },
  {
    id: "survey-runner",
    name: "Customer survey",
    role: "Research",
    instructions: "You run a short 3-question survey. Ask each question one at a time, record the answer, and thank the person at the end. Keep it under two minutes.",
    knowledge: "Survey responses are anonymous and used only to improve the service.",
  },
];

interface Profile { id: string; name: string; createdAt: string }

export default function AgentTemplatesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  useEffect(() => {
    void fetch("/api/agent-profiles")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; name: string; createdAt: string }>) => setProfiles(data ?? []));
  }, []);

  async function useTemplate(t: { name: string; instructions: string; knowledge: string }) {
    setBusy((b) => new Set([...b, t.name]));
    try {
      const res = await fetch("/api/agent-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(t),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setNote(b.message ?? "Could not create agent from template"); return; }
      setNote(`Created “${t.name}”. Open it in the Agent console.`);
      void fetch("/api/agent-profiles").then((r) => r.ok ? r.json() : []).then((d: Profile[]) => setProfiles(d ?? []));
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== t.name))); }
  }

  async function removeProfile(id: string) {
    if (!confirm("Delete this agent profile? Campaigns using it will lose their agent.")) return;
    setBusy((b) => new Set([...b, id]));
    try {
      const res = await fetch(`/api/agent-profiles/${id}`, { method: "DELETE" });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setNote(b.message ?? "Could not delete"); return; }
      setProfiles((p) => p.filter((x) => x.id !== id));
      setNote("Agent profile deleted.");
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== id))); }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Agent templates</h1>
        <p className="text-sm text-muted-foreground">Ready-made AI agent templates you can copy and customise. Pick one, then edit its instructions and knowledge under Agent console.</p>
      </div>
      {note && <p className="px-5 py-2 text-sm text-success">{note}</p>}
      <Card>
        <CardHeader title="Ready-made templates" description="Each template starts a new agent profile pre-filled with instructions and a knowledge text." />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <Card key={t.id} className="border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
                <Button size="sm" disabled={busy.has(t.name)} onClick={() => void useTemplate(t)}>{busy.has(t.name) ? "Creating…" : "Use template"}</Button>
              </div>
              <div className="text-xs text-muted-foreground mb-2">{t.instructions.slice(0, 120)}…</div>
              <div className="text-xs text-muted-foreground">Knowledge: {t.knowledge.slice(0, 80)}…</div>
            </Card>
          ))}
        </CardBody>
      </Card>

      {profiles.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Your agent profiles" description="Profiles you created. Open one in the Agent console to test it, or delete it." />
          <CardBody>
            <Table>
              <thead><tr><Th>Name</Th><Th>Created</Th><Th> </Th></tr></thead>
              <tbody>
                {profiles.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium">{p.name}</Td>
                    <Td className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</Td>
                    <Td className="text-end">
                      <Link href="/agent-console" className="text-decoration-none"><Button size="sm" variant="outline">Open</Button></Link>{" "}
                      <Button size="sm" variant="outline" disabled={busy.has(p.id)} onClick={() => void removeProfile(p.id)}>{busy.has(p.id) ? "…" : "Delete"}</Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
