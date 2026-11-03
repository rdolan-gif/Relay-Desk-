/**
 * Followers after a comment (spec 13): the author and anyone @mentioned are added;
 * external users never follow. Returns ids to add (excluding existing followers).
 */
export function followersToAdd(args: {
  existing: readonly string[];
  authorId: string;
  mentionedIds: readonly string[];
  isInternalUser: (id: string) => boolean;
}): string[] {
  const out: string[] = [];
  for (const id of [args.authorId, ...args.mentionedIds]) {
    if (!args.isInternalUser(id)) continue;
    if (args.existing.includes(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Mentions newly added during an edit (only these are notified, spec 6.2). */
export function newMentions(before: readonly string[], after: readonly string[]): string[] {
  return [...new Set(after)].filter((id) => !before.includes(id));
}
