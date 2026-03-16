import prisma from "@/lib/db";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  getGitHubClient,
  getPullRequest,
  listPullRequestFiles,
  upsertPullRequestComment,
} from "@pfe-monorepo/github-api";
import {
  createGitHubReviewModel,
  runReview,
  type ReviewResult,
} from "@pfe-monorepo/review-agent";

export const runtime = "nodejs";

type GitHubAccount = {
  login?: string;
};

type GitHubInstallation = {
  id?: number;
  account?: GitHubAccount;
};

type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
};

type InstallationRepositoriesPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repositories_added?: GitHubRepository[];
  repositories_removed?: GitHubRepository[];
  sender?: {
    login?: string;
  };
};

type InstallationPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repositories?: GitHubRepository[];
  sender?: {
    login?: string;
  };
};

type PullRequestPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repository?: {
    id?: number;
    name?: string;
    full_name?: string;
    default_branch?: string;
    owner?: {
      login?: string;
    };
    private?: boolean;
    html_url?: string;
  };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    html_url?: string;
    state?: string;
    merged?: boolean;
    draft?: boolean;
    user?: {
      login?: string;
    };
    head?: {
      sha?: string;
      ref?: string;
    };
    base?: {
      sha?: string;
      ref?: string;
    };
  };
  sender?: {
    login?: string;
  };
};

const REVIEW_COMMENT_MARKER = "<!-- pfe-review-agent -->";

const getInstallationId = (
  installation?: GitHubInstallation,
): number | null => {
  const value = installation?.id;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

const getOwnerRepo = (
  repository?: PullRequestPayload["repository"],
): { owner: string; repo: string } | null => {
  const owner = repository?.owner?.login?.trim();
  const repo = repository?.name?.trim();

  if (owner && repo) {
    return { owner, repo };
  }

  const fullName = repository?.full_name?.trim();
  if (!fullName) {
    return null;
  }

  const [fullNameOwner, fullNameRepo] = fullName.split("/");
  if (!fullNameOwner || !fullNameRepo) {
    return null;
  }

  return {
    owner: fullNameOwner,
    repo: fullNameRepo,
  };
};

const toMarkdownReview = (review: ReviewResult): string => {
  const findingLines = review.findings.map((finding, index) => {
    const location = finding.line
      ? ` (${finding.file}:${finding.line})`
      : ` (${finding.file})`;
    const suggestion = finding.suggestion
      ? `\nSuggestion: ${finding.suggestion}`
      : "";

    return `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}${location}\n${finding.message}${suggestion}`;
  });

  return [
    REVIEW_COMMENT_MARKER,
    "## Automated PR Review",
    `Verdict: **${review.summary.verdict}**`,
    `Score: **${review.summary.score}/100**`,
    `Risk: ${review.summary.risk}`,
    "",
    review.summary.overview,
    "",
    review.findings.length > 0
      ? "### Findings\n" + findingLines.join("\n\n")
      : "### Findings\nNo blocking findings detected.",
    review.notes?.length ? `\n### Notes\n${review.notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const parseSignature = (value: string) => {
  const parts = value.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return null;
  }

  return parts[1];
};

const isValidSignature = (
  payload: string,
  secret: string,
  signatureHeader: string,
): boolean => {
  const signature = parseSignature(signatureHeader);
  if (!signature) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
};

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "Missing GITHUB_WEBHOOK_SECRET" },
      { status: 500 },
    );
  }

  const eventName = req.headers.get("x-github-event");
  const deliveryId = req.headers.get("x-github-delivery");
  const signature = req.headers.get("x-hub-signature-256");

  if (!eventName || !deliveryId || !signature) {
    return Response.json(
      { ok: false, error: "Missing GitHub webhook headers" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  if (!isValidSignature(rawBody, secret, signature)) {
    return Response.json(
      { ok: false, error: "Invalid GitHub webhook signature" },
      { status: 401 },
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  try {
    switch (eventName) {
      case "installation_repositories": {
        const body = payload as InstallationRepositoriesPayload;
        const added = body.repositories_added ?? [];
        const removed = body.repositories_removed ?? [];
        const installationId = getInstallationId(body.installation);

        if (!installationId) {
          return Response.json(
            { ok: false, error: "Webhook payload missing installation id" },
            { status: 400 },
          );
        }

        const installation = await prisma.githubInstallation.findUnique({
          where: { installationId },
          select: { id: true },
        });

        if (!installation) {
          console.warn("[github-webhook] installation_repositories ignored", {
            deliveryId,
            installationId,
            reason: "installation_not_linked_in_db",
          });

          return Response.json({ ok: true, ignored: true }, { status: 200 });
        }

        await prisma.$transaction(async (tx) => {
          const accountLogin = body.installation?.account?.login;
          if (accountLogin) {
            await tx.githubInstallation.update({
              where: { installationId },
              data: { accountLogin },
            });
          }

          if (added.length > 0) {
            await tx.repository.createMany({
              data: added.map((repo) => ({
                repoId: repo.id,
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                installationId,
              })),
              skipDuplicates: true,
            });
          }

          if (removed.length > 0) {
            await tx.repository.deleteMany({
              where: {
                installationId,
                repoId: {
                  in: removed.map((repo) => repo.id),
                },
              },
            });
          }
        });

        console.info("[github-webhook] installation_repositories", {
          deliveryId,
          action: body.action,
          installationId,
          accountLogin: body.installation?.account?.login,
          addedCount: added.length,
          removedCount: removed.length,
          added: added.map((repo) => repo.full_name),
          removed: removed.map((repo) => repo.full_name),
          db: "repositories_synced",
          sender: body.sender?.login,
        });

        break;
      }

      case "installation": {
        const body = payload as InstallationPayload;
        const installationId = getInstallationId(body.installation);

        if (!installationId) {
          return Response.json(
            { ok: false, error: "Webhook payload missing installation id" },
            { status: 400 },
          );
        }

        const repositories = body.repositories ?? [];
        let dbStatus = "ignored";

        if (body.action === "deleted") {
          await prisma.$transaction([
            prisma.repository.deleteMany({
              where: {
                installationId,
              },
            }),
            prisma.githubInstallation.deleteMany({
              where: {
                installationId,
              },
            }),
          ]);

          dbStatus = "installation_deleted";
        } else {
          const installation = await prisma.githubInstallation.findUnique({
            where: { installationId },
            select: { id: true },
          });

          if (!installation) {
            dbStatus = "ignored_installation_not_linked";
            console.warn("[github-webhook] installation ignored", {
              deliveryId,
              installationId,
              action: body.action,
              reason: "installation_not_linked_in_db",
            });
          } else {
            await prisma.$transaction(async (tx) => {
              const accountLogin = body.installation?.account?.login;

              if (accountLogin) {
                await tx.githubInstallation.update({
                  where: { installationId },
                  data: { accountLogin },
                });
              }

              if (repositories.length > 0) {
                await tx.repository.createMany({
                  data: repositories.map((repo) => ({
                    repoId: repo.id,
                    name: repo.name,
                    fullName: repo.full_name,
                    private: repo.private,
                    installationId,
                  })),
                  skipDuplicates: true,
                });
              }
            });

            dbStatus = "installation_synced";
          }
        }

        console.info("[github-webhook] installation", {
          deliveryId,
          action: body.action,
          installationId,
          accountLogin: body.installation?.account?.login,
          repositoriesCount: repositories.length,
          db: dbStatus,
          sender: body.sender?.login,
        });

        break;
      }

      case "pull_request": {
        const body = payload as PullRequestPayload;

        if (body.action !== "opened" && body.action !== "synchronize") {
          break;
        }

        const installationId = getInstallationId(body.installation);
        const ownerRepo = getOwnerRepo(body.repository);
        const pullRequestNumber = body.pull_request?.number;

        if (
          !installationId ||
          !ownerRepo ||
          typeof pullRequestNumber !== "number" ||
          !Number.isInteger(pullRequestNumber)
        ) {
          console.warn("[github-webhook] pull_request ignored", {
            deliveryId,
            action: body.action,
            installationId,
            owner: ownerRepo?.owner,
            repo: ownerRepo?.repo,
            pullRequestNumber,
            reason: "missing_or_invalid_review_payload",
          });
          break;
        }

        const githubInstallation = await prisma.githubInstallation.findUnique({
          where: { installationId },
          select: {
            id: true,
            user: {
              select: {
                clerkUserId: true,
              },
            },
          },
        });

        if (!githubInstallation) {
          console.warn("[github-webhook] pull_request ignored", {
            deliveryId,
            action: body.action,
            installationId,
            owner: ownerRepo.owner,
            repo: ownerRepo.repo,
            pullRequestNumber,
            reason: "installation_not_linked_in_db",
          });
          break;
        }

        const [pullRequest, files] = await Promise.all([
          getPullRequest(installationId, {
            owner: ownerRepo.owner,
            repo: ownerRepo.repo,
            pullRequestNumber,
          }),
          listPullRequestFiles(installationId, {
            owner: ownerRepo.owner,
            repo: ownerRepo.repo,
            pullRequestNumber,
          }),
        ]);

        const filesForReview = files
          .filter(
            (file) => typeof file.patch === "string" && file.patch.length > 0,
          )
          .map((file) => ({
            path: file.filename,
            status: file.status,
            patch: file.patch ?? undefined,
          }));

        if (filesForReview.length === 0) {
          console.warn("[github-webhook] pull_request review skipped", {
            deliveryId,
            action: body.action,
            installationId,
            owner: ownerRepo.owner,
            repo: ownerRepo.repo,
            pullRequestNumber,
            reason: "no_patch_files_available",
          });
          break;
        }

        const review = await runReview(
          {
            repository: {
              owner: ownerRepo.owner,
              name: ownerRepo.repo,
              defaultBranch: body.repository?.default_branch,
            },
            pullRequest: {
              number: pullRequest.number,
              title: pullRequest.title,
              body: body.pull_request?.body,
              baseSha: body.pull_request?.base?.sha ?? "unknown-base-sha",
              headSha: body.pull_request?.head?.sha ?? "unknown-head-sha",
              baseRef: body.pull_request?.base?.ref ?? pullRequest.baseRef,
              headRef: body.pull_request?.head?.ref ?? pullRequest.headRef,
            },
            files: filesForReview,
            metadata: {
              deliveryId,
              eventName,
              action: body.action,
              sender: body.sender?.login,
              pullRequestUrl: body.pull_request?.html_url,
            },
          },
          {
            model: createGitHubReviewModel(),
            useRepositoryTools: false,
          },
        );

        const reviewText = toMarkdownReview(review);
        const repositoryId = body.repository?.id;

        const repositoryRecord =
          typeof repositoryId === "number" && Number.isInteger(repositoryId)
            ? await prisma.repository.upsert({
                where: {
                  repoId: repositoryId,
                },
                create: {
                  repoId: repositoryId,
                  name: body.repository?.name?.trim() || ownerRepo.repo,
                  fullName:
                    body.repository?.full_name?.trim() ||
                    `${ownerRepo.owner}/${ownerRepo.repo}`,
                  private: body.repository?.private ?? true,
                  installationId,
                },
                update: {
                  name: body.repository?.name?.trim() || ownerRepo.repo,
                  fullName:
                    body.repository?.full_name?.trim() ||
                    `${ownerRepo.owner}/${ownerRepo.repo}`,
                  private: body.repository?.private ?? true,
                  installationId,
                },
                select: {
                  id: true,
                  repoId: true,
                },
              })
            : await prisma.repository.findFirst({
                where: {
                  fullName: `${ownerRepo.owner}/${ownerRepo.repo}`,
                  installationId,
                },
                select: {
                  id: true,
                  repoId: true,
                },
              });

        let reviewDbStatus = "skipped_repository_not_found";

        if (repositoryRecord) {
          const pullRequestUrl =
            body.pull_request?.html_url ?? pullRequest.htmlUrl;

          await prisma.review.upsert({
            where: {
              repositoryId_prNumber: {
                repositoryId: repositoryRecord.id,
                prNumber: pullRequest.number,
              },
            },
            create: {
              repositoryId: repositoryRecord.id,
              repoId: repositoryRecord.repoId,
              prNumber: pullRequest.number,
              prTitle: pullRequest.title,
              prUrl: pullRequestUrl,
              review: reviewText,
              reviewerClerkUserId: githubInstallation.user.clerkUserId,
            },
            update: {
              prTitle: pullRequest.title,
              prUrl: pullRequestUrl,
              review: reviewText,
              reviewerClerkUserId: githubInstallation.user.clerkUserId,
              status: "completed",
            },
          });

          reviewDbStatus = "saved";
        }

        await upsertPullRequestComment(installationId, {
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          pullRequestNumber,
          marker: REVIEW_COMMENT_MARKER,
          body: reviewText,
        });

        console.info("[github-webhook] pull_request review completed", {
          deliveryId,
          action: body.action,
          installationId,
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          pullRequestNumber,
          findingsCount: review.findings.length,
          verdict: review.summary.verdict,
          db: reviewDbStatus,
        });

        break;
      }

      default: {
        console.info("[github-webhook] event", {
          deliveryId,
          eventName,
        });
      }
    }
  } catch (error) {
    console.error("[github-webhook] handler error", {
      deliveryId,
      eventName,
      error,
    });

    return Response.json(
      { ok: false, error: "Webhook handler error" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true }, { status: 200 });
}
