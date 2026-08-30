import type { Context, Next } from 'hono';
import { db } from '../db/index.js';
import { projects, projectMembers, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import type { AppEnv, ProjectAccess, ProjectRole } from '../lib/types.js';

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

/**
 * Resolve what a user may do with a project.
 * Owner → full control. Instance admins get owner-equivalent read/write so
 * support can act without ownership transfer. Everyone else needs a membership row.
 */
export async function resolveAccess(projectId: string, userId: string): Promise<ProjectAccess | null> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) return null;

  if (project.userId === userId) return { project, role: 'owner' };

  const membership = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
  });
  if (membership) {
    const assignable: readonly string[] = ['viewer', 'member', 'admin'];
    const role: ProjectRole = assignable.includes(membership.role)
      ? (membership.role as ProjectRole)
      : 'viewer';
    return { project, role };
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.role === 'admin') return { project, role: 'owner' };

  return null;
}

/**
 * Route middleware. Attaches the project + role to the context, or 404s.
 * A 404 (not 403) is deliberate: it does not confirm that an id exists.
 */
export function requireProject(minimum: ProjectRole = 'viewer') {
  return async (c: Context<AppEnv>, next: Next) => {
    const projectId = c.req.param('projectId') || c.req.param('id');
    if (!projectId) return c.json({ error: 'Project id required' }, 400);

    const access = await resolveAccess(projectId, c.get('userId'));
    if (!access) return c.json({ error: 'Not found' }, 404);

    if (ROLE_RANK[access.role] < ROLE_RANK[minimum]) {
      return c.json({ error: 'Insufficient permissions for this project' }, 403);
    }

    c.set('project', access.project);
    c.set('projectRole', access.role);
    return next();
  };
}

/** Instance-level admin guard, used by /api/admin and the suggestions inbox. */
export async function requireInstanceAdmin(c: Context<AppEnv>, next: Next) {
  const user = await db.query.users.findFirst({ where: eq(users.id, c.get('userId')) });
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  return next();
}
