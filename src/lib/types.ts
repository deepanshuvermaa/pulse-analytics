import type { projects } from '../db/schema.js';

export type Project = typeof projects.$inferSelect;

export type ProjectRole = 'viewer' | 'member' | 'admin' | 'owner';

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

/** Context variables set by the auth and project middlewares. */
export type AppEnv = {
  Variables: {
    userId: string;
    project: Project;
    projectRole: ProjectRole;
  };
};
