# 5. Domain model


Every communication is an Activity that links back to a Contact and, usually, a Ticket; tickets live in Categories; contacts live in CRM databases and optionally belong to Accounts. This mirrors Daktela's documented model ([How Customer Data Works](https://docs.daktela.com/contact-centre/administrator/databases/)).

CRMDatabase 1──\* Contact \*──0..1 Account \*──1 CRMDatabase  
CRMRecordType 1──\* CRMRecord \*──0..1 Contact \| Account \| Ticket  
Category 1──\* Ticket \*──0..1 Contact (primary)  
Ticket 1──\* Activity (email \| comment \| later: call, chat, sms)  
Ticket 0..1──\* Ticket (parent / child)  
Ticket \*──\* User (followers); Ticket \*──0..1 User (owner)  
MailboxQueue \*──1 Category (default); Activity \*──0..1 MailboxQueue  
SLA 1──\* Category; SLA 0..1──\* Account (override); TimeGroup 1──\* Category

**Core entities and fields \[MUST\]**

| Entity       | Key fields                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|--------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Ticket       | id (sequential integer, shown as \#number), title, description (rich text), category_id, state (open/waiting/closed/archived), statuses\[\] , priority (low/normal/high), user_id (owner, nullable), contact_id (nullable), parent_id (nullable), followers\[\], deadline, first_answer_deadline, first_answer_at, closed_at, reopen_at (nullable), sla_paused_seconds, custom_fields (JSON keyed by field id), created_at, updated_at, last_activity_at, is_anonymised |
| Activity     | id, ticket_id (nullable), type (email/comment), direction (in/out/internal), queue_id, contact_id, user_id (author), status (draft/scheduled/sent/received/failed), replied_to_activity_id, is_external (comments), created_at, edited_at                                                                                                                                                                                                                               |
| EmailMessage | activity_id, message_id, in_reply_to, references\[\], from, to\[\], cc\[\], bcc\[\], subject, body_html, body_text, attachments\[\], scheduled_for, raw_storage_key                                                                                                                                                                                                                                                                                                     |
| Contact      | id, database_id, account_id (nullable), name, emails\[\] , phones\[\] (E.164), custom_fields, created_at                                                                                                                                                                                                                                                                                                                                                                |
| Account      | id, database_id, name, sla_id (nullable), custom_fields                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CRMRecord    | id, record_type_id, title, status, stage (open/closed), contact_id, account_id, ticket_id, user_id, custom_fields                                                                                                                                                                                                                                                                                                                                                       |
| Category     | id, title, sla_id, time_group_id, default_queue_ids, status_required (never/on_close/always), multiple_statuses, check_child_on_close, auto_archive_days, allow_external_comments, waiting_requires_reopen, default_crm_database_id, form_layout, autofocus_tab                                                                                                                                                                                                         |
| CustomField  | id, name, type, options\[\], pool (shared ticket+CRM pool)                                                                                                                                                                                                                                                                                                                                                                                                              |
| Attachment   | id, owner_type, owner_id, filename, mime, size, storage_key, checksum                                                                                                                                                                                                                                                                                                                                                                                                   |
| HistoryEntry | id, entity_type, entity_id, user_id, session_id, changes (field, old, new), created_at                                                                                                                                                                                                                                                                                                                                                                                  |

**Rules**

- Custom fields belong to one shared pool used by ticket category forms, contact forms, account forms and CRM record type forms. A field created for contacts can also be placed on a ticket form; renaming it changes it everywhere.

- Every ticket must have a category; the database must reject a ticket without one.

- Deleting an entity referenced elsewhere soft-deletes it (deleted_at) so history and reports stay intact.
