import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { T } from "../t";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-xl border border-border bg-card shadow-sm", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold"><T>{title}</T></h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground"><T>{description}</T></p>}
      </div>
      {action}
    </div>
  );
}

export const CardBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...props} />;
