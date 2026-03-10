import { Repository } from "@pfe-monorepo/github-api";
import RepositoryCard from "./repository-card";

type RepositoriesListProps = {
  repositories: Repository[];
};

export default function RepositoriesList({
  repositories,
}: RepositoriesListProps) {
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">GitHub Connected</h1>
        <p className="text-sm text-muted-foreground">
          Found {repositories.length} accessible repositories
        </p>
      </div>

      {repositories.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          No repositories available for this installation.
        </div>
      ) : (
        <div className="grid gap-3">
          {repositories.map((repository) => (
            <RepositoryCard key={repository.id} repository={repository} />
          ))}
        </div>
      )}
    </section>
  );
}
