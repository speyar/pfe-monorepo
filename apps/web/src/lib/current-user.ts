import prisma from "@/lib/db";
import { AppError } from "@/lib/error";
import { auth } from "@clerk/nextjs/server";

export async function requireCurrentUser() {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    throw new AppError({
      message: "User not authenticated",
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  }

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, clerkUserId: true },
  });

  if (!user) {
    throw new AppError({
      message: "User not found",
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }

  return user;
}
