/** Official Bizfy logo mark on a blue tile; the product name beside it is plain text. */
export function BizfyMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl bg-primary ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/bizfy-mark.png" alt="" className="h-[58%] w-[58%] object-contain" />
    </span>
  );
}
