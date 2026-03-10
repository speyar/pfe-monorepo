import prisma from "@/lib/db";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

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

const getInstallationId = (
  installation?: GitHubInstallation,
): number | null => {
  const value = installation?.id;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
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
  console.log("eventName", eventName);
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
        console.log("added repos", added);
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

          for (const repo of added) {
            await tx.repository.upsert({
              where: { repoId: repo.id },
              create: {
                repoId: repo.id,
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                installationId,
              },
              update: {
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                installationId,
              },
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

              for (const repo of repositories) {
                await tx.repository.upsert({
                  where: { repoId: repo.id },
                  create: {
                    repoId: repo.id,
                    name: repo.name,
                    fullName: repo.full_name,
                    private: repo.private,
                    installationId,
                  },
                  update: {
                    name: repo.name,
                    fullName: repo.full_name,
                    private: repo.private,
                    installationId,
                  },
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
