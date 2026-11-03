# 10. Macros


A macro is an admin-built button that runs an ordered list of ticket actions in one click ([Macros](https://docs.daktela.com/contact-centre/administrator/tickets/macros/)).

**Definition \[MUST\]:** title, description, button colour, position (not displayed / under the Save arrow menu / as its own button), and an ordered list of action blocks built by drag and drop.

| Action block     | Effect                                                                                                  |
|------------------|---------------------------------------------------------------------------------------------------------|
| Set category     | Sets the category.                                                                                      |
| Set user         | Sets the owner; a "replace" checkbox decides whether to overwrite an existing owner.                    |
| Set state        | Open / Waiting / Closed / Archived.                                                                     |
| Set status       | Adds or replaces status(es).                                                                            |
| Set priority     | Low / Normal / High.                                                                                    |
| Set re-open      | Relative (e.g. +3 working days) or absolute date-time.                                                  |
| Set custom field | Any field on the category form.                                                                         |
| Add follower     | Adds a user or the current user.                                                                        |
| Insert template  | Opens an email reply with a template pre-filled.                                                        |
| Open URL         | Opens a URL built from ticket fields, e.g. https://crm.example.com/?ticket={id}&contact={contact.name}. |
| Save             | Saves the ticket.                                                                                       |
| Don't save       | Applies changes to the form without saving.                                                             |
| Back             | Saves and returns to the ticket list.                                                                   |
| Delete           | Deletes the ticket and returns to the list (requires delete access).                                    |

Actions run in order; validation runs at the Save step, and a failing validation stops the macro and shows the error. Example: *Set state Waiting → Set re-open +2 days → Back*.

**Availability:** a macro shows on a ticket only if it is enabled for the ticket's category *and* in the user's rights. Macros can be cloned. **Multiple save** links a macro to several categories at once \[SHOULD\].
