# 4. Users, roles and permissions


A user's effective permissions are the combination of three independent settings: **user type**, **access profile** and **rights profile**. Accesses say where a user can go and what verbs they may use; rights say which data they see there. Both profiles are reusable and assigned to many users.

**User types \[MUST\]**

| Type          | Can do                                                                              |
|---------------|-------------------------------------------------------------------------------------|
| Agent         | Full helpdesk and CRM work, sends email to customers.                               |
| Back-office   | Works tickets internally (comments, fields) but cannot send external communication. |
| Administrator | Agent abilities plus the Settings area, subject to their access profile.            |
| External      | Logs in to the separate portal only (section 16). Never consumes an internal seat.  |

**Access profile \[MUST\]** — per module (Tickets, CRM Contacts, CRM Accounts, CRM Records, Knowledge base, Reporting, each Settings page): enabled yes/no, then Create, Read, Update, Delete. Extra flags: *can create own ticket views*, *can bulk edit*, *can merge tickets*, *can delete tickets*, *can anonymise*, *can export*, *can move activities between tickets*, *can import CRM data*.

**Rights profile \[MUST\]** — lists of what the user may work with:

- Ticket categories, each with two toggles: **Access** (can see tickets in it) and **Distribution limit** (section 9). A user with the category but Access = No can create a ticket in it but cannot see it after saving.

- Ticket views (Team views shown in their sidebar).

- Mailbox queues they can send from and are "logged in to" for distribution.

- CRM databases (which contacts/accounts they see) and CRM record types (which records they see).

- Macros and knowledge base folders.

- User visibility: which other users they can see and assign tickets to.

- For admin/team-leader profiles: which access and rights profiles they may edit (prevents privilege escalation).

**Rules**

- When a user opens any list, the system returns only rows passing both the access check (module + Read) and the rights scope (e.g. category in their rights with Access = Yes). The same check applies to the API, search, exports and notifications.

- When a user lacks rights to a mailbox queue's category, the system refuses to send a new email from that queue with the error "You do not have rights for this category."

- When a user is deactivated, the system logs them out, removes them as follower, and (on next save of each ticket they own) clears the ticket's User field.

- Changing a user's type is blocked while they are logged in; changing access or rights profiles takes effect on their next request.

- Authentication: email + password with enforced strength and optional TOTP 2FA \[MUST\]; Google and Microsoft SSO via OAuth/OIDC \[SHOULD\]; per-user API token for the REST API \[MUST\].
