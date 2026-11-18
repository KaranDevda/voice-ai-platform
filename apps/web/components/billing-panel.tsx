"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select, Textarea } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";

type Gateway = "razorpay" | "stripe" | "paypal" | "paystack" | "flutterwave" | "cryptomus";
const GATEWAYS: { id: Gateway; label: string; currencies: string[] }[] = [
  { id: "razorpay", label: "Razorpay (UPI, cards, netbanking)", currencies: ["INR"] },
  { id: "stripe", label: "Stripe (cards)", currencies: ["INR", "USD", "EUR", "GBP"] },
  { id: "paypal", label: "PayPal", currencies: ["USD", "EUR", "GBP"] },
  { id: "paystack", label: "Paystack", currencies: ["NGN", "GHS", "ZAR", "USD"] },
  { id: "flutterwave", label: "Flutterwave", currencies: ["USD", "NGN", "GHS", "KES", "ZAR"] },
  { id: "cryptomus", label: "Cryptomus (crypto)", currencies: ["USD"] },
];
interface Props {
  balancePaise: number; billing: { enabled: boolean; callPerMinPaise: number; smsPaise: number; enforce: boolean; lowBalancePaise: number };
  canEdit: boolean; isPlatformAdmin: boolean; gateways: Record<Gateway, boolean>;
  rates: { country: string; callPerMinPaise: number; smsPaise: number }[]; exchange: { currency: string; paisePerUnit: number; updatedAt: string }[];
  usage: { days: number; totalPaise: number; calls: { paise: number; count: number }; texts: { paise: number; count: number }; byCountry: { country: string; paise: number }[] };
  /** Platform staff only. */
  balances?: { orgId: string; orgName: string; topupsPaise: number; balancePaise: number }[];
  gatewayStatus?: { id: string; label: string; configured: boolean; missing: string[]; webhookUrl: string; note: string }[];
  ledger: { id: string; deltaPaise: number; reason: string; note: string | null; createdAt: string }[];
  payments: { id: string; gateway: string; amountPaise: number; currency: string; amountMinor: number | null; status: string; createdAt: string }[];
}
const rupees = (paise: number) => `${paise < 0 ? "-" : ""}Rs ${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const REASON: Record<string, string> = { topup: "Top-up", usage_call: "AI call", usage_sms: "Text", adjustment: "Adjustment", refund: "Refund" };

/** Balance, adding credit (six gateways), prices by country, exchange rates (staff), the ledger, and a staff adjustment. */
export function BillingPanel({ balancePaise, billing, canEdit, isPlatformAdmin, gateways, rates, exchange, ledger, payments, usage, balances, gatewayStatus }: Props) {
  const router = useRouter();
  const available = GATEWAYS.filter((g) => gateways[g.id]);
  const [gateway, setGateway] = useState<Gateway>(available[0]?.id ?? "razorpay");
  const g = GATEWAYS.find((x) => x.id === gateway)!;
  const [currency, setCurrency] = useState(g.currencies[0]!);
  const [amount, setAmount] = useState(500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [adj, setAdj] = useState({ rupees: 0, note: "", refund: false, orgId: "" });
  const [refreshing, setRefreshing] = useState(false);
  const [rate, setRate] = useState({ country: "", call: 0, sms: 0 });
  const [csv, setCsv] = useState("");
  const [imported, setImported] = useState<{ saved: number; problems: { row: number; reason: string }[] } | null>(null);
  const [fx, setFx] = useState({ currency: "USD", rupees: 83 });

  const usdRate = exchange.find((e) => e.currency === "USD")?.paisePerUnit;
  const fxRate = exchange.find((e) => e.currency === currency)?.paisePerUnit;
  const credit = currency === "INR" ? Math.round(amount * 100) : fxRate ? Math.round(amount * fxRate) : null;
  const pickGateway = (id: Gateway) => { setGateway(id); setCurrency(GATEWAYS.find((x) => x.id === id)!.currencies[0]!); };

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, b: await res.json().catch(() => ({})) as any };
  }
  const fail = (b: any, fallback: string) => setError(b.message ?? b.hint ?? b.issues?.[0]?.message ?? b.error ?? fallback);

  async function topUp(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { ok, b } = await call("/api/billing/topup", "POST", { gateway, amount, currency });
    setBusy(false);
    if (!ok) return fail(b, "Could not start the payment");
    window.location.href = b.url;
  }
  async function adjust(e: FormEvent) {
    e.preventDefault();
    setError(""); setNote("");
    const { ok, b } = await call("/api/billing/adjust", "POST", { ...(adj.orgId ? { orgId: adj.orgId } : {}), amountPaise: Math.round(adj.rupees * 100), note: adj.note, refund: adj.refund });
    if (!ok) return fail(b, "Could not adjust");
    setNote(`Balance is now ${rupees(b.balancePaise)}.`); setAdj((a) => ({ rupees: 0, note: "", refund: false, orgId: a.orgId })); router.refresh();
  }
  async function saveRate(e: FormEvent) {
    e.preventDefault();
    setError(""); setNote("");
    const { ok, b } = await call("/api/billing/rates", "POST", { country: rate.country, callPerMinPaise: rate.call, smsPaise: rate.sms });
    if (!ok) return fail(b, "Could not save the price");
    setRate({ country: "", call: 0, sms: 0 }); router.refresh();
  }
  async function removeRate(country: string) {
    if (!confirm(`Remove the price for ${country}? The standard price will apply.`)) return;
    await call(`/api/billing/rates?country=${country}`, "DELETE"); router.refresh();
  }
  async function importRates() {
    setError(""); setImported(null);
    const { ok, b } = await call("/api/billing/rates/import", "POST", { text: csv });
    if (!ok) return fail(b, "Could not import");
    setImported(b); setCsv(""); router.refresh();
  }
  async function saveFx(e: FormEvent) {
    e.preventDefault();
    setError(""); setNote("");
    const { ok, b } = await call("/api/billing/exchange-rate", "POST", { currency: fx.currency, paisePerUnit: Math.round(fx.rupees * 100 * 1e6) / 1e6 });
    if (!ok) return fail(b, "Could not save the rate");
    setNote(`${b.currency} saved.`); router.refresh();
  }

  async function refreshFx() {
    setRefreshing(true); setError(""); setNote("");
    const { ok, b } = await call("/api/billing/exchange-rate/refresh", "POST");
    setRefreshing(false);
    if (!ok) return fail(b, "Could not refresh the rates");
    setNote(`Updated ${b.updated.length} rates${b.skipped.length ? `; skipped ${b.skipped.map((x: { currency: string; why: string }) => `${x.currency} (${x.why})`).join(", ")}` : ""}.`); router.refresh();
  }
  async function removeFx(currency: string) {
    if (!confirm(`Remove the ${currency} rate? People can no longer pay in ${currency} until it is set again.`)) return;
    const { ok, b } = await call(`/api/billing/exchange-rate?currency=${currency}`, "DELETE");
    if (!ok) return fail(b, "Could not remove it");
    router.refresh();
  }
  const low = billing.enabled && billing.lowBalancePaise > 0 && balancePaise < billing.lowBalancePaise;
  const stale = (iso: string) => Date.now() - new Date(iso).getTime() > 36 * 3_600_000;

  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card>
        <CardHeader title="Balance" description={billing.enabled ? `Standard prices: AI calls ${rupees(billing.callPerMinPaise)} per minute · texts ${rupees(billing.smsPaise)} each${billing.enforce ? " · calls and texts stop at zero" : ""}` : "Billing is off: nothing is charged. Turn it on in Settings."} />
        <CardBody><p className={`text-3xl font-semibold ${balancePaise <= 0 && billing.enabled ? "text-danger" : ""}`}>{rupees(balancePaise)}</p>{usdRate ? <p className="mt-1 text-sm text-muted-foreground">≈ ${(balancePaise / usdRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD at today's rate</p> : null}</CardBody>
      </Card>

      {low && <p role="status" className="rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm">Your balance is under the {rupees(billing.lowBalancePaise)} limit you set in Settings. Add credit below{billing.enforce ? ", or calls and texts stop at zero" : ""}.</p>}

      <Card>
        <CardHeader title={`Spending, last ${usage.days} days`} description="From your credit history" />
        <CardBody className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><div className="text-sm text-muted-foreground">Total spent</div><div className="text-xl font-semibold">{rupees(usage.totalPaise)}</div></div>
            <div><div className="text-sm text-muted-foreground">AI calls</div><div className="text-xl font-semibold">{rupees(usage.calls.paise)}</div><div className="text-xs text-muted-foreground">{usage.calls.count} charged calls</div></div>
            <div><div className="text-sm text-muted-foreground">Texts</div><div className="text-xl font-semibold">{rupees(usage.texts.paise)}</div><div className="text-xs text-muted-foreground">{usage.texts.count} charged texts</div></div>
          </div>
          {usage.byCountry.length > 0 && <p className="text-sm text-muted-foreground">By country: {usage.byCountry.slice(0, 6).map((c) => `${c.country} ${rupees(c.paise)}`).join(" · ")}</p>}
        </CardBody>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader title="Add credit" description="You are taken to the payment page. Credit arrives a few seconds after the payment succeeds." />
          <CardBody>
            {available.length === 0 ? <p className="text-sm text-muted-foreground">No payment gateway is set up yet. Add the gateway&apos;s keys to the website&apos;s settings file (RAZORPAY_*, STRIPE_*, PAYPAL_*, PAYSTACK_*, FLUTTERWAVE_*, CRYPTOMUS_*).</p> : (
              <form onSubmit={topUp} className="grid gap-3 sm:grid-cols-4">
                <Field label="Pay with"><Select value={gateway} onChange={(e) => pickGateway(e.target.value as Gateway)}>{available.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
                <Field label="Currency"><Select value={currency} onChange={(e) => setCurrency(e.target.value)}>{g.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
                <Field label={`Amount (${currency})`} hint={credit === null ? `No exchange rate for ${currency} yet. Ask platform staff.` : `You will be credited ${rupees(credit)}${currency === "INR" ? " (Rs 100 to Rs 1,00,000)" : ""}`}><Input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
                <div className="flex items-end"><Button type="submit" disabled={busy || credit === null || credit < 10_000 || credit > 10_000_000}>{busy ? "Opening…" : "Pay"}</Button></div>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Prices by country" description="Your price to customers for calls and texts to a country (paise: 100 paise = Rs 1). A country without a price uses the standard price. Countries come from the dialling code." />
        <CardBody className="grid gap-4">
          {rates.length > 0 && (
            <Table><thead><tr><Th>Country</Th><Th>Call, per minute</Th><Th>Text, each</Th><Th> </Th></tr></thead>
              <tbody>{rates.map((r) => <Tr key={r.country}><Td className="font-medium">{r.country}</Td><Td>{rupees(r.callPerMinPaise)}</Td><Td>{rupees(r.smsPaise)}</Td><Td className="text-end">{canEdit && <Button size="sm" variant="outline" onClick={() => void removeRate(r.country)}>Remove</Button>}</Td></Tr>)}</tbody></Table>
          )}
          {canEdit && (
            <>
              <form onSubmit={saveRate} className="grid gap-3 sm:grid-cols-4">
                <Field label="Country" hint="2 letters, e.g. US"><Input value={rate.country} onChange={(e) => setRate((r) => ({ ...r, country: e.target.value.toUpperCase() }))} maxLength={2} required /></Field>
                <Field label="Call per minute (paise)"><Input type="number" min={0} max={100000} value={rate.call} onChange={(e) => setRate((r) => ({ ...r, call: Math.round(Number(e.target.value)) }))} /></Field>
                <Field label="Text each (paise)"><Input type="number" min={0} max={100000} value={rate.sms} onChange={(e) => setRate((r) => ({ ...r, sms: Math.round(Number(e.target.value)) }))} /></Field>
                <div className="flex items-end"><Button type="submit" disabled={rate.country.length !== 2}>Save price</Button></div>
              </form>
              <div className="grid gap-2">
                <Field label="Import many at once" hint="A CSV with a first row of column names: country, call_per_min_paise, sms_paise. Existing countries are updated."><Textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"country,call_per_min_paise,sms_paise\nIN,150,25\nUS,400,90"} /></Field>
                <input type="file" accept=".csv,.txt" aria-label="Price list file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
                <div><Button type="button" variant="outline" disabled={!csv.trim()} onClick={() => void importRates()}>Import prices</Button></div>
                {imported && <div role="status" className="text-sm"><p>Saved {imported.saved} {imported.saved === 1 ? "country" : "countries"}.</p>{imported.problems.length > 0 && <ul className="mt-1 list-disc ps-5 text-muted-foreground">{imported.problems.slice(0, 10).map((p) => <li key={p.row}>Row {p.row}: {p.reason}</li>)}</ul>}</div>}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {isPlatformAdmin && (
        <Card>
          <CardHeader title="Exchange rates (platform staff)" description="How many rupees one unit of a currency is worth. Used to credit payments made in that currency; fixed when a payment starts. Press the button for today's market rates (a rate that jumps more than 25 percent is skipped for you to check), or set one by hand." />
          <CardBody className="grid gap-4">
            {exchange.length > 0 && <ul className="grid gap-1 text-sm">{exchange.map((e) => <li key={e.currency} className="flex flex-wrap items-center gap-2">1 {e.currency} = {rupees(e.paisePerUnit)}<span className="text-xs text-muted-foreground">updated {formatDateTime(e.updatedAt)}</span>{stale(e.updatedAt) && <Badge tone="warning">Over a day old</Badge>}<button type="button" className="text-xs text-muted-foreground underline" onClick={() => void removeFx(e.currency)}>Remove</button></li>)}</ul>}
            <div><Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshFx()}>{refreshing ? "Fetching…" : "Update all from today's market rates"}</Button></div>
            <form onSubmit={saveFx} className="grid gap-3 sm:grid-cols-3">
              <Field label="Currency"><Input value={fx.currency} onChange={(e) => setFx((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} maxLength={3} required /></Field>
              <Field label="Rupees per 1 unit" hint="e.g. 83.20 for USD"><Input type="number" min={0.01} step="0.01" value={fx.rupees} onChange={(e) => setFx((x) => ({ ...x, rupees: Number(e.target.value) }))} /></Field>
              <div className="flex items-end"><Button type="submit" size="sm" disabled={fx.currency.length !== 3 || !(fx.rupees > 0)}>Save rate</Button></div>
            </form>
          </CardBody>
        </Card>
      )}

      {isPlatformAdmin && (
        <Card>
          <CardHeader title="Manual adjustment (platform staff)" description="Add or remove credit by hand, with a note. It is recorded in the audit log." />
          <CardBody>
            <form onSubmit={adjust} className="grid gap-3 sm:grid-cols-4">
              {balances && balances.length > 0 && <div className="sm:col-span-4"><Field label="Organisation"><Select value={adj.orgId} onChange={(e) => setAdj((a) => ({ ...a, orgId: e.target.value }))}><option value="">This organisation</option>{balances.map((o) => <option key={o.orgId} value={o.orgId}>{o.orgName} ({rupees(o.balancePaise)})</option>)}</Select></Field></div>}
              <Field label="Amount (Rs, negative removes)"><Input type="number" step="0.01" value={adj.rupees} onChange={(e) => setAdj((a) => ({ ...a, rupees: Number(e.target.value) }))} /></Field>
              <div className="sm:col-span-2"><Field label="Why"><Input value={adj.note} onChange={(e) => setAdj((a) => ({ ...a, note: e.target.value }))} maxLength={300} required /></Field></div>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={adj.refund} onChange={(e) => setAdj((a) => ({ ...a, refund: e.target.checked }))} /> It is a refund</label>
              <div><Button type="submit" size="sm" disabled={!adj.rupees || !adj.note.trim()}>Apply</Button></div>
            </form>
            {note && <p role="status" className="mt-3 text-sm text-success">{note}</p>}
          </CardBody>
        </Card>
      )}
      {isPlatformAdmin && balances && balances.length > 0 && (
        <Card>
          <CardHeader title="Customer balances (platform staff)" description="Every organisation's credit and what it added in the last 30 days. Choose one in the adjustment form above to correct or refund." />
          <Table><thead><tr><Th>Organisation</Th><Th>Balance</Th><Th>Added, 30 days</Th></tr></thead>
            <tbody>{balances.map((o) => <Tr key={o.orgId}><Td className="font-medium">{o.orgName}</Td><Td className={o.balancePaise <= 0 ? "text-danger" : ""}>{rupees(o.balancePaise)}</Td><Td>{rupees(o.topupsPaise)}</Td></Tr>)}</tbody></Table>
        </Card>
      )}

      {isPlatformAdmin && gatewayStatus && (
        <Card>
          <CardHeader title="Payment gateways: setup checklist (platform staff)" description="Which gateways have their keys, what is still missing (names only), and the address each gateway must send its payment notices to." />
          <CardBody className="grid gap-4">
            {gatewayStatus.map((g) => (
              <div key={g.id} className="grid gap-1 border-b border-border pb-3 text-sm last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{g.label}</span><Badge tone={g.configured ? "success" : "neutral"}>{g.configured ? "Keys set" : "Keys missing"}</Badge></div>
                <div className="text-muted-foreground">Notice address: <code className="break-all">{g.webhookUrl}</code> · {g.note}</div>
                {g.missing.length > 0 && <div className="text-muted-foreground">Still to set in the website's settings file: {g.missing.join(", ")}</div>}
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      {!isPlatformAdmin && note && <p role="status" className="text-sm text-success">{note}</p>}

      <Card>
        <CardHeader title="Recent payments" action={<a href="/api/billing/export?kind=payments" className="text-sm text-primary underline">Download CSV</a>} />
        {payments.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No payments yet.</p></CardBody> : (
          <Table><thead><tr><Th>When</Th><Th>Gateway</Th><Th>Paid</Th><Th>Credited</Th><Th>Status</Th><Th> </Th></tr></thead>
            <tbody>{payments.map((p) => <Tr key={p.id}><Td>{formatDateTime(p.createdAt)}</Td><Td>{titleCase(p.gateway)}</Td><Td>{p.currency === "INR" ? rupees(p.amountPaise) : `${((p.amountMinor ?? 0) / 100).toFixed(2)} ${p.currency}`}</Td><Td>{rupees(p.amountPaise)}</Td><Td><Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "warning"}>{titleCase(p.status)}</Badge></Td><Td className="text-end">{p.status === "paid" && <a href={`/billing/receipt/${p.id}`} className="text-sm text-primary underline">Receipt</a>}</Td></Tr>)}</tbody></Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Credit history" description="The latest 50 changes to the balance" action={<span className="flex gap-3 text-sm"><a href="/billing/history" className="text-primary underline">See all, filter</a><a href="/api/billing/export" className="text-primary underline">Download CSV</a></span>} />
        {ledger.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">Nothing yet.</p></CardBody> : (
          <Table><thead><tr><Th>When</Th><Th>What</Th><Th>Change</Th><Th>Note</Th></tr></thead>
            <tbody>{ledger.map((l) => <Tr key={l.id}><Td>{formatDateTime(l.createdAt)}</Td><Td>{REASON[l.reason] ?? l.reason}</Td><Td className={l.deltaPaise < 0 ? "text-danger" : "text-success"}>{l.deltaPaise > 0 ? "+" : ""}{rupees(l.deltaPaise)}</Td><Td className="text-muted-foreground">{l.note ?? ""}</Td></Tr>)}</tbody></Table>
        )}
      </Card>
    </div>
  );
}
