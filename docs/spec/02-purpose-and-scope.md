# 2. Purpose and scope


The system lets a support team turn every customer email into a tracked ticket, work it to resolution against SLA deadlines, and see each customer's full history in a linked CRM. One shared web application serves agents, team leaders and administrators; an external portal lets selected customers or partners follow their tickets.

**Primary goals**

1.  No customer email is lost: every inbound email lands in exactly one ticket, and replies thread back to it.

2.  Every ticket has a clear owner, state and deadline.

3.  Agents see who the customer is and everything that has happened with them, in one place.

4.  Administrators configure categories, forms, SLAs, routing and permissions without code changes.

**In scope for v1**

| Area    | Included                                                                                                                                               |
|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| Tickets | Categories, states, statuses, priorities, custom forms, views, filters, merge, parent/child, followers, macros, history                                |
| SLA     | Response and solution deadlines per priority, working hours, account overrides, pause in Waiting                                                       |
| Email   | Mailbox connection (IMAP/SMTP, Gmail and Microsoft 365 OAuth), email-to-ticket, header threading, routing rules, templates, signatures, auto-responses |
| CRM     | CRM databases, contacts, accounts, CRM record types and records, matching by email/phone, import/export, merge                                         |
| Users   | User types, accesses (modules + CRUD), rights (data scope), SSO                                                                                        |
| Other   | Knowledge base, external portal, notifications, audit log, basic ticket reporting, REST API + webhooks                                                 |

**Out of scope for v1 \[LATER\]**

Telephony (PBX, SIP, WebRTC softphone, call queues, IVR, campaigns and diallers, call recording), web chat, SMS, WhatsApp/Viber/Messenger/Instagram, social media comments, chatbots and voicebots, AI features (copilot, summaries, translation, auto-categorisation), workforce management, wallboards, QA scoring, CSAT surveys, mobile and desktop apps.

The data model must still allow these later: an *Activity* has a channel field, and calls/chats/messages would become new activity types attached to tickets exactly like emails.
