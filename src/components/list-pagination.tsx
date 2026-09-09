import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pagination locale réutilisable : découpe une liste déjà chargée/filtrée
 * en pages, avec choix du nombre d'éléments par page.
 */
export function usePagination<T>(items: T[], initialPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Revenir à la première page si les filtres réduisent la liste.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [items, page, pageSize],
  );

  return {
    page,
    setPage,
    pageSize,
    setPageSize: (n: number) => { setPageSize(n); setPage(1); },
    total,
    totalPages,
    pageItems,
    from: total === 0 ? 0 : (page - 1) * pageSize + 1,
    to: Math.min(page * pageSize, total),
    reset: () => setPage(1),
  };
}

export type PaginationState = ReturnType<typeof usePagination<any>>;

const SIZES = [10, 20, 50, 100];

export function ListPagination({
  state,
  label = "éléments",
  className = "",
}: {
  state: PaginationState;
  label?: string;
  className?: string;
}) {
  const { page, setPage, pageSize, setPageSize, total, totalPages, from, to } = state;
  if (total === 0) return null;

  const pages = pageNumbers(page, totalPages);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 pt-2 ${className}`}>
      <div className="text-xs text-muted-foreground">
        {from}–{to} sur {total} {label}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground hidden sm:block" htmlFor="page-size">
          Par page
        </label>
        <select
          id="page-size"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            aria-label="Page précédente"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                className="h-8 min-w-8 px-2 text-xs"
                aria-current={p === page ? "page" : undefined}
                onClick={() => setPage(p as number)}
              >
                {p}
              </Button>
            ),
          )}

          <Button
            variant="outline" size="icon" className="h-8 w-8"
            aria-label="Page suivante"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function pageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}
