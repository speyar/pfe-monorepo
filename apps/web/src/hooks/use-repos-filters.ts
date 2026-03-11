"use client";

import { useCallback, useEffect } from "react";
import { useQueryState, parseAsInteger } from "nuqs";
import { useReposFiltersStore } from "@/store/repos-store";

export function useReposFilters() {
  const {
    page,
    limit,
    setPage: setPageInStore,
    setLimit: setLimitInStore,
    resetFilters: resetFiltersInStore,
  } = useReposFiltersStore();

  const [pageQuery, setPageQuery] = useQueryState(
    "page",
    parseAsInteger.withDefault(1),
  );
  const [limitQuery, setLimitQuery] = useQueryState(
    "limit",
    parseAsInteger.withDefault(10),
  );

  // Sync URL query to Zustand store
  useEffect(() => {
    if (pageQuery !== page) {
      setPageInStore(pageQuery);
    }
  }, [pageQuery, page, setPageInStore]);

  useEffect(() => {
    if (limitQuery !== limit) {
      setLimitInStore(limitQuery);
    }
  }, [limitQuery, limit, setLimitInStore]);

  const setPage = useCallback(
    (nextPage: React.SetStateAction<number>) => {
      const resolvedPage =
        typeof nextPage === "function" ? nextPage(page) : nextPage;

      setPageInStore(resolvedPage);
      void setPageQuery(resolvedPage);
    },
    [page, setPageInStore, setPageQuery],
  );

  const setLimit = useCallback(
    (nextLimit: React.SetStateAction<number>) => {
      const resolvedLimit =
        typeof nextLimit === "function" ? nextLimit(limit) : nextLimit;

      setLimitInStore(resolvedLimit);
      void setLimitQuery(resolvedLimit);
    },
    [limit, setLimitInStore, setLimitQuery],
  );

  const resetFilters = useCallback(() => {
    resetFiltersInStore();
    void setPageQuery(1);
    void setLimitQuery(10);
  }, [resetFiltersInStore, setPageQuery, setLimitQuery]);

  return { page, limit, setPage, setLimit, resetFilters };
}
