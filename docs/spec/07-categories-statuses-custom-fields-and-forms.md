# 7. Categories, statuses, custom fields and forms


The category is the main configuration object of the helpdesk: nearly every ticket behaviour is set on it ([Categories](https://docs.daktela.com/contact-centre/administrator/tickets/categories/)).

### 7.1 Category settings \[MUST\]

| Setting                       | Behaviour                                                                                                                          |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Title                         | Display name.                                                                                                                      |
| SLA                           | Optional. None = tickets get no automatic deadline and no SLA icons; a manual deadline can still be set and is never recalculated. |
| Working hours                 | A time group used for SLA maths. None = SLA clock runs 24/7.                                                                       |
| Default outgoing queues       | Mailbox used by default for emails sent from tickets in this category.                                                             |
| Status required               | Never / on close / on every save.                                                                                                  |
| Multiple statuses             | Allow more than one status per ticket.                                                                                             |
| Check child tickets on close  | Block close/delete while any child ticket is unresolved.                                                                           |
| Auto-archive after N days     | Closed tickets archive automatically after N days.                                                                                 |
| Allow external comments       | Agents may flag comments external; external users may comment.                                                                     |
| Waiting requires re-open time | Re-open date mandatory when saving to Waiting.                                                                                     |
| Autofocused tab               | Which right-panel tab opens first.                                                                                                 |
| Default CRM database          | Pre-selected when creating a contact from a ticket in this category.                                                               |

**Relations per category:** user rights (Access yes/no, distribution limit), groups (for organising categories in pickers), allowed statuses, iFrame tabs, notification rules (section 13), form layout, allowed macros. Admin lists offer **Multiple save** to apply statuses, form layout or macros to several categories at once \[SHOULD\].

### 7.2 Statuses \[MUST\]

Admin-defined labels with title, colour and optional description, managed globally and enabled per category. Removing a status from a category hides it from pickers but keeps it on existing tickets.

### 7.3 Custom fields \[MUST\]

One shared pool used by ticket, contact, account and CRM record forms. Field types: text, multi-line text, number, date, date-time, select (single), multi-select, radio, checkbox, email, phone, URL, user picker, contact picker. Per field: name, internal key (immutable), options with sort order, default value.

Changing or deleting a select option makes existing stored values with that option unreadable in the UI; the admin UI must warn and show how many records use it before saving.

### 7.4 Form builder \[MUST\]

A drag-and-drop layout editor. The admin drags **sections** (title, collapsed or expanded by default, rich-text description) and drops **fields** into them. Per field placement: tooltip, hidden from agents, read-only, required, rows of text, and **dynamic visibility** (show only when another field has a given value). The same builder is used for category forms, contact forms, account forms and CRM record type forms.
