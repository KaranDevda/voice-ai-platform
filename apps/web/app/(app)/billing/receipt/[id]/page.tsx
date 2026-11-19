import { notFound } from "next/navigation";
import { ForbiddenError } from "@voiceai/auth";
import { getReceipt } from "@voiceai/db";
import { BizfyMark } from "@/components/brand";
import { Forbidden } from "@/components/forbidden";
import { PrintButton } from "@/components/print-button";
import { requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

const rupees = (paise: number) => `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A printable receipt for one payment that went through (use the browser's Print, then Save as PDF). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) notFound();
  let r;
  try { r = await getReceipt(getDb(), user, id); } catch (err) { if (err instanceof ForbiddenError) return <Forbidden />; throw err; }
  if (!r) notFound();
  const paid = r.currency === "INR" ? rupees(r.creditedPaise) : `${r.currency} ${((r.amountMinor ?? 0) / 100).toFixed(2)}`;
  const dateLong = r.paidAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const rows: Array<[string, string]> = [
    ["Organisation", r.orgName],
    ...(r.payerEmail ? [["Paid by", r.payerEmail] as [string, string]] : []),
    ["Payment method", r.gateway.charAt(0).toUpperCase() + r.gateway.slice(1)],
    ...(r.gatewayPaymentId ? [["Gateway reference", r.gatewayPaymentId] as [string, string]] : []),
  ];
  return (
    <>
      {/* Margin 0 also removes the browser's own date, address and page-number lines; the receipt supplies its own padding. */}
      <style>{`@page { size: A4; margin: 0 } @media print { html, body { background: #fff !important; } }`}</style>
      <article className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-border bg-white text-slate-900 shadow-sm [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <div className="h-2 bg-primary" />
        <div className="p-8 print:px-[18mm] print:py-[16mm]">
          <header className="flex items-start justify-between gap-6">
            <div className="flex items-center gap-3">
              <BizfyMark className="h-11 w-11" />
              <div className="leading-tight">
                <div className="text-lg font-semibold tracking-tight">Bizfy Voice AI</div>
                <div className="text-xs text-slate-500">Calls · voices · agents</div>
              </div>
            </div>
            <div className="text-end">
              <div className="text-2xl font-semibold uppercase tracking-wide text-slate-800">Receipt</div>
              <div className="mt-1 text-sm font-medium">{r.number}</div>
              <div className="text-sm text-slate-500">{dateLong}</div>
            </div>
          </header>

          <div className="mt-8 flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">
            <span className="text-sm font-medium">Payment received</span>
            <span className="rounded-full border border-emerald-300 bg-white px-3 py-0.5 text-xs font-semibold uppercase tracking-wider">Paid</span>
          </div>

          <dl className="mt-8 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <table className="mt-10 w-full text-sm">
            <thead>
              <tr className="border-y border-slate-300 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 text-start font-medium">Description</th>
                <th className="px-3 py-2 text-end font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="px-3 py-4">
                  <div className="font-medium">Prepaid credit top-up</div>
                  <div className="text-xs text-slate-500">Added to your balance for AI calls and texts</div>
                </td>
                <td className="px-3 py-4 text-end font-medium">{paid}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td className="px-3 pt-4 text-end text-slate-500">Amount paid</td><td className="px-3 pt-4 text-end font-semibold">{paid}</td></tr>
              <tr><td className="px-3 pt-2 text-end text-slate-500">Credit added to balance</td><td className="px-3 pt-2 text-end text-base font-semibold text-slate-900">{rupees(r.creditedPaise)}</td></tr>
            </tfoot>
          </table>

          <footer className="mt-12 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
            <p>This receipt confirms a payment for prepaid credit. It is not a tax invoice.</p>
            <p className="mt-1">Thank you for choosing Bizfy Voice AI.</p>
          </footer>
        </div>
      </article>
      <div className="mt-6 text-center print:hidden"><PrintButton /></div>
    </>
  );
}
