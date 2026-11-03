# Open questions and assumptions

Anything the spec leaves open is logged here with the behaviour chosen. The owner can
overturn any decision; the "Changing it" note says how hard that would be.

Status: **Open** = owner input wanted · **Assumed** = built as described until told otherwise.

## From the spec (section 21)

| #   | Question                                                          | Phase | Status / current assumption                                                                                                            |
| --- | ----------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Single company, or sold to many companies (multi-tenant)?         | 0     | **Decided (owner, 03/11/2026): single company.** One organisation per deployment; not for resale. No tenant scoping in the data model. |
| S-2 | Is telephony out of v1, or needed later via an existing provider? | —     | Open. Data model keeps `Activity.channel` open (spec 2).                                                                               |
| S-3 | Routing rules: first match wins, or all matches apply in order?   | 3     | Open. Spec default: first match wins.                                                                                                  |
| S-4 | Merged-away tickets: archived, deleted, or kept as children?      | 2     | Open. Spec default: archived with a link to the survivor.                                                                              |
| S-5 | Which fields, views and categories does the team use today?       | 1–2   | Open.                                                                                                                                  |
| S-6 | Number of agents, mailboxes and emails per day?                   | 8     | Open. Spec targets used meanwhile (200 concurrent agents).                                                                             |
| S-7 | Data migration from the current system via its REST API?          | —     | Open. Would add a migration phase.                                                                                                     |
| S-8 | External portal in v1 or later?                                   | 7     | Open. External user type exists now; portal is Phase 7.                                                                                |

## Phase 0 decisions

| #       | Topic                                                | Decision                                                                                                                                                                                                                                                                                                                                  | Status                |
| ------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Q-P0-1  | Earlier conversation                                 | The previous planning chat was not available to the build session, so only the spec was used. Paste any decisions from it here.                                                                                                                                                                                                           | **Open**              |
| Q-P0-2  | Product name and look                                | "Relay Desk" (from the repository name), teal primary colour, Mantine components.                                                                                                                                                                                                                                                         | Assumed               |
| Q-P0-3  | Self-lockout                                         | An admin cannot deactivate themselves or change their own user type.                                                                                                                                                                                                                                                                      | Assumed               |
| Q-P0-4  | "Restricted rights profile" in the Phase 0 done-when | Modules are controlled by the **access** profile, data scope by the **rights** profile (spec 4). The acceptance test gives the user a restricted access profile _and_ a restricted rights profile (sees only selected users), and checks 403 on forbidden modules and verbs.                                                              | Assumed               |
| Q-P0-5  | Privilege escalation                                 | (a) Users may assign only profiles in their rights' editable lists. (b) Only holders of "all" editable profiles may create new profiles. (c) No one can grant a module verb or flag they don't hold themselves. (d) Profile lists show only profiles you can edit. (e) You cannot edit a user whose current profiles you couldn't assign. | Assumed               |
| Q-P0-6  | What "logged in" means for the type-change block     | Holding an unrevoked web session that is not expired (12 h absolute) or idle (120 min). API tokens do not count.                                                                                                                                                                                                                          | Assumed               |
| Q-P0-7  | Password policy                                      | 12–128 characters and zxcvbn score ≥ 3, taking name and email into account. No forced rotation (in line with NIST 800-63B).                                                                                                                                                                                                               | Assumed               |
| Q-P0-8  | Login rate limit                                     | 5 failures per email or 20 per IP in 15 minutes → HTTP 429 until the window passes. No admin unlock yet.                                                                                                                                                                                                                                  | Assumed               |
| Q-P0-9  | SSO (Google/Microsoft)                               | [SHOULD]; not in Phase 0. Planned with the OAuth work for mailboxes in Phase 3.                                                                                                                                                                                                                                                           | Open: needed earlier? |
| Q-P0-10 | Forcing 2FA                                          | **Decided (owner, 03/11/2026): no mandatory 2FA.** Staff sign in with an email and a password issued by an administrator in Settings > Users. Optional per-user TOTP stays available (spec 4 lists it as [MUST]) but nobody is required to use it.                                                                                        | Decided               |
| Q-P0-11 | Password reset                                       | Admins set a new password in Settings > Users (this logs the user out everywhere). A self-service "forgot password" email waits for the email channel (Phase 3).                                                                                                                                                                          | Assumed               |
| Q-P0-12 | API tokens                                           | One personal token per user, shown once, stored hashed, no expiry. Same permissions as the user. Creating a new one replaces the old; deactivation revokes it.                                                                                                                                                                            | Assumed               |
| Q-P0-13 | Deleting users                                       | Not offered. Users are deactivated to keep history intact (spec 5, soft delete).                                                                                                                                                                                                                                                          | Assumed               |
| Q-P0-14 | External users                                       | Created in Settings > Users with type External. They have no access or rights profile and cannot sign in to the internal app. Portal login arrives in Phase 7.                                                                                                                                                                            | Assumed               |
| Q-P0-15 | Settings modules                                     | Every Settings page is its own module in access profiles. Pages for later phases are already listed so profiles can be prepared in advance.                                                                                                                                                                                               | Assumed               |
| Q-P0-16 | Stack choices within spec 18                         | Drizzle ORM (typed SQL, plain SQL migrations), Mantine (accessible components), Vitest, zod validation, sessions in Postgres with an httpOnly SameSite=Lax cookie plus a CSRF header token.                                                                                                                                               | Assumed               |
| Q-P0-17 | Audit actor on failed login                          | A failed login for an unknown email is logged with the attempted email as `actorLabel` and no user ID.                                                                                                                                                                                                                                    | Assumed               |

## Phase 1 decisions

| #       | Topic                               | Decision                                                                                                                                                                                           | Status  |
| ------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Q-P1-1  | CRM rights                          | Rights profiles grant CRM databases and record types as "all" or a list. Existing full administrators were upgraded to "all" by migration. Nobody can grant a scope they can't see themselves.     | Assumed |
| Q-P1-2  | Creating databases and record types | Only users who can see all databases (or all record types) may create one; otherwise they couldn't see what they had made.                                                                         | Assumed |
| Q-P1-3  | Contact ↔ account                   | A contact can only be linked to an account in the same CRM database.                                                                                                                               | Assumed |
| Q-P1-4  | Record visibility                   | Records are visible by record type. In record lists, a linked contact or account name is blanked if its database is hidden from you.                                                               | Assumed |
| Q-P1-5  | "Hidden from agents" fields         | Not shown in the form and cannot be changed through it; values still exist in the API. Portal hiding arrives in Phase 7.                                                                           | Assumed |
| Q-P1-6  | Filter details                      | All conditions must match (AND). Text matching ignores case; option values match exactly. Dates compare on the UTC calendar date. Numbers support is / is not / empty (the spec's operator list).  | Assumed |
| Q-P1-7  | Search                              | Phase 1 searches contacts (name, email, phone digits), accounts and records with simple matching, respecting rights. Tickets, KB and full-text ranking arrive in Phase 6.                          | Assumed |
| Q-P1-8  | Phone display                       | **Decided (owner, 03/11/2026):** UK numbers shown UK-style (07911 123456); other countries international (+33 1 42 68 53 00). Always stored in E.164.                                              | Decided |
| Q-P1-9  | Duplicate contacts                  | **Decided (owner):** warn when an email or phone matches another visible contact, but allow saving. Merge arrives in Phase 6.                                                                      | Decided |
| Q-P1-10 | Phone validation                    | **Decided (owner):** strict, only numbers in allocated ranges. Note: Ofcom's reserved "drama" numbers (e.g. 07700 900xxx) are rejected.                                                            | Decided |
| Q-P1-11 | Quick actions                       | **Decided (owner):** copy buttons on emails and phones. No click-to-call; calls use a landline system.                                                                                             | Decided |
| Q-P1-12 | Deleting                            | Contacts, accounts and records are soft-deleted. An account with contacts, a non-empty database, the default database, a field still on a form and a record status still in use cannot be deleted. | Assumed |
| Q-P1-13 | Section descriptions                | Plain text for now (spec says rich text); upgrade with the rich-text editor in Phase 2.                                                                                                            | Assumed |
| Q-P1-14 | Form builder                        | Drag (or keyboard) to reorder sections and fields; fields move between sections with a "Move to section" menu.                                                                                     | Assumed |
| Q-P1-15 | Contacts without email or phone     | Allowed, but they can never be matched to incoming email (spec 12.3).                                                                                                                              | Assumed |

## Phase 2 decisions

| #       | Topic                         | Decision                                                                                                                                   | Status   |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Q-P2-1  | Merge (S-4)                   | Spec default: merged-away tickets are archived with a link to the survivor; activities and followers move to the survivor; history on all. | Assumed  |
| Q-P2-2  | Comment attachments           | Arrive in Phase 3 together with email attachments (both need file storage).                                                                | Assumed  |
| Q-P2-3  | @mentions                     | Picked from a "Mention" list next to the comment box rather than typed inline as "@name".                                                  | Assumed  |
| Q-P2-4  | Archived tickets              | Automation never changes them (spec 6.3). Staff can still edit them manually, including changing the state back.                           | **Open** |
| Q-P2-5  | "All categories" in rights    | Means Access = Yes everywhere and no distribution limit. Existing full administrators were upgraded to all categories and team views.      | Assumed  |
| Q-P2-6  | Hidden-category create        | Creating a ticket in a category with Access = No returns `{ id, visible: false }`; the UI says it was saved but can't be shown.            | Assumed  |
| Q-P2-7  | closed_at                     | Set when a ticket is closed or archived, cleared when it reopens. Reporting (Phase 7) uses history for first-close times.                  | Assumed  |
| Q-P2-8  | Scheduled jobs                | Re-open and auto-archive run every minute in the API process; they move to the job queue when email arrives (Phase 3).                     | Assumed  |
| Q-P2-9  | Bulk edit                     | Up to 200 tickets at once, saved one by one; failures are listed, not fatal. Background jobs above 200 come in Phase 6.                    | Assumed  |
| Q-P2-10 | Deleting tickets              | Needs both Delete on the Tickets module and the "can delete tickets" flag. Soft delete; recovery screen in Phase 6.                        | Assumed  |
| Q-P2-11 | Optimistic locking            | Built now (spec lists it under Phase 5): saving an out-of-date ticket returns 409 with the current values and a Reload button.             | Assumed  |
| Q-P2-12 | My views sidebar              | Reorder with up/down buttons (keyboard friendly); nesting and folders are stored and shown. Drag-and-drop reorder can follow if wanted.    | Assumed  |
| Q-P2-13 | Child ticket from an activity | The child records the source activity and starts with its text as the description; the activity stays on the parent.                       | Assumed  |
| Q-P2-14 | Ticket list order             | Newest first by default.                                                                                                                   | Assumed  |
| Q-P2-15 | Date-time inputs              | Use the browser's own picker, which follows the computer's regional settings (DD/MM/YYYY on UK-configured machines).                       | Assumed  |
| Q-P2-16 | "Sessions view" in History    | Comes with time tracking (spec 6.5, [SHOULD]); "Hide activities" is built.                                                                 | Assumed  |

## Questions for the owner — 04/11/2026, 08:00

1. **Click to email.** You chose copy buttons. Should email addresses also open your mail
   program (Outlook etc.) until ticket email arrives in Phase 3? (Quick yes/no.)
2. **Your real CRM layout.** What does your team keep on contacts and accounts today, and do
   you need more than one CRM database (e.g. per brand or team)? What long-lived records do
   you track (deals, contracts, complaints, orders)? I'll replace the demo data with yours.
3. **Phase 2 (tickets) inputs.** Which ticket categories and statuses do you use now, and which
   fields go on ticket forms?
4. **Merging tickets (S-4).** When two tickets are merged, should the merged-away ticket be
   archived with a link (spec default), deleted, or kept as a child?
5. **Volumes (S-6).** Roughly how many agents, mailboxes and emails per day?
6. **Migration (S-7).** Do you need your existing tickets, contacts and history brought across
   from the current system?
7. **Customer portal (S-8).** Needed in v1, or later?
8. **Email routing (S-3, Phase 3).** When several routing rules match an email, should only the
   first apply, or all of them in order?
9. **Archived tickets (Q-P2-4).** Should Archived tickets be fully read-only for staff, or can
   they still be edited (e.g. moved back to Open by hand)?
10. **Mentions (Q-P2-3).** Is picking people from a "Mention" list next to the comment box
    fine, or do you want inline "@name" autocomplete while typing?
11. **Ticket categories and SLAs (Phase 4 prep).** What response and resolution times do you
    promise customers, per priority, and what are your working hours and holidays?
