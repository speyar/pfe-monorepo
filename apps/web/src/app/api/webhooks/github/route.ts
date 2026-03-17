import type { NextRequest } from "next/server";
import { isValidSignature } from "./helpers";
import { handleGitHubWebhookEvent } from "./handlers";

export const runtime = "nodejs";

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
    const handlerResponse = await handleGitHubWebhookEvent({
      eventName,
      payload,
      deliveryId,
    });

    if (handlerResponse) {
      return handlerResponse;
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
