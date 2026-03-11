"use client";

import { useEffect } from "react";
import { useQueryState, parseAsInteger } from "nuqs";
import { useReposFiltersStore } from "@/store/repos-store";

export function useReposFilters() {
  const { page, limit, setPage, setLimit, resetFilters } =
    useReposFiltersStore();

  const [pageQuery] = useQueryState("page", parseAsInteger.withDefault(1));
  const [limitQuery] = useQueryState("limit", parseAsInteger.withDefault(5));

  // Sync URL query to Zustand store
  useEffect(() => {
    setPage(pageQuery);
  }, [pageQuery, setPage]);

  useEffect(() => {
    setLimit(limitQuery);
  }, [limitQuery, setLimit]);

  return { page, limit, setPage, setLimit, resetFilters };
}
