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
  error?: AppError;
  title?: string;
  description?: string;
};

export default function ErrorCard({
  error,
  title = "Something went wrong",
  description = "We encountered an error while processing your request.",
}: ErrorCardProps) {
  return (
    <section className="mx-auto w-full max-w-4xl p-6">
      <Card className="border-destructive/25 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-2">
          <p className="text-sm">{error?.message}</p>
        </CardContent>
      </Card>
    </section>
  );
}
