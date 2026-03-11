"use client";

import RepositoryCard from "./repository-card";
import { useReposFilters } from "@/hooks/use-repos-filters";
import { useRepos } from "@/data/repos/use-repos";
import Pagination from "../filters/pagination";
import ReposLoading from "./repos-loading";
import EmptyState from "@/components/shared/empty-state";
import ErrorCard from "@/components/error/error-card";
import { FolderGit2 } from "lucide-react";

export default function RepositoriesList() {
  const { page, limit, setPage } = useReposFilters();
  const { data, isLoading, error } = useRepos(page, limit);

  if (error) {
    return <ErrorCard title="Unable to load repositories" />;
  }

  if (!data || isLoading) {
    return (
      <section className="mx-auto w-full space-y-4 p-6">
        <ReposLoading />
      </section>
    );
  }

  if (!isLoading && data.data.length === 0) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No repositories yet"
        description="No repositories are linked to this installation yet."
      />
    );
  }

  return (
    <section className="mx-auto w-full  space-y-4 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.data.map((repository) => (
          <RepositoryCard key={repository.id} repository={repository} />
        ))}
      </div>
      <Pagination
        page={page}
        setPage={setPage}
        totalPages={data.totalPages || 1}
      />
    </section>
  );
}
