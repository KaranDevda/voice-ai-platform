"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";

interface Row { key: string; builtIn: string; override: string }
interface Props { landing: { headline: string; text: string }; languages: { code: string; name: string; added: boolean }[]; lang: string; rows: Row[] }

/** Staff: the text on the sign-in page, and the translations of the interface (change a word, or add a whole language). */
export function ContentPanel({ landing, languages, lang, rows }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [land, setLand] = useState(landing);
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.key, r.override])));
  const [add, setAdd] = useState({ code: "", name: "", rtl: false });

  async function post(url: string, body: unknown): Promise<any | null> {
    setError(""); setMsg("");
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "That did not work"); return null; }
    return b;
  }
  async function saveLanding(e: FormEvent) { e.preventDefault(); if (await post("/api/platform/landing", land)) { setMsg("Sign-in page text saved."); router.refresh(); } }
  async function saveRow(key: string) { if (await post("/api/platform/translations", { action: "save", lang, key, value: vals[key] ?? "" })) { setMsg(`Saved "${key}".`); router.refresh(); } }
  async function addLanguage(e: FormEvent) {
    e.preventDefault();
    const b = await post("/api/platform/translations", { action: "addLanguage", ...add });
    if (b) { setAdd({ code: "", name: "", rtl: false }); window.location.href = `/platform?lang=${b.code}`; }
  }
  async function removeLanguage() {
    if (!confirm("Remove this language and all its translations?")) return;
    if (await post("/api/platform/translations", { action: "deleteLanguage", code: lang })) window.location.href = "/platform";
  }
  const current = languages.find((l) => l.code === lang);

  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {msg && <p role="status" className="text-sm text-success">{msg}</p>}

      <Card>
        <CardHeader title="Sign-in page text (staff)" description="The headline and the line under the logo that visitors see before signing in. Empty puts the standard text back." />
        <CardBody>
          <form onSubmit={saveLanding} className="grid gap-3 sm:grid-cols-2">
            <Field label="Headline" hint="Up to 60 characters"><Input value={land.headline} maxLength={60} placeholder="Bizfy Voice AI" onChange={(e) => setLand((l) => ({ ...l, headline: e.target.value }))} /></Field>
            <Field label="Line under it" hint="Up to 140 characters"><Input value={land.text} maxLength={140} placeholder="Calls, voices and AI agents in one place" onChange={(e) => setLand((l) => ({ ...l, text: e.target.value }))} /></Field>
            <div><Button type="submit" size="sm">Save</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Translations (staff)" description="Change how a word or title appears in a language, or add a language of your own. Changes show within about 15 seconds. Page text without a translation stays in English." />
        <CardBody className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Language"><Select value={lang} onChange={(e) => { window.location.href = `/platform?lang=${e.target.value}`; }}>{languages.map((l) => <option key={l.code} value={l.code}>{l.name}{l.added ? " (added)" : ""}</option>)}</Select></Field>
            {current?.added && <Button type="button" size="sm" variant="outline" onClick={() => void removeLanguage()}>Remove this language</Button>}
          </div>
          <Table>
            <thead><tr><Th>English</Th><Th>Built in</Th><Th>Your wording</Th><Th> </Th></tr></thead>
            <tbody>{rows.map((r) => (
              <Tr key={r.key}>
                <Td className="font-medium">{r.key}</Td>
                <Td className="text-muted-foreground">{r.builtIn || "—"}</Td>
                <Td><Input value={vals[r.key] ?? ""} maxLength={300} placeholder={r.builtIn || r.key} onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))} aria-label={`Your wording for ${r.key}`} /></Td>
                <Td className="text-end"><Button type="button" size="sm" variant="outline" disabled={(vals[r.key] ?? "") === r.override} onClick={() => void saveRow(r.key)}>Save</Button></Td>
              </Tr>
            ))}</tbody>
          </Table>
          <form onSubmit={addLanguage} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4">
            <Field label="New language code" hint="2 or 3 letters, like sw"><Input value={add.code} maxLength={6} onChange={(e) => setAdd((a) => ({ ...a, code: e.target.value.toLowerCase() }))} required /></Field>
            <Field label="Its name, in that language" hint="Shown in the language menu"><Input value={add.name} maxLength={40} onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))} required /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={add.rtl} onChange={(e) => setAdd((a) => ({ ...a, rtl: e.target.checked }))} /> Written right to left</label>
            <div className="flex items-end"><Button type="submit" size="sm" disabled={!add.code || !add.name.trim()}>Add language</Button></div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
