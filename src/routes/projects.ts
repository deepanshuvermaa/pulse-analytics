import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { projects, events } from '../db/schema.js';
import { eq, and, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../lib/types.js';

const projectsRouter = new Hono<AppEnv>();
projectsRouter.use('*', authMiddleware);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(255),
});

// List projects
projectsRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
  return c.json({ projects: userProjects });
});

// Create project
projectsRouter.post('/', async (c) => {
  const body = createSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const userId = c.get('userId');
  const id = nanoid(12);

  const [project] = await db.insert(projects).values({
    id,
    userId,
    name: body.data.name,
    domain: body.data.domain,
  }).returning();

  return c.json({ project, snippet: `<script src="${c.req.url.replace('/api/projects', '/t.js')}" data-id="${id}"></script>` }, 201);
});

// Get project + snippet
projectsRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param('id')), eq(projects.userId, userId)),
  });
  if (!project) return c.json({ error: 'Not found' }, 404);

  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    project,
    snippet: `<script src="${baseUrl}/t.js" data-id="${project.id}"></script>`,
  });
});

// Delete project
projectsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const result = await db.delete(projects).where(
    and(eq(projects.id, c.req.param('id')), eq(projects.userId, userId))
  ).returning();
  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

export default projectsRouter;
