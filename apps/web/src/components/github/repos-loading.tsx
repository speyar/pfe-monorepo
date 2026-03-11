import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ReposLoadingProps = {
  count?: number;
};

export default function ReposLoading({ count = 6 }: ReposLoadingProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={`repo-skeleton-${index}`} className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 rounded-lg" />

              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>

            <div className="mt-4 flex justify-end border-t border-border/60 pt-4">
              <Skeleton className="h-7 w-32" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
