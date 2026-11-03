# 14. Search, filters, bulk operations, GDPR tools


**Global search \[MUST\]:** one search box in the top bar covering tickets (title, ID, description, email subjects and bodies, comments), contacts, accounts, CRM records and KB articles. Minimum 3 characters; results grouped by type, each respecting the user's rights; typeahead suggestions after 300 ms. Target: results in under 1 second across 1 million activities. Use PostgreSQL full-text search first; a dedicated engine (e.g. OpenSearch or Meilisearch) only if the target is missed.

**Searchable period:** full-text covers tickets edited within a configurable retention window (default: all time).

**List filters and schemes \[MUST\]:** identical filter UI on every list (tickets, contacts, accounts, records, activities, users). Saved schemes are private by default and can be shared with a rights profile \[SHOULD\].

**Bulk operations \[MUST\]**

- Bulk edit: set any field available to all selected items. Logged per item in history. Runs as a background job above 200 items with progress shown.

- Bulk delete: soft delete, recoverable by an admin for 30 days.

- Merge (tickets 6.4, contacts and accounts 12.4).

- Import and export (12.4); ticket export includes chosen columns, optionally all activities as a ZIP of .eml files \[SHOULD\].

**GDPR tools \[MUST\]**

- *Anonymise* a ticket including its activities: replaces personal data (names, addresses, phone numbers, email bodies, attachments) with placeholders, irreversibly, keeping metadata for reports. Requires the anonymise access and a confirmation typed by the user.

- *Erase a contact* (right to erasure): anonymises the contact, its tickets and activities in one job, with an audit entry recording who did it and when.

- *Subject access export*: one click produces a ZIP of all data held on a contact (form data, tickets, emails, attachments, records).

- *Retention policies*: per category, auto-anonymise or delete tickets N days after archiving \[SHOULD\].
