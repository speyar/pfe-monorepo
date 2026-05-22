import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'

async function getOwnedSkill(id: string, clerkUserId: string) {
  const skill = await prisma.skill.findUnique({ where: { id } })
  if (!skill) return null
  if (skill.userId !== clerkUserId) return null
  return skill
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'User not authenticated', code: 'UNAUTHENTICATED' }, { status: 401 })
    }

    const { id } = await params
    const skill = await getOwnedSkill(id, clerkUserId)
    if (!skill) {
      return Response.json({ error: 'Skill not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    return Response.json({ data: skill })
  } catch (error) {
    const appError = toAppError(error, { message: 'Failed to fetch skill', code: 'DATABASE_ERROR', statusCode: 500 })
    return Response.json({ error: appError.message, code: appError.code }, { status: appError.statusCode })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'User not authenticated', code: 'UNAUTHENTICATED' }, { status: 401 })
    }

    const { id } = await params
    const existing = await getOwnedSkill(id, clerkUserId)
    if (!existing) {
      return Response.json({ error: 'Skill not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const body = await request.json()
    const { name, useCase, description, content, targetAgents } = body

    if (name && name !== existing.name) {
      const duplicate = await prisma.skill.findUnique({
        where: { userId_name: { userId: clerkUserId, name } },
      })
      if (duplicate) {
        return Response.json({ error: 'A skill with this name already exists', code: 'CONFLICT' }, { status: 409 })
      }
    }

    if (targetAgents && (!Array.isArray(targetAgents) || !targetAgents.every((a: string) => ['mechanic', 'review'].includes(a)))) {
      return Response.json({ error: 'targetAgents must be an array containing "mechanic" and/or "review"', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const skill = await prisma.skill.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(useCase !== undefined && { useCase }),
        ...(description !== undefined && { description }),
        ...(content !== undefined && { content }),
        ...(targetAgents !== undefined && { targetAgents }),
      },
    })

    return Response.json({ data: skill })
  } catch (error) {
    const appError = toAppError(error, { message: 'Failed to update skill', code: 'DATABASE_ERROR', statusCode: 500 })
    return Response.json({ error: appError.message, code: appError.code }, { status: appError.statusCode })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'User not authenticated', code: 'UNAUTHENTICATED' }, { status: 401 })
    }

    const { id } = await params
    const existing = await getOwnedSkill(id, clerkUserId)
    if (!existing) {
      return Response.json({ error: 'Skill not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    await prisma.skill.delete({ where: { id } })
    return Response.json({ success: true })
  } catch (error) {
    const appError = toAppError(error, { message: 'Failed to delete skill', code: 'DATABASE_ERROR', statusCode: 500 })
    return Response.json({ error: appError.message, code: appError.code }, { status: appError.statusCode })
  }
}
