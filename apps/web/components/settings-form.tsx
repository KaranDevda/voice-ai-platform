"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { OrgSettings } from "@voiceai/shared";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";

interface Props { settings: OrgSettings; dataRetentionDays: number; recordingRetentionDays: number; canEdit: boolean }

export function SettingsForm({ settings, dataRetentionDays, recordingRetentionDays, canEdit }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "");
    const body = {
      dataRetentionDays: Number(str("dataRetentionDays")),
      recordingRetentionDays: Number(str("recordingRetentionDays")),
      settings: {
        ai: {
          greeting: str("greeting"), disclosure: str("disclosure"), systemPrompt: str("systemPrompt"), handoffMessage: str("handoffMessage"),
          handoffOnComplaint: f.get("handoffOnComplaint") === "on", handoffOnPayment: f.get("handoffOnPayment") === "on",
          handoffAfterLowConfidence: Number(str("handoffAfterLowConfidence")), handoffTimeoutSeconds: Number(str("handoffTimeoutSeconds")),
        },
        calling: { windowStart: str("windowStart"), windowEnd: str("windowEnd") },
      },
    };
    setState("saving");
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { setState("saved"); router.refresh(); return; }
    setState("error");
    setMessage(res.status === 400 ? "Some values are out of range. Check the fields and try again." : "You may not have permission to change settings.");
  }

  const ro = !canEdit;
  const check = "h-4 w-4 accent-[var(--primary)]";
  return (
    <form onSubmit={save} className="grid gap-6">
      <fieldset disabled={ro} className="grid gap-6 disabled:opacity-80">
        <Card>
          <CardHeader title="AI assistant" description="What the AI says and how it behaves on calls" />
          <CardBody className="grid gap-4">
            <Field label="Opening disclosure" hint="Played at the start of every AI call. The law requires telling callers they are speaking to an AI and that the call is recorded."><Textarea name="disclosure" rows={2} required defaultValue={settings.ai.disclosure} /></Field>
            <Field label="Greeting"><Input name="greeting" defaultValue={settings.ai.greeting} /></Field>
            <Field label="Instructions for the AI" hint="Keep it short. The AI answers from the knowledge base."><Textarea name="systemPrompt" rows={5} defaultValue={settings.ai.systemPrompt} /></Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hand-off to a person" description="When the AI passes the call to a human" />
          <CardBody className="grid gap-4">
            <Field label="Message before transfer"><Input name="handoffMessage" defaultValue={settings.ai.handoffMessage} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Transfer after unsure answers in a row"><Input name="handoffAfterLowConfidence" type="number" min={1} max={5} defaultValue={settings.ai.handoffAfterLowConfidence} /></Field>
              <Field label="Book a callback if nobody answers (seconds)"><Input name="handoffTimeoutSeconds" type="number" min={10} max={120} defaultValue={settings.ai.handoffTimeoutSeconds} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="handoffOnComplaint" className={check} defaultChecked={settings.ai.handoffOnComplaint} /> Transfer when the caller is making a complaint</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="handoffOnPayment" className={check} defaultChecked={settings.ai.handoffOnPayment} /> Transfer on payment topics</label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Calling window and retention" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Outbound calls start (IST)" hint="TRAI rules: 9:00 to 21:00"><Input name="windowStart" type="time" defaultValue={settings.calling.windowStart} /></Field>
            <Field label="Outbound calls end (IST)"><Input name="windowEnd" type="time" defaultValue={settings.calling.windowEnd} /></Field>
            <Field label="Keep recordings (days)"><Input name="recordingRetentionDays" type="number" min={7} defaultValue={recordingRetentionDays} /></Field>
            <Field label="Keep transcripts and insights (days)"><Input name="dataRetentionDays" type="number" min={30} defaultValue={dataRetentionDays} /></Field>
          </CardBody>
        </Card>
      </fieldset>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save settings"}</Button>
          {state === "saved" && <span role="status" className="text-sm text-success">Saved</span>}
          {state === "error" && <span role="alert" className="text-sm text-danger">{message}</span>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You can view these settings. Only an Org Admin can change them.</p>
      )}
    </form>
  );
}
