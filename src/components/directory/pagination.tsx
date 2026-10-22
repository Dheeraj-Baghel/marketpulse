"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDirectoryNavigation } from "./directory-navigation";

/**
 * Server-side pagination. Controls are real links (work without JS, open in
 * new tab); disabled ends render as inert spans rather than dead buttons.
 */
export function Pagination({ page, pageCount, total, pageSize }: { page: number; pageCount: number; total: number; pageSize: number }) {
  const { hrefFor } = useDirectoryNavigation();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const items: { label: string; target: number; icon: typeof ChevronLeft; enabled: boolean; className?: string }[] = [
    { label: "First page", target: 1, icon: ChevronsLeft, enabled: page > 1, className: "hidden sm:inline-flex" },
    { label: "Previous page", target: page - 1, icon: ChevronLeft, enabled: page > 1 },
    { label: "Next page", target: page + 1, icon: ChevronRight, enabled: page < pageCount },
    { label: "Last page", target: pageCount, icon: ChevronsRight, enabled: page < pageCount, className: "hidden sm:inline-flex" },
  ];

  return (
    <nav aria-label="Directory pages" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-fg-muted">
      <p className="tabular" aria-live="polite">
        <span className="text-fg">{formatInt(from)}–{formatInt(to)}</span> of {formatInt(total)}
        <span className="hidden sm:inline"> · page {formatInt(page)} of {formatInt(pageCount)}</span>
      </p>
      <div className="flex items-center gap-1">
        {items.map(({ label, target, icon: Icon, enabled, className }) =>
          enabled ? (
            <Link
              key={label}
              href={hrefFor({ page: String(target), selected: null })}
              scroll={false}
              replace
              aria-label={label}
              title={label}
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), className)}
            >
              <Icon aria-hidden="true" />
            </Link>
          ) : (
            <span
              key={label}
              aria-hidden="true"
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), "pointer-events-none opacity-30", className)}
            >
              <Icon />
            </span>
          ),
        )}
      </div>
    </nav>
  );
}
