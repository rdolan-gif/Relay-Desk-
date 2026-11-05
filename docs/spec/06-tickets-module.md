# 6. Tickets module


Agents live in this module: a sidebar of views, a filterable ticket list, and a two-panel ticket detail with the activity feed on the left and the form on the right. Behaviour below follows Daktela's agent documentation ([Tickets](https://docs.daktela.com/contact-centre/tickets/)).

### 6.1 Ticket list

- **Sidebar \[MUST\]:** two sections. *Team views* are admin-defined, read-only for agents. *My views* hold the user's own views plus any team views they pinned. Users with *can create own ticket views* get + Add view and + New view. Edit mode allows remove from sidebar (does not delete), drag to reorder, nest as sub-views, and group into folders.

- **Columns \[MUST\]:** ID, title, contact, category, state, status, priority, user, deadline (with SLA colour), last activity, created. Users can choose and reorder columns; choice persists per user per view.

- **Filter \[MUST\]:** any system or custom field with operators (is, is not, contains, empty, before/after, in last N days). Save as stores a named filter scheme; schemes appear in a dropdown next to Filter.

- **Bulk actions \[MUST\]:** Edit (1+ selected), Merge (2+), Delete (1+), Anonymise (1+), Export current list (CSV/XLSX), New ticket. Each is shown only if the user's access allows it.

- **Peek \[SHOULD\]:** a row action opens the ticket in a side panel without leaving the list.

### 6.2 Ticket detail

**Header:** title, \#ID with copy-link icon, parent ticket link, created date, owner. Avatars show who else has the ticket open, distinguishing *editing* from *viewing* \[MUST\]. Buttons: Save changes, Close tab. When an email or comment draft is open and the form has unsaved changes, the primary button becomes Save & send email (or Save ticket & comment), with Save changes as secondary; an email draft takes priority over a comment draft. If sending fails validation, form changes are still saved and the draft stays unsent.

**SLA icons:** a hand icon counts down to the first-answer deadline; once that is met or missed, a stopwatch counts down to the solution deadline. Black and counting = time left in working hours; black and paused = Waiting state; red and counting negative = breached and unresolved; green, still = met; red, still = missed. Tooltip shows exact deadline, first-answer time and closed time. No icons when the category has no SLA and no manual deadline.

**Left panel, Activities tab \[MUST\]:** all activities grouped by date, newest last. New outgoing email opens an inline editor and switches the right panel to Templates. Comment adds an internal note (rich text, @mentions, attachments, code blocks). Per activity: header icons Edit comment, Copy link, Detail, and a menu with Create child ticket, Create KB article, Move to another ticket (needs access), Print. Footer buttons shown only when relevant: Reply, Reply all (multiple recipients only), Forward, Comment. A reply links to its source activity and shows a chip that expands the source inline.

**Editing comments \[MUST\]:** authors can edit their own comments; the header then shows "Edited: date time" and each edit is logged in History with a side-by-side diff. A new @mention added during an edit notifies that user. Attachments cannot be removed during an edit.

**Left panel, History tab \[MUST\]:** chronological log of field changes (old and new values, system and custom) interleaved with activities. Toggle *Sessions view* groups entries into one row per continuous block of work by one user (duration, time range, counts). Toggle *Hide activities* shows field changes only. Both toggles persist per user. Expanding an entry shows the form as it was at that moment; Reset returns to now.

**Right panel \[MUST\]:** tabs Form, Attachments, Templates, and admin-defined iFrame tabs. Layout ratio switch 2:1 / 1:1 / 1:2.

**Form fields:** Contact (primary), Account (via contact), Category, Priority, State, User, Deadline, Re-open date, Followers, Status(es), Description, then the category's custom form. Also: favourite star, parent/child link and merge actions.

**Suggested-ticket banner \[MUST\]:** when an inbound email's headers match several existing tickets, show a dismissible banner "This email may belong to one of these tickets" listing candidates; choosing one moves the email activity there.

### 6.3 States and automatic transitions

| State    | Meaning                                                  | Customer email arrives          |
|----------|----------------------------------------------------------|---------------------------------|
| Open     | Being worked on                                          | Appended, stays Open            |
| Waiting  | Reply sent, awaiting customer; SLA solution clock paused | Appended, ticket reopens        |
| Closed   | Resolved                                                 | Appended, ticket reopens        |
| Archived | Resolved and frozen                                      | A new ticket is created instead |

Automatic reopen rules (set state to Open):

| Event                                                                         | Reopens Waiting? | Reopens Closed? |
|-------------------------------------------------------------------------------|------------------|-----------------|
| Inbound customer email on the ticket                                          | Yes              | Yes             |
| A new, still-in-progress activity is attached (any channel, either direction) | No               | Yes             |
| External user posts an external comment in the portal                         | Yes              | Yes             |
| Internal comment added by someone other than the ticket's User                | Yes              | Yes             |
| Re-open date/time reached                                                     | Yes              | Yes             |

No automatic change in these cases: a comment on your own or an unassigned ticket; creating any non-comment activity from a Waiting ticket; attaching an already-finished activity; moving activities between tickets; anything on an Archived ticket (the portal also disables external comments on Archived tickets). A state chosen manually in the same save always wins over automation.

**Other automatic rules**

- When a ticket with no User is closed or archived from the ticket form, the system sets User to the person saving. Bulk edit does not do this. A macro that sets a different user wins.

- When a ticket is opened and its User is a deactivated account, and the same save sets no other user, User is cleared.

- When an agent sends a new outbound email not linked to a ticket, the system creates one: title = subject, category = sending queue's category, state = Closed, priority = Low, user = sender, contact = matched recipient. Email routings (outgoing direction) then apply.

- When a category has *auto-archive after N days*, a scheduled job archives tickets that have been Closed for N days.

- When saving to Waiting in a category with *waiting requires reopen time*, the Re-open field is mandatory.

- When closing in a category with *status required*, at least one status is mandatory.

- When closing or deleting a ticket in a category with *check child tickets on close*, the system refuses if any child ticket is not Closed/Archived.

### 6.4 Merge, parent/child, move

- **Merge \[MUST\]:** select 2+ tickets; choose the surviving ticket; all activities, attachments and followers move to it; merged tickets are archived with a link to the survivor; history logs the merge on both.

- **Parent/child \[MUST\]:** any ticket can have one parent and many children. "Create child ticket" from an activity copies the contact and links the activity.

- **Move activity \[MUST\]:** moves one activity to another ticket; neither ticket changes state or user.

### 6.5 Time tracking \[SHOULD\]

Opening a ticket starts a timed work session for that user, ending when they close the tab or go idle for 10 minutes. Sessions feed the History sessions view and reporting.
