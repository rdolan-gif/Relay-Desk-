/**
 * Knowledge-base folder rights (spec 15): view / create / update / delete per folder, combined
 * with the Knowledge base module access. A grant applies to the folder and its subfolders
 * unless a subfolder has its own grant (the nearest one wins).
 */
export interface KbGrant {
  folderId: string;
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}
export type KbVerb = 'view' | 'create' | 'update' | 'delete';
export type KbRights = 'all' | readonly KbGrant[];

const NONE = { view: false, create: false, update: false, delete: false };
const ALL = { view: true, create: true, update: true, delete: true };

export function kbFolderRights(folderId: string | null, parents: ReadonlyMap<string, string | null>, rights: KbRights) {
  if (rights === 'all') return { ...ALL };
  let id: string | null = folderId;
  for (let guard = 0; id && guard < 100; guard++) {
    const g = rights.find((r) => r.folderId === id);
    if (g) return { view: g.view, create: g.create, update: g.update, delete: g.delete };
    id = parents.get(id) ?? null;
  }
  return { ...NONE };
}

export const canKb = (
  verb: KbVerb,
  folderId: string | null,
  parents: ReadonlyMap<string, string | null>,
  rights: KbRights,
) => kbFolderRights(folderId, parents, rights)[verb];

/** A folder cannot move under itself or one of its own subfolders. */
export function isCycle(
  folderId: string,
  newParentId: string | null,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  let id = newParentId;
  for (let guard = 0; id && guard < 100; guard++) {
    if (id === folderId) return true;
    id = parents.get(id) ?? null;
  }
  return false;
}

/** Tags are lower-case, trimmed, unique, at most 20. */
export const normaliseTags = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
