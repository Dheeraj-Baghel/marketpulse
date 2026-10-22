"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import type { DirectoryRow } from "@/lib/directory/queries";
import { SEGMENT_SHORT, stockHref } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  rows: DirectoryRow[];
  selectedKey: string | null;
  onSelect: (row: DirectoryRow) => void;
  showIsin: boolean;
  query: string;
}

export function rowKey(row: Pick<DirectoryRow, "segment" | "symbol">): string {
  return `${row.segment}:${row.symbol}`;
}

/**
 * Compact directory table. Rows are selectable (click, Enter/Space) and
 * navigable with the arrow keys / Home / End; only the selected row is in the
 * tab order (roving tabindex). The company name is a real link to details.
 */
export function CompanyTable({ rows, selectedKey, onSelect, showIsin, query }: Props) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const activeIndex = Math.max(
    0,
    rows.findIndex((r) => rowKey(r) === selectedKey),
  );

  function focusRow(index: number) {
    const row = rows[index];
    if (!row) return;
    onSelect(row);
    bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr")[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    if (event.target !== event.currentTarget) return; // let the inner link handle its own keys
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(Math.min(rows.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case " ":
      case "Enter": {
        event.preventDefault();
        const row = rows[index];
        if (row) onSelect(row);
        break;
      }
    }
  }

  return (
    <table className="w-full table-fixed border-collapse text-[13px]" aria-label="NSE listed companies">
      <colgroup>
        <col className="w-[7.5rem] sm:w-[8.5rem]" />
        <col />
        <col className="hidden w-[6.25rem] sm:table-column" />
        {showIsin ? <col className="hidden w-[8.75rem] md:table-column" /> : null}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-panel">
        <tr className="border-b border-line text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
          <th scope="col" className="py-2 pl-4 pr-2 font-semibold">Symbol</th>
          <th scope="col" className="px-2 py-2 font-semibold">Company</th>
          <th scope="col" className="hidden px-2 py-2 font-semibold sm:table-cell">Segment</th>
          {showIsin ? <th scope="col" className="hidden py-2 pl-2 pr-4 font-semibold md:table-cell">ISIN</th> : null}
        </tr>
      </thead>
      <tbody ref={bodyRef}>
        {rows.map((row, index) => {
          const key = rowKey(row);
          const selected = key === selectedKey;
          return (
            <tr
              key={key}
              tabIndex={index === activeIndex ? 0 : -1}
              aria-selected={selected}
              data-symbol={row.symbol}
              onClick={() => onSelect(row)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "group h-10 cursor-pointer border-b border-line/60 outline-none transition-colors last:border-b-0 focus-visible:bg-line/40 focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)]",
                selected ? "bg-accent/[0.07] shadow-[inset_2px_0_0_var(--color-accent)]" : "hover:bg-line/30",
              )}
            >
              <td className="truncate py-0 pl-4 pr-2">
                <span className={cn("font-mono text-[12.5px] font-semibold tracking-tight", selected ? "text-accent" : "text-fg")}>
                  <Highlight text={row.symbol} query={query} />
                </span>
              </td>
              <td className="truncate px-2 py-0">
                <Link
                  href={stockHref(row.symbol)}
                  title={`Open ${row.name}`}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-sm text-fg/90 underline-offset-[3px] hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-1"
                >
                  <Highlight text={row.name} query={query} />
                </Link>
                <span className="ml-2 text-[11px] text-fg-muted sm:hidden">{SEGMENT_SHORT[row.segment]}</span>
              </td>
              <td className="hidden px-2 py-0 sm:table-cell">
                <Badge variant={row.segment === "SME" ? "sme" : "default"}>{SEGMENT_SHORT[row.segment]}</Badge>
              </td>
              {showIsin ? (
                <td className="hidden truncate py-0 pl-2 pr-4 font-mono text-[11.5px] text-fg-muted md:table-cell">
                  <Highlight text={row.isin} query={query} />
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Highlights the first case-insensitive occurrence of the query. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-accent/20 text-inherit">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}
