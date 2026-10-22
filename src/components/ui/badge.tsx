import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Badge, re-themed. Purely presentational (never interactive).
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10.5px] font-medium uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "border-line bg-bg/60 text-fg-muted",
        accent: "border-accent/30 bg-accent/10 text-accent",
        warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
        sme: "border-sky-400/25 bg-sky-400/10 text-sky-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
