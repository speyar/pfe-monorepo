import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import prisma from "@/lib/db";

type ClerkEmailAddress = {
  id: string;
  email_address: string;
};

type ClerkPhoneNumber = {
  id: string;
  phone_number: string;
};

type ClerkUserPayload = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  phone_numbers?: ClerkPhoneNumber[];
  primary_phone_number_id?: string | null;
};

function normalizeName(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function getPrimaryEmail(data: {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
}): string {
  if (data.email_addresses && data.email_addresses.length > 0) {
    if (data.primary_email_address_id) {
      const primary = data.email_addresses.find(
        (email) => email.id === data.primary_email_address_id,
      );
      if (primary?.email_address) {
        return primary.email_address;
      }
    }

    const firstEmail = data.email_addresses[0]?.email_address;
    if (firstEmail) {
      return firstEmail;
    }
  }

  return `${data.id}@clerk.local`;
}

function getPrimaryPhone(data: {
  phone_numbers?: ClerkPhoneNumber[];
  primary_phone_number_id?: string | null;
}): string | null {
  if (!data.phone_numbers || data.phone_numbers.length === 0) {
    return null;
  }

  if (data.primary_phone_number_id) {
    const primary = data.phone_numbers.find(
      (phone) => phone.id === data.primary_phone_number_id,
    );
    if (primary) {
      return primary.phone_number;
    }
  }

  return data.phone_numbers[0]?.phone_number ?? null;
}

export async function POST(req: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    return Response.json(
      { ok: false, error: "Missing CLERK_WEBHOOK_SIGNING_SECRET" },
      { status: 500 },
    );
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;

  try {
    event = await verifyWebhook(req);
  } catch (error) {
    console.error("[clerk-webhook] verification failed", error);
    return Response.json(
      { ok: false, error: "Invalid webhook signature" },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const data = event.data as ClerkUserPayload;
        const firstName = normalizeName(data.first_name);
        const lastName = normalizeName(data.last_name);
        const email = getPrimaryEmail(data);
        const phoneNumber = getPrimaryPhone(data);
        const now = new Date();

        await prisma.user.upsert({
          where: {
            clerkUserId: data.id,
          },
          create: {
            clerkUserId: data.id,
            firstName,
            lastName,
            email,
            phoneNumber,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            firstName,
            lastName,
            email,
            phoneNumber,
            updatedAt: now,
          },
        });

        return Response.json({ ok: true }, { status: 200 });
      }

      case "user.deleted": {
        const deletedClerkUserId = event.data.id;

        if (!deletedClerkUserId) {
          return Response.json(
            { ok: false, error: "Webhook payload missing user id" },
            { status: 400 },
          );
        }

        const user = await prisma.user.findUnique({
          where: { clerkUserId: deletedClerkUserId },
          select: { id: true },
        });

        if (!user) {
          return Response.json({ ok: true, ignored: true }, { status: 200 });
        }

        await prisma.$transaction(async (tx) => {
          await tx.repository.deleteMany({
            where: {
              installation: {
                clerkUserId: user.id,
              },
            },
          });

          await tx.githubInstallation.deleteMany({
            where: {
              clerkUserId: user.id,
            },
          });

          await tx.user.delete({
            where: {
              clerkUserId: deletedClerkUserId,
            },
          });
        });

        return Response.json({ ok: true }, { status: 200 });
      }

      default:
        return Response.json({ ok: true, ignored: true }, { status: 200 });
    }
  } catch (error) {
    console.error("[clerk-webhook] handler failed", {
      type: event.type,
      error,
    });
    return Response.json(
      { ok: false, error: "Webhook handler error" },
      { status: 500 },
    );
  }
}
