import prisma from "@/lib/db";
import { upsertPullRequestComment } from "@pfe-monorepo/github-api";
import { REVIEW_COMMENT_MARKER } from "../../webhooks/github/helpers";
import {
  runPullRequestReview,
  type PullRequestReviewResult,
} from "@pfe-monorepo/new-review-agent";
import { savePullRequestReview } from "../../webhooks/github/db";

const REVIEW_STATUS_MARKER = "<!-- pfe-review-agent-status -->";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("action") === "skip-big") {
    const bigJob = await prisma.reviewJob.findFirst({
      where: { status: "processing" },
      orderBy: { createdAt: "asc" },
    });
    if (bigJob) {
      await prisma.reviewJob.update({
        where: { id: bigJob.id },
        data: { status: "failed", error: "Skipped" },
      });
      return Response.json({ ok: true, skipped: bigJob.id });
    }
    return Response.json({ ok: true, message: "none to skip" });
  }

  const job = await prisma.reviewJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return Response.json({ ok: true, message: "No pending reviews" });
  }

  await prisma.reviewJob.update({
    where: { id: job.id },
    data: { status: "processing" },
  });
  console.log(
    `[process] Job ${job.id} PR #${job.prNumber} ${job.owner}/${job.repo}`,
  );

  try {
    const files = (job.filesJson as Array<{ path: string; patch: string }> | null) ?? [];

    const initialDiff =
      job.initialDiff ||
      files
        .map((f) =>
          [
            `diff --git a/${f.path} b/${f.path}`,
            `--- a/${f.path}`,
            `+++ b/${f.path}`,
            f.patch,
          ].join("\n"),
        )
        .join("\n\n");

    const review: PullRequestReviewResult = await runPullRequestReview(
      {
        installationId: job.installationId,
        owner: job.owner,
        repo: job.repo,
        headRef: job.headRef,
        baseRef: job.baseRef,
        initialDiff,
        files,
      },
      {},
    );

    const findings = review.findings;
    console.log(`[process] Review complete: ${findings.length} findings`);

    const reviewText = [
      "## Automated Review",
      "",
      `**${findings.length} finding${findings.length !== 1 ? "s" : ""}**`,
      "",
      ...findings.map((f, i) => {
        const loc = `${f.file}${f.line ? `:${f.line}` : ""}`;
        return [
          `### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`,
          `**Location:** ${loc}`,
          f.quote ? `\`\`\`\n${f.quote}\n\`\`\`` : "",
          f.message,
          f.suggestion ? `\n**Suggestion:** ${f.suggestion}` : "",
          "---",
        ]
          .filter(Boolean)
          .join("\n\n");
      }),
    ].join("\n\n");

    const findingsForDb = findings.map((f) => ({
      severity: f.severity,
      file: f.file ?? "unknown",
      line: f.line ?? null,
      quote: f.quote ?? null,
      title: f.title,
      message: f.message,
      suggestion: f.suggestion ?? null,
      postedToGitHub: false,
      skipReason: null,
    }));

    await savePullRequestReview({
      installationId: job.installationId,
      repository: {
        full_name: `${job.owner}/${job.repo}`,
        id: 0,
        name: job.repo,
        private: false,
      },
      ownerRepo: { owner: job.owner, repo: job.repo },
      pullRequestNumber: job.prNumber,
      pullRequestTitle: job.prTitle,
      pullRequestUrl: job.prUrl,
      prAuthor: job.prAuthor,
      prBody: job.prBody,
      headRef: job.headRef,
      baseRef: job.baseRef,
      prState: "open",
      prMerged: false,
      prDraft: false,
      reviewText,
      reviewerClerkUserId: job.clerkUserId,
      findings: findingsForDb,
    });

    await upsertPullRequestComment(job.installationId, {
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.prNumber,
      marker: REVIEW_COMMENT_MARKER,
      body: [
        REVIEW_STATUS_MARKER,
        "✅ Review completed.",
        "",
        reviewText,
      ].join("\n"),
    }).catch((e) =>
      console.log("[process] Failed to post comment:", e.message),
    );

    await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: "completed" },
    });
    console.log(`[process] Job ${job.id} done`);

    return Response.json({
      ok: true,
      jobId: job.id,
      findingsCount: findings.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[process] Job ${job.id} failed: ${msg}`);

    await upsertPullRequestComment(job.installationId, {
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.prNumber,
      marker: REVIEW_STATUS_MARKER,
      body: `${REVIEW_STATUS_MARKER}\n⚠️ Review failed: ${msg}`,
    }).catch(() => {});

    await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: "failed", error: msg },
    });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
