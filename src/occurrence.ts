import type { Contributor, Occurrence } from "./types.ts";

export function canEdit(occurrence: Occurrence, contributor: Contributor): boolean {
  if (occurrence.contributor_id === contributor.id)
    return true;
  if (contributor.editor)
    return true;
  return false;
}
