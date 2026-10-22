"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useTransition, type ReactNode } from "react";

/**
 * The directory query lives in the URL (?q=&page=&segment=&selected=) so that
 * search results are server-rendered, shareable and survive reloads. This
 * provider lets the header search and the table share one pending state.
 */
interface DirectoryNavigation {
  isPending: boolean;
  /** Merge params into the URL. `null` removes a param. Resets page unless given. */
  navigate: (params: Record<string, string | null>, options?: { keepPage?: boolean }) => void;
  hrefFor: (params: Record<string, string | null>) => string;
}

const Ctx = createContext<DirectoryNavigation | null>(null);

export function DirectoryNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const hrefFor = useCallback(
    (params: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (next.get("page") === "1") next.delete("page");
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const navigate = useCallback<DirectoryNavigation["navigate"]>(
    (params, options) => {
      const merged = options?.keepPage || "page" in params ? params : { ...params, page: null };
      const href = hrefFor(merged);
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [hrefFor, router],
  );

  const value = useMemo(() => ({ isPending, navigate, hrefFor }), [isPending, navigate, hrefFor]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDirectoryNavigation(): DirectoryNavigation {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDirectoryNavigation must be used inside DirectoryNavigationProvider");
  return value;
}
