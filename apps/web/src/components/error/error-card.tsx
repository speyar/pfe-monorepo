import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/error";

type ErrorCardProps = {
  error: AppError;
  title?: string;
  actionLabel?: string;
  actionHref?: string;
};

export default function ErrorCard({
  error,
  title = "Something went wrong",
  actionLabel = "Go back home",
  actionHref = "/",
}: ErrorCardProps) {
  return (
    <section className="mx-auto w-full max-w-4xl p-6">
      <Card className="border-destructive/25 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
            {title}
          </CardTitle>
          <CardDescription>
            We could not complete this GitHub installation flow.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2">
          <p className="text-sm">{error.message}</p>
          <p className="text-xs text-muted-foreground">
            Error code: {error.code}
          </p>
        </CardContent>

        <CardFooter>
          <Button render={<Link href={actionHref} />}>{actionLabel}</Button>
        </CardFooter>
      </Card>
    </section>
  );
}
