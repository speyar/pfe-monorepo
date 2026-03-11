import ConnectGithubButton from "@/components/github/connect-github-button";
import RepositoriesList from "@/components/github/repositories-list";

export default function RepositoriesPage() {
  return (
    <div className="container mx-auto mt-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-4">
            Your Connected Repositories
          </h1>
          <p className="text-muted-foreground mb-4">
            View and manage the repositories you've connected to AI code review.
          </p>
        </div>
        <ConnectGithubButton />
      </div>
      <RepositoriesList />
    </div>
  );
}
