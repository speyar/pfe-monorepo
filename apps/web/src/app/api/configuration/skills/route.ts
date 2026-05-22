import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'User not authenticated', code: 'UNAUTHENTICATED' }, { status: 401 })
    }

    const skills = await prisma.skill.findMany({
      where: { userId: clerkUserId },
      orderBy: { createdAt: 'desc' },
    })

    return Response.json({ data: skills })
  } catch (error) {
    const appError = toAppError(error, { message: 'Failed to fetch skills', code: 'DATABASE_ERROR', statusCode: 500 })
    return Response.json({ error: appError.message, code: appError.code }, { status: appError.statusCode })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'User not authenticated', code: 'UNAUTHENTICATED' }, { status: 401 })
    }

    const body = await request.json()
    const { name, useCase, description, content, targetAgents } = body

    if (!name || !useCase || !description || !content || !targetAgents?.length) {
      return Response.json({ error: 'Missing required fields: name, useCase, description, content, targetAgents', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    if (!Array.isArray(targetAgents) || !targetAgents.every((a: string) => ['mechanic', 'review'].includes(a))) {
      return Response.json({ error: 'targetAgents must be an array containing "mechanic" and/or "review"', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const existing = await prisma.skill.findUnique({
      where: { userId_name: { userId: clerkUserId, name } },
    })
    if (existing) {
      return Response.json({ error: 'A skill with this name already exists', code: 'CONFLICT' }, { status: 409 })
    }

    const skill = await prisma.skill.create({
      data: { name, useCase, description, content, targetAgents, userId: clerkUserId },
    })

    return Response.json({ data: skill }, { status: 201 })
  } catch (error) {
    const appError = toAppError(error, { message: 'Failed to create skill', code: 'DATABASE_ERROR', statusCode: 500 })
    return Response.json({ error: appError.message, code: appError.code }, { status: appError.statusCode })
  }
}
