"use client";

import type { SegmentFilter as Filter } from "@/lib/directory/queries";
import { cn } from "@/lib/utils";
import { useDirectoryNavigation } from "./directory-navigation";

const OPTIONS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "MAINBOARD", label: "Mainboard" },
  { value: "SME", label: "SME" },
];

/** Segmented radio group (native radios -> arrow-key accessible). */
export function SegmentFilter({ value }: { value: Filter }) {
  const { navigate } = useDirectoryNavigation();
  return (
    <fieldset className="flex rounded-md border border-line bg-bg p-0.5">
      <legend className="sr-only">Listing segment</legend>
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={cn(
            "relative cursor-pointer rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60",
            value === option.value ? "bg-panel text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          <input
            type="radio"
            name="segment"
            value={option.value}
            checked={value === option.value}
            onChange={() => navigate({ segment: option.value === "ALL" ? null : option.value, selected: null })}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
