"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonClass } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { priceWithMargin, marginOfRevenuePct } from "@voiceai/shared";

interface Bucket { revenuePaise: number; callMinutes: number; texts: number; costPaise: number; profitPaise: number }
interface Report {
  days: number; costs: { callPerMinPaise: number; smsPaise: number };
  total: Bucket & { topupsPaise: number; balancePaise: number };
  byOrg: (Bucket & { orgId: string; orgName: string; topupsPaise: number; balancePaise: number })[];
  byCountry: (Bucket & { country: string })[];
  byDay: (Bucket & { day: string })[];
}
interface CarrierCost { country: string; callCostPerMinPaise: number; smsCostPaise: number; marginPct: number; callPricePaise: number; smsPricePaise: number }
const rs = (p: number) => `${p < 0 ? "-" : ""}Rs ${(Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (p: number) => (p < 0 ? "text-danger" : "text-success");

/** Revenue, estimated carrier cost and profit; carrier costs can be edited here. */
export function ProfitPanel({ report: r, carrierCosts, defaultMarginPct }: { report: Report; carrierCosts: CarrierCost[]; defaultMarginPct: number }) {
  const router = useRouter();
  const [call, setCall] = useState(r.costs.callPerMinPaise);
  const [sms, setSms] = useState(r.costs.smsPaise);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [rule, setRule] = useState({ country: "", call: 0, sms: 0, margin: defaultMarginPct });
  const [orgId, setOrgId] = useState(r.byOrg[0]?.orgId ?? "");
  const [ruleNote, setRuleNote] = useState("");
  const [ruleError, setRuleError] = useState("");

  async function api(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, b: await res.json().catch(() => ({})) as any };
  }
  const failRule = (b: any) => setRuleError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not save");
  async function saveRule(e: FormEvent) {
    e.preventDefault(); setRuleError(""); setRuleNote("");
    const { ok, b } = await api("/api/platform/carrier-costs", "POST", { country: rule.country, callCostPerMinPaise: rule.call, smsCostPaise: rule.sms, marginPct: rule.margin });
    if (!ok) return failRule(b);
    setRuleNote(`${b.country}: calls sell at ${rs(b.callPricePaise)}/min, texts at ${rs(b.smsPricePaise)}.`); setRule((x) => ({ ...x, country: "", call: 0, sms: 0 })); router.refresh();
  }
  async function removeRule(country: string) { await api(`/api/platform/carrier-costs?country=${country}`, "DELETE"); router.refresh(); }
  async function apply() {
    setRuleError(""); setRuleNote("");
    const { ok, b } = await api("/api/platform/carrier-costs/apply", "POST", { orgId });
    if (!ok) return failRule(b);
    setRuleNote(`Prices set for ${b.applied} countries on ${r.byOrg.find((o) => o.orgId === orgId)?.orgName ?? "the organisation"}.`); router.refresh();
  }
  async function saveDefault() { const { ok, b } = await api("/api/platform/carrier-costs", "POST", { defaultMarginPct: rule.margin }); if (!ok) return failRule(b); setRuleError(""); setRuleNote(`Default margin set to ${b.defaultMarginPct}%.`); }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(""); setSaved(false);
    const res = await fetch("/api/platform/costs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callPerMinPaise: call, smsPaise: sms }) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not save");
    setSaved(true); router.refresh();
  }
  const noCosts = r.costs.callPerMinPaise === 0 && r.costs.smsPaise === 0;
  const cols = <><Th>Charged</Th><Th>Call min</Th><Th>Texts</Th><Th>Est. carrier cost</Th><Th>Est. profit</Th><Th>Margin</Th></>;
  const nums = (b: Bucket) => <><Td>{rs(b.revenuePaise)}</Td><Td>{b.callMinutes}</Td><Td>{b.texts}</Td><Td>{rs(b.costPaise)}</Td><Td className={tone(b.profitPaise)}>{rs(b.profitPaise)}</Td><Td>{marginOfRevenuePct(b.revenuePaise, b.costPaise)}%</Td></>;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[7, 30, 90].map((d) => <Link key={d} href={`/profit?days=${d}`} className={buttonClass({ size: "sm", variant: d === r.days ? "default" : "outline" })}>Last {d} days</Link>)}
        <a href={`/api/platform/profit?days=${r.days}`} className={buttonClass({ size: "sm", variant: "outline" })}>Download CSV</a>
      </div>

      <Card>
        <CardHeader title={`Last ${r.days} days`} description="Charged = credit taken from customers for AI calls and texts. Profit is an estimate: the carrier cost uses the rates below." />
        <CardBody className="grid gap-4 sm:grid-cols-5">
          {[["Charged", rs(r.total.revenuePaise), ""], ["Est. carrier cost", rs(r.total.costPaise), ""], ["Est. profit", rs(r.total.profitPaise), tone(r.total.profitPaise)], ["Top-ups paid", rs(r.total.topupsPaise), ""], ["Credit still held", rs(r.total.balancePaise), ""]].map(([k, v, c]) => (
            <div key={k}><div className="text-xs text-muted-foreground">{k}</div><div className={`text-xl font-semibold ${c}`}>{v}</div></div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Carrier costs" description="What the carrier charges you, in paise (100 paise = Rs 1). Without these, profit equals what was charged." />
        <CardBody>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
            <Field label="Per started call minute (paise)"><Input type="number" min={0} max={100000} value={call} onChange={(e) => setCall(Math.round(Number(e.target.value)))} /></Field>
            <Field label="Per text (paise)"><Input type="number" min={0} max={100000} value={sms} onChange={(e) => setSms(Math.round(Number(e.target.value)))} /></Field>
            <div className="flex items-end"><Button type="submit">Save</Button></div>
          </form>
          {noCosts && <p className="mt-2 text-sm text-warning">No carrier costs set yet, so the profit shown is not real.</p>}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          {saved && <p role="status" className="mt-2 text-sm text-success">Saved.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pricing rules" description="Per country: what the carrier charges you plus the profit margin you want on top. The selling price is cost + margin (rounded up). Press Apply to set an organisation's prices to these. Profit reports use each country's cost here; other countries use the carrier costs above." />
        <CardBody className="grid gap-4">
          <form onSubmit={saveRule} className="grid gap-3 sm:grid-cols-5">
            <Field label="Country (2 letters)"><Input value={rule.country} maxLength={2} placeholder="IN" onChange={(e) => setRule((x) => ({ ...x, country: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Carrier cost per call min (paise)"><Input type="number" min={0} max={100000} value={rule.call} onChange={(e) => setRule((x) => ({ ...x, call: Math.round(Number(e.target.value)) }))} /></Field>
            <Field label="Carrier cost per text (paise)"><Input type="number" min={0} max={100000} value={rule.sms} onChange={(e) => setRule((x) => ({ ...x, sms: Math.round(Number(e.target.value)) }))} /></Field>
            <Field label="Margin on top (%)"><Input type="number" min={0} max={1000} step="0.5" value={rule.margin} onChange={(e) => setRule((x) => ({ ...x, margin: Number(e.target.value) }))} /></Field>
            <div className="flex items-end gap-2"><Button type="submit">Save rule</Button><Button type="button" variant="outline" onClick={() => void saveDefault()}>Keep as default</Button></div>
          </form>
          {rule.call + rule.sms > 0 && <p className="text-sm text-muted-foreground">Preview: calls sell at {rs(priceWithMargin(rule.call, Math.min(1000, Math.max(0, rule.margin || 0))))}/min, texts at {rs(priceWithMargin(rule.sms, Math.min(1000, Math.max(0, rule.margin || 0))))}.</p>}
          {carrierCosts.length > 0 && (
            <Table><thead><tr><Th>Country</Th><Th>Carrier cost / min</Th><Th>Carrier cost / text</Th><Th>Margin</Th><Th>Sells at / min</Th><Th>Sells at / text</Th><Th>{""}</Th></tr></thead>
              <tbody>{carrierCosts.map((c) => <Tr key={c.country}><Td className="font-medium">{c.country}</Td><Td>{rs(c.callCostPerMinPaise)}</Td><Td>{rs(c.smsCostPaise)}</Td><Td>{c.marginPct}%</Td><Td>{rs(c.callPricePaise)}</Td><Td>{rs(c.smsPricePaise)}</Td>
                <Td className="text-end"><Button size="sm" variant="outline" onClick={() => setRule({ country: c.country, call: c.callCostPerMinPaise, sms: c.smsCostPaise, margin: c.marginPct })}>Edit</Button> <Button size="sm" variant="outline" onClick={() => void removeRule(c.country)}>Remove</Button></Td></Tr>)}</tbody></Table>
          )}
          {carrierCosts.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Apply these prices to"><Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>{r.byOrg.map((o) => <option key={o.orgId} value={o.orgId}>{o.orgName}</option>)}</Select></Field>
              <Button type="button" disabled={!orgId} onClick={() => void apply()}>Apply margins</Button>
            </div>
          )}
          {ruleError && <p role="alert" className="text-sm text-danger">{ruleError}</p>}
          {ruleNote && <p role="status" className="text-sm text-success">{ruleNote}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="By organisation" />
        <Table><thead><tr><Th>Organisation</Th>{cols}<Th>Top-ups</Th><Th>Balance</Th></tr></thead>
          <tbody>{r.byOrg.map((o) => <Tr key={o.orgId}><Td className="font-medium">{o.orgName}</Td>{nums(o)}<Td>{rs(o.topupsPaise)}</Td><Td>{rs(o.balancePaise)}</Td></Tr>)}</tbody></Table>
      </Card>

      <Card>
        <CardHeader title="By country" description="From the dialling code of the number that was called or texted, worked out when it was charged" />
        {r.byCountry.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No usage in this period.</p></CardBody> : (
          <Table><thead><tr><Th>Country</Th>{cols}</tr></thead><tbody>{r.byCountry.map((c) => <Tr key={c.country}><Td className="font-medium">{c.country}</Td>{nums(c)}</Tr>)}</tbody></Table>
        )}
      </Card>

      <Card>
        <CardHeader title="By day" description="India time" />
        {r.byDay.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No usage in this period.</p></CardBody> : (
          <Table><thead><tr><Th>Day</Th>{cols}</tr></thead><tbody>{r.byDay.slice(0, 31).map((d) => <Tr key={d.day}><Td className="font-medium">{d.day}</Td>{nums(d)}</Tr>)}</tbody></Table>
        )}
      </Card>
    </div>
  );
}
