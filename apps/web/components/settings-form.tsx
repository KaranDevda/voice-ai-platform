"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { OrgSettings } from "@voiceai/shared";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";
import { T } from "./t";

interface Props { settings: OrgSettings; dataRetentionDays: number; recordingRetentionDays: number; canEdit: boolean }

export function SettingsForm({ settings, dataRetentionDays, recordingRetentionDays, canEdit }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; // React clears currentTarget after the first await
    const f = new FormData(form);
    const str = (k: string) => String(f.get(k) ?? "");
    const body = {
      dataRetentionDays: Number(str("dataRetentionDays")),
      recordingRetentionDays: Number(str("recordingRetentionDays")),
      settings: {
        ai: {
          greeting: str("greeting"), disclosure: str("disclosure"), systemPrompt: str("systemPrompt"), handoffMessage: str("handoffMessage"),
          handoffOnComplaint: f.get("handoffOnComplaint") === "on", handoffOnPayment: f.get("handoffOnPayment") === "on",
          handoffAfterLowConfidence: Number(str("handoffAfterLowConfidence")), handoffTimeoutSeconds: Number(str("handoffTimeoutSeconds")),
          model: str("aiModel") === "openrouter" ? "openrouter" : "default", openrouterModel: str("openrouterModel").trim() || "openai/gpt-4o-mini",
        },
        brand: { name: str("brandName"), tagline: str("brandTagline"), primary: f.get("brandUse") === "on" ? str("brandPrimary") : "" },
        calling: { windowStart: str("windowStart"), windowEnd: str("windowEnd") },
        compliance: { requireKyc: f.get("requireKyc") === "on" },
        sms: { autoReply: f.get("smsAutoReply") === "on" },
        billing: {
          enabled: f.get("billingEnabled") === "on", enforce: f.get("billingEnforce") === "on",
          callPerMinPaise: Math.round(Number(str("callPerMinPaise")) || 0), smsPaise: Math.round(Number(str("smsPaise")) || 0),
          lowBalancePaise: Math.round((Number(str("lowBalanceRupees")) || 0) * 100),
        },
        phone: {
          handoffNumber: str("handoffNumber").replace(/[\s-]/g, ""),
          menu: {
            enabled: f.get("menuEnabled") === "on", prompt: str("menuPrompt"), promptHi: str("menuPromptHi"),
            // keys 1 to 3: what each does; "-" means the key is not offered
            options: Object.fromEntries(["1", "2", "3"].map((k) => [k, str(`menuKey${k}`)]).filter(([, v]) => v && v !== "-")),
          },
        },
      },
    };
    setState("saving");
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, confirmPassword: str("confirmPassword") }) });
    const passwordField = form.elements.namedItem("confirmPassword") as HTMLInputElement | null;
    if (res.ok) { setState("saved"); if (passwordField) passwordField.value = ""; router.refresh(); return; }
    setState("error");
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    setMessage(err.error === "password" ? "Not saved: your password is not right." : res.status === 400 ? "Some values are out of range. Check the fields and try again." : "You may not have permission to change settings.");
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Which AI answers calls" hint="AskG1 is the default. OpenRouter needs a key on the server.">
                <select name="aiModel" defaultValue={settings.ai.model} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"><option value="default"><T>AskG1 (default)</T></option><option value="openrouter"><T>OpenRouter model</T></option></select>
              </Field>
              <Field label="OpenRouter model" hint="Used when OpenRouter is chosen. Check the id on openrouter.ai/models.">
                <Input name="openrouterModel" list="openrouter-models" defaultValue={settings.ai.openrouterModel} maxLength={100} />
                <datalist id="openrouter-models"><option value="openai/gpt-4o-mini" /><option value="google/gemini-2.0-flash-001" /><option value="meta-llama/llama-3.1-70b-instruct" /><option value="deepseek/deepseek-chat" /><option value="moonshotai/kimi-k2" /></datalist>
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Look and feel" description="Your name and colour for everyone in your organisation. Leave empty for the standard look." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Name in the menu"><Input name="brandName" maxLength={40} placeholder="Bizfy Voice AI" defaultValue={settings.brand.name} /></Field>
            <Field label="Line under the name"><Input name="brandTagline" maxLength={60} placeholder="Calls · voices · agents" defaultValue={settings.brand.tagline} /></Field>
            <Field label="Main colour">
              <div className="flex items-center gap-2"><input type="color" name="brandPrimary" defaultValue={settings.brand.primary || "#2563eb"} className="h-9 w-12 rounded-md border border-border bg-background" aria-label="Main colour" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="brandUse" className={check} defaultChecked={!!settings.brand.primary} /> <T>Use it</T></label></div>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hand-off to a person" description="When the AI passes the call to a human" />
          <CardBody className="grid gap-4">
            <Field label="Message before transfer"><Input name="handoffMessage" defaultValue={settings.ai.handoffMessage} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Transfer after unsure answers in a row"><Input name="handoffAfterLowConfidence" type="number" min={1} max={5} defaultValue={settings.ai.handoffAfterLowConfidence} /></Field>
              <Field label="Colleague ring timeout (seconds)" hint="If the colleague does not answer, the caller hears a clear message in their selected language."><Input name="handoffTimeoutSeconds" type="number" min={10} max={120} defaultValue={settings.ai.handoffTimeoutSeconds} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="handoffOnComplaint" className={check} defaultChecked={settings.ai.handoffOnComplaint} /> <T>Transfer when the caller is making a complaint</T></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="handoffOnPayment" className={check} defaultChecked={settings.ai.handoffOnPayment} /> <T>Transfer on payment topics</T></label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Texts" description="How incoming texts are handled" />
          <CardBody className="grid gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="smsAutoReply" className={check} defaultChecked={settings.sms.autoReply} /> <T>Answer incoming texts automatically (the AI replies from the knowledge base)</T></label>
            <p className="text-xs text-muted-foreground"><T>Needs a number that can receive texts. Plivo cannot receive texts on Indian numbers. A person gets at most one automatic reply every 10 minutes, and STOP always switches Do Not Disturb on.</T></p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Verification (KYC)" description="Your verification level is on the KYC page." />
          <CardBody className="grid gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireKyc" className={check} defaultChecked={settings.compliance.requireKyc} /> <T>Require KYC before campaigns, texts and follow-ups can run</T></label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Billing" description="Prepaid credit for AI calls and texts. Prices are in paise (100 paise = Rs 1). Off by default." />
          <CardBody className="grid gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="billingEnabled" className={check} defaultChecked={settings.billing.enabled} /> <T>Charge for AI calls and texts from the credit balance</T></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="AI call, per started minute (paise)" hint="150 = Rs 1.50 a minute"><Input name="callPerMinPaise" type="number" min={0} max={100000} step={1} defaultValue={settings.billing.callPerMinPaise} /></Field>
              <Field label="Text message, each (paise)"><Input name="smsPaise" type="number" min={0} max={100000} step={1} defaultValue={settings.billing.smsPaise} /></Field>
            </div>
            <Field label="Low balance alert (Rs)" hint="E-mail the organisation's admins once when the balance falls under this. 0 = off. Needs e-mail (SMTP) set up."><Input name="lowBalanceRupees" type="number" min={0} max={100000} step={1} defaultValue={settings.billing.lowBalancePaise / 100} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="billingEnforce" className={check} defaultChecked={settings.billing.enforce} /> <T>Refuse calls and texts when the balance is zero or less</T></label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Phone menu and transfer number" description="What callers hear first, and who a handed-over call goes to" />
          <CardBody className="grid gap-4">
            <Field label="Transfer number" hint="Where calls go when the AI hands over or a caller presses the person key. International format, e.g. +919876543210. Empty uses the server's default."><Input name="handoffNumber" inputMode="tel" placeholder="+91..." defaultValue={settings.phone.handoffNumber} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="menuEnabled" className={check} defaultChecked={settings.phone.menu.enabled} /> <T>Play a touch-tone menu before the AI answers (inbound calls and campaign calls)</T></label>
            <Field label="Menu prompt (English)"><Input name="menuPrompt" defaultValue={settings.phone.menu.prompt} maxLength={300} /></Field>
            <Field label="Menu prompt (Hindi)" hint="Used for Hindi and Hinglish calls. Spoken by your own voice, so write numbers as words."><Input name="menuPromptHi" defaultValue={settings.phone.menu.promptHi} maxLength={300} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["1", "2", "3"] as const).map((k) => (
                <Field key={k} label={`Key ${k}`}>
                  <select name={`menuKey${k}`} defaultValue={settings.phone.menu.options[k] ?? "-"} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    <option value="-"><T>Not offered</T></option><option value="ai"><T>Talk to the assistant</T></option><option value="person"><T>Speak to a person</T></option><option value="hangup"><T>Hang up</T></option>
                  </select>
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted-foreground"><T>A caller who presses nothing, or a key that is not offered, goes to the assistant. Your menu prompt must say which key does what.</T></p>
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Field label="Your password" hint="Needed to save organisation settings."><Input name="confirmPassword" type="password" required autoComplete="current-password" /></Field></div>
          <Button type="submit" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save settings"}</Button>
          {state === "saved" && <span role="status" className="text-sm text-success"><T>Saved</T></span>}
          {state === "error" && <span role="alert" className="text-sm text-danger"><T>{message}</T></span>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground"><T>You can view these settings. Only an Org Admin can change them.</T></p>
      )}
    </form>
  );
}
