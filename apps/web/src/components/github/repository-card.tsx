import { Repository } from "@pfe-monorepo/github-api";
import { SquareArrowOutUpRight, Globe, Lock, Activity } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type RepositoryCardProps = {
  repository: Repository;
};

export default function RepositoryCard({ repository }: RepositoryCardProps) {
  const repo = repository;

  return (
    <Card className="group transition-all hover:border-primary/30 hover:shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                repo.private ? "bg-red-500/10 " : "bg-emerald-500/10 ",
              )}
            >
              {repo.private ? (
                <Lock className="size-4 text-red-500 " />
              ) : (
                <Globe className="size-4 text-emerald-600 " />
              )}
            </div>

            <div className="min-w-0">
              <span className="block truncate font-medium transition-colors group-hover:text-primary">
                {repo.full_name}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="h-5 px-1.5 py-0 text-xs">
                  {repo.private ? "Private" : "Public"}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-between border-t border-border/60 pt-4">
          <Link href={`/repos/${repo.id}/monitoring`}>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              Monitoring
              <Activity className="size-3" />
            </Button>
          </Link>

          <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-7 gap-1.5 text-xs"
            >
              Visit repository
              <SquareArrowOutUpRight className="size-3" />
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
