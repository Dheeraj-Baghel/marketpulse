import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Input, re-themed.
export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg placeholder:text-fg-muted/70 transition-colors focus-visible:border-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
