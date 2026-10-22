import type { Contributor, Occurrence } from "./types.ts";

export function canEdit(occurrence: Occurrence, contributor: Contributor): boolean {
  if (occurrence.contributor_id === contributor.id)
    return true;
  if (contributor.editor)
    return true;
  return false;
}

/** Whether a sighting is drawn and labelled as unconfirmed; disputed is a kind of it (decision 080). */
export function isUnconfirmed({confirmation}: Pick<Occurrence, 'confirmation'>): boolean {
  return confirmation === 'unconfirmed' || confirmation === 'disputed';
}
