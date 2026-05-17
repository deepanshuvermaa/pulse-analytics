import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { projects, events, users } from '../db/schema.js';
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

  // Enforce 5-project limit for non-admin users
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.role !== 'admin') {
    const [{ value: projectCount }] = await db.select({ value: count() }).from(projects).where(eq(projects.userId, userId));
    if (projectCount >= 5) {
      return c.json({ error: 'Free plan limited to 5 projects. Contact us to upgrade.' }, 403);
    }
  }

  const id = nanoid(12);

  const [project] = await db.insert(projects).values({
    id,
    userId,
    name: body.data.name,
    domain: body.data.domain,
  }).returning();

  const origin = new URL(c.req.url).origin.replace(/^http:/, 'https:');
  return c.json({ project, snippet: `<script src="${origin}/t.js" data-id="${id}"></script>` }, 201);
});

// Get project + snippet
projectsRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param('id')), eq(projects.userId, userId)),
  });
  if (!project) return c.json({ error: 'Not found' }, 404);

  const baseUrl = new URL(c.req.url).origin.replace(/^http:/, 'https:');
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

// Update project (clarity_id)
projectsRouter.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param('id')), eq(projects.userId, userId)),
  });
  if (!project) return c.json({ error: 'Not found' }, 404);
  if (body.clarityId !== undefined) {
    await db.update(projects).set({ clarityId: body.clarityId || null }).where(eq(projects.id, project.id));
  }
  return c.json({ success: true });
});

// Regenerate project ID (new snippet, old one stops working)
projectsRouter.post('/:id/regenerate', async (c) => {
  const userId = c.get('userId');
  const old = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param('id')), eq(projects.userId, userId)),
  });
  if (!old) return c.json({ error: 'Not found' }, 404);

  const newId = nanoid(12);
  // Create new project with same details, delete old
  await db.insert(projects).values({ id: newId, userId, name: old.name, domain: old.domain });
  await db.delete(projects).where(eq(projects.id, old.id));

  const baseUrl = new URL(c.req.url).origin.replace(/^http:/, 'https:');
  return c.json({ project: { ...old, id: newId }, snippet: `<script src="${baseUrl}/t.js" data-id="${newId}"></script>` });
});

export default projectsRouter;
