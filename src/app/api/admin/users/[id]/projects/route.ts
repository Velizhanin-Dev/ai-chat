import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { sanitizeBrief, type Brief } from "@/lib/brief";

// Проекты (диалоги) пользователя с их брифами — для деталей в админке. Бриф
// теперь крепится к проекту, поэтому показываем его здесь, а не на юзере.
// Только для админа; иначе 404 (как и вся зона /admin).

export interface AdminProjectRow {
  id: string;
  title: string;
  brief: Brief | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const rows = await prisma.conversation.findMany({
    where: { userId: params.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      brief: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
    take: 200,
  });

  const projects: AdminProjectRow[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    brief: c.brief ? sanitizeBrief(c.brief) : null,
    messageCount: c._count.messages,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return NextResponse.json({ projects });
}
