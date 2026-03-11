import fetcher from "@/lib/fetcher";
import { Repository } from "@pfe-monorepo/github-api";
import useSWR from "swr";
import type { AppError } from "@/lib/error";

type ReposData = {
  data: Repository[];
  page: number;
  totalPages: number;
};

export function useRepos(page: number = 1, limit: number = 10) {
  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("limit", limit.toString());

  const url = `/api/repos?${params.toString()}`;

  return useSWR<ReposData, AppError>(url, fetcher, {
    keepPreviousData: true,
  });
}
