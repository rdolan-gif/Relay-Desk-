# 3. Glossary


| Term               | Meaning                                                                                                                                          |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| Ticket             | One customer case, tracked from first contact to resolution. Holds activities, form data, state, owner and deadlines.                            |
| Activity           | One communication item: an email (in/out), an internal comment, or later a call, chat or message. Belongs to at most one ticket.                 |
| Comment            | An internal note on a ticket. Can be flagged *external* so external users see it.                                                                |
| Category           | The home of a ticket. Decides who can see it, its SLA, working hours, statuses, form, macros and notifications. Every ticket has exactly one.    |
| State              | System lifecycle field with four fixed values: Open, Waiting, Closed, Archived.                                                                  |
| Status             | Admin-defined label (e.g. "Refund issued") available per category. Optional, can be mandatory on close, can allow multiple.                      |
| Priority           | Low, Normal, High. Drives SLA deadlines.                                                                                                         |
| User (on a ticket) | The agent responsible for the ticket ("owner").                                                                                                  |
| Follower           | A user who gets notified of changes to a ticket.                                                                                                 |
| View               | A saved filter over all tickets, shown in the ticket sidebar. Team views are admin-made; My views are personal.                                  |
| Filter scheme      | A user's saved ad-hoc filter on a list.                                                                                                          |
| SLA                | Response and solution time targets per priority. Assigned to a category, overridable per account.                                                |
| Time group         | A named set of working hours (and holidays) used for SLA maths.                                                                                  |
| Macro              | A one-click button combining ticket actions (set fields, save, go back, open URL).                                                               |
| Mailbox queue      | A connected mailbox. Pulls inbound mail, sends outbound mail, and sets the default category for new tickets.                                     |
| Email routing      | An ordered rule that inspects an email and sets ticket fields (category, user, status, state, priority, custom fields).                          |
| CRM database       | A container for contacts and accounts. Controls which form they use and who can see them.                                                        |
| Contact            | A person. Matched to activities by email address and phone number.                                                                               |
| Account            | A company. Has many contacts. Can carry its own SLA.                                                                                             |
| CRM record         | A long-lived business object (deal, contract, order, complaint) of an admin-defined record type, with status and stage Open/Closed.              |
| Access             | Which modules a user can open, and Create/Read/Update/Delete per module.                                                                         |
| Right              | Which data a user can see inside those modules: categories, views, CRM databases, record types, macros, KB folders, mailbox queues, other users. |
| External user      | A non-employee login (customer or partner) limited to a portal showing tickets of their linked contacts.                                         |
