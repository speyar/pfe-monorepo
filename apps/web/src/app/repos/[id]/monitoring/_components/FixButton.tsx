"use client";

import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";
import { useState } from "react";

interface FixButtonProps {
  issue: {
    id: string;
    title: string;
    level: string;
    status: string;
    count: string;
    userCount: number;
    culprit: string;
    permalink: string;
    firstSeen: string;
    lastSeen: string;
  };
  repoId: string;
}

type FixState =
  | { status: "idle" }
  | { status: "fixing" }
  | { status: "success"; prUrl?: string }
  | { status: "error"; message: string };

export function FixButton({ issue, repoId }: FixButtonProps) {
  const [fixState, setFixState] = useState<FixState>({ status: "idle" });

  async function handleFix() {
    setFixState({ status: "fixing" });

    try {
      const response = await fetch(
        `/api/repos/${repoId}/monitoring/issues/${issue.id}/fix`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issue }),
        },
      );

      const result = (await response.json()) as {
        success: boolean;
        prUrl?: string;
        error?: string;
      };

      if (result.success && result.prUrl) {
        setFixState({ status: "success", prUrl: result.prUrl });
      } else if (result.success) {
        setFixState({
          status: "success",
        });
        setTimeout(() => setFixState({ status: "idle" }), 5000);
      } else {
        setFixState({
          status: "error",
          message: result.error ?? "Unknown error",
        });
      }
    } catch {
      setFixState({
        status: "error",
        message: "Failed to start fix. Please try again.",
      });
    }
  }

  function handleOpenPr() {
    if (fixState.status === "success" && fixState.prUrl) {
      window.open(fixState.prUrl, "_blank", "noreferrer noopener");
    }
    setFixState({ status: "idle" });
  }

  if (fixState.status === "success" && fixState.prUrl) {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleOpenPr}>
          <Wrench className="size-3.5 mr-1" />
          View PR
        </Button>
      </div>
    );
  }

  if (fixState.status === "success") {
    return (
      <span className="text-xs text-green-600">
        Fix applied (pushed to branch)
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleFix}
        disabled={fixState.status === "fixing"}
      >
        <Wrench
          className={`size-3.5 mr-1 ${fixState.status === "fixing" ? "animate-spin" : ""}`}
        />
        {fixState.status === "fixing" ? "Fixing..." : "Fix"}
      </Button>
      {fixState.status === "error" ? (
        <span className="text-xs text-red-500 max-w-48 text-right">
          {fixState.message}
        </span>
      ) : null}
    </div>
  );
}
