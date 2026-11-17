import { notFound } from "next/navigation";
import { ForbiddenError } from "@voiceai/auth";
import { getReceipt } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PrintButton } from "@/components/print-button";
import { requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

const rupees = (paise: number) => `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A printable receipt for one payment that went through (use the browser's Print, then Save as PDF). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let r;
  try { r = await getReceipt(getDb(), user, id); } catch (err) { if (err instanceof ForbiddenError) return <Forbidden />; throw err; }
  if (!r) notFound();
  const paid = r.currency === "INR" ? rupees(r.creditedPaise) : `${r.currency} ${((r.amountMinor ?? 0) / 100).toFixed(2)}`;
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 print:border-0 print:p-0">
      <div className="flex items-start justify-between">
        <div><h1 className="text-xl font-semibold">Payment receipt</h1><p className="text-sm text-muted-foreground">Bizfy Voice AI</p></div>
        <div className="text-end text-sm"><div className="font-medium">{r.number}</div><div className="text-muted-foreground">{r.paidAt.toISOString().slice(0, 10)}</div></div>
      </div>
      <dl className="mt-6 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Organisation</dt><dd>{r.orgName}</dd>
        {r.payerEmail && <><dt className="text-muted-foreground">Paid by</dt><dd>{r.payerEmail}</dd></>}
        <dt className="text-muted-foreground">Payment method</dt><dd className="capitalize">{r.gateway}</dd>
        {r.gatewayPaymentId && <><dt className="text-muted-foreground">Gateway reference</dt><dd className="break-all">{r.gatewayPaymentId}</dd></>}
        <dt className="text-muted-foreground">Amount paid</dt><dd className="font-medium">{paid}</dd>
        <dt className="text-muted-foreground">Credit added</dt><dd className="font-medium">{rupees(r.creditedPaise)}</dd>
      </dl>
      <p className="mt-6 text-xs text-muted-foreground">This receipt is for prepaid credit. It is not a tax invoice.</p>
      <div className="mt-6 print:hidden"><PrintButton /></div>
    </div>
  );
}
