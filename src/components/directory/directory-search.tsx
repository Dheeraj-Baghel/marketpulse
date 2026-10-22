"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useDirectoryNavigation } from "./directory-navigation";

const DEBOUNCE_MS = 250;
const MAX_LENGTH = 64; // mirrors MAX_QUERY_LENGTH on the server

/** Debounced search over symbol, company name and ISIN. "/" focuses the field. */
export function DirectorySearch({ initialQuery, disabled }: { initialQuery: string; disabled?: boolean }) {
  const { navigate, isPending } = useDirectoryNavigation();
  const [value, setValue] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  // Last query we pushed to the URL, and the last URL query we observed.
  const [committed, setCommitted] = useState(initialQuery);
  const [observedUrlQuery, setObservedUrlQuery] = useState(initialQuery);
  // Back/forward (or any external) URL change: adopt it (adjust state during render).
  if (initialQuery !== observedUrlQuery) {
    setObservedUrlQuery(initialQuery);
    if (initialQuery !== committed) {
      setCommitted(initialQuery);
      setValue(initialQuery);
    }
  }

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === committed) return;
    const timer = window.setTimeout(() => {
      setCommitted(trimmed);
      navigate({ q: trimmed || null, selected: null });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value, committed, navigate]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form role="search" className="relative w-full" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="directory-search" className="sr-only">
        Search NSE companies by name, symbol or ISIN
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
      <Input
        ref={inputRef}
        id="directory-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        placeholder={disabled ? "Import the NSE directory to search" : "Search name, symbol or ISIN"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            setValue("");
          }
        }}
        className="h-9 pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {isPending ? <LoaderCircle className="size-4 animate-spin text-accent" aria-label="Searching" /> : null}
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-line hover:text-fg focus-visible:outline-2"
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <kbd className="hidden rounded border border-line px-1.5 font-mono text-[10px] text-fg-muted sm:inline-block" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
    </form>
  );
}
