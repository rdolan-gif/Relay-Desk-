# 16. External user portal


A separate, restricted web portal lets customers or partners see and comment on tickets that concern them, without access to anything internal ([External Users](https://docs.daktela.com/contact-centre/administrator/users/external-users/)) \[SHOULD for v1\].

- **Accounts:** admin creates an external user with title, login name, password (or magic-link invite), email, description, one or more linked contacts, and flags *allow external comments* and *can see colleagues from same account* (read-only list).

- **Login** at /portal/login, separate session and cookie from the main app.

- **What they see:** tickets whose primary contact is one of their linked contacts, in categories with *allow external comments* on. Per ticket: title, ID, state, created date, and only comments flagged *external*. Never internal comments, emails' internal recipients, custom fields marked hidden, or other customers' data.

- **Commenting:** posts an incoming external comment; this reopens a Waiting or Closed ticket (6.3) and notifies the owner. Commenting is disabled on Archived tickets.

- **Agents' side:** a checkbox "Visible to external users" on each comment, available only when the category allows it.

- External users never consume a paid seat.
