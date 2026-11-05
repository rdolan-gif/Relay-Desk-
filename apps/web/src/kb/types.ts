export interface KbFolder {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
  articles: number;
  rights: { view: boolean; create: boolean; update: boolean; delete: boolean };
}
export interface KbArticleSummary {
  id: string;
  folderId: string;
  title: string;
  tags: string[];
  updatedAt: string;
  version: number;
  authorName: string | null;
  snippet: string;
}
export interface KbArticle {
  id: string;
  folderId: string;
  title: string;
  bodyHtml: string;
  tags: string[];
  version: number;
  updatedAt: string;
  authorName: string | null;
  updatedByName: string | null;
  files: { id: string; filename: string; mime: string; size: number }[];
  rights: KbFolder['rights'];
}

/** "Products › Panels" paths for folder pickers. */
export function folderPaths(folders: KbFolder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<string, string>();
  for (const f of folders) {
    const parts: string[] = [];
    for (let x: KbFolder | undefined = f, g = 0; x && g < 20; g++) {
      parts.unshift(x.title);
      x = x.parentId ? byId.get(x.parentId) : undefined;
    }
    out.set(f.id, parts.join(' › '));
  }
  return out;
}
