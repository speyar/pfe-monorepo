"use client";

import { useRepos } from "@/data/repos/use-repos";
import { useReposFilters } from "@/hooks/use-repos-filters";

export default function RepositoriesPage() {
  const { page, limit } = useReposFilters();
  const { data } = useRepos(page, limit);

  console.log("Repos data:", data);
  return (
    <div className="max-w-4xl mx-auto mt-16">
      <h1 className="text-3xl font-bold mb-8">Your Connected Repositories</h1>
      <p className="text-gray-600 mb-4">
        View and manage the repositories you've connected to AI code review.
      </p>
    </div>
  );
}
