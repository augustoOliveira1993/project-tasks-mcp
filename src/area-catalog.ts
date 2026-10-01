export const LEGACY_AREAS = ['backend', 'frontend', 'outro'] as const;

export function areasForProject(project: { areas?: unknown } | null | undefined): string[] {
  if (!Array.isArray(project?.areas) || project.areas.length === 0) return [...LEGACY_AREAS];
  return project.areas.filter((area): area is string => typeof area === 'string' && area.trim().length > 0);
}
