# 12. CRM


The CRM holds people (contacts), companies (accounts) and long-lived business objects (CRM records), and gives agents each customer's full communication history ([CRM features](https://daktela.com/features/crm)).

### 12.1 CRM databases \[MUST\]

A CRM database is a container for contacts and accounts. Settings: title, default flag, contact form layout, account form layout, linked mailbox queues (which queues match senders against it). Exactly one database can be the default; it is pre-selected when creating contacts and auto-linked to queues created afterwards. Users see only databases in their rights. Use separate databases to keep brands, countries or partner groups apart.

### 12.2 Contacts, accounts, records \[MUST\]

- **Contacts module:** list with filters, saved filter schemes, columns, bulk edit, export, import, merge, delete, anonymise. Detail page tabs: Form, Activities (every email/comment linked to the contact), Tickets, CRM records, Attachments (unlimited files), History, iFrame tabs.

- **Accounts module:** same list features. Detail shows the account form, its SLA (optional), its contacts, and the combined tickets and activities of all its contacts.

- **CRM record types:** admin-defined (e.g. Deal, Contract, Complaint), each with its own form, statuses and iFrame tabs. Users see only types in their rights.

- **CRM records:** title, type, status, stage (Open/Closed), owner, links to contact, account and ticket, custom form. Visible in the contact, account and ticket detail. A ticket can create a linked record in one click.

- **History / snapshots:** every field change on contacts, accounts and records is logged with old/new values, and the form can be viewed as it was at any past point.

### 12.3 Contact matching \[MUST\]

- Contacts are recognised only by values in fields of type *Email* and *Phone*; a contact with neither cannot be matched.

- Normalise on save: emails lower-cased and trimmed; phones stored in E.164 (default region GB).

- On an inbound email, search contacts in the databases linked to the receiving queue. One match → link it. Several → link the most recently active and let the agent switch between suggestions in the ticket. None → leave empty; the agent can *Create contact* (pre-filled with the sender's name and email, in the category's default database) or *Link existing*.

- When a ticket's contact is set, the account and its SLA follow automatically.

### 12.4 Import, export, merge \[MUST\]

- **Import** contacts or accounts from CSV or XLSX: upload, map columns to fields, choose the database, choose duplicate handling (skip / update / create new) keyed on email or phone, preview the first 20 rows, then run as a background job with a downloadable error report. Column mappings can be saved as reusable templates.

- **Export** the current filtered list to CSV or XLSX with chosen columns (requires export access).

- **Merge** two or more contacts: pick the survivor, choose per field which value wins, move all tickets, activities, records and attachments to the survivor, log the merge in history. Same for accounts.

### 12.5 Contact card in the ticket \[MUST\]

The ticket's right panel shows a compact contact card: name, account, key fields chosen by the admin, and counts of open tickets and records, each clickable. Opening a ticket whose contact is known shows the contact's other open tickets so agents spot duplicates.
