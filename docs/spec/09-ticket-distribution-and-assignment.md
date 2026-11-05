# 9. Ticket distribution and assignment


Unassigned tickets created from a mailbox are handed automatically to the eligible agent with the fewest Open tickets in that category, up to a per-agent cap.

**Configuration \[MUST\]:** on each category-to-rights link, a *distribution limit* (None, or a number such as 5). None disables auto-distribution for users of that rights profile.

**Eligibility:** an agent is eligible for a ticket when all are true: their rights include the category with Access = Yes and a limit set; the category is the default category of a mailbox queue in their rights; they are currently logged in to that queue (a "ready for email" toggle in the agent UI); their count of Open tickets in that category is below the limit. Being on a break/pause does not block distribution.

**Algorithm**

1.  When a ticket with no User is created through a mailbox queue (directly or after routing), find eligible agents.

2.  Pick the one with the fewest Open tickets in the category; break ties by longest time since last assignment.

3.  If nobody is eligible, leave the ticket unassigned in a FIFO backlog for that category.

4.  When any agent's Open count drops (a ticket goes to Waiting, Closed, Archived, or is reassigned) or an agent logs in to a queue, retry the oldest backlog tickets.

Only Open tickets count toward the limit; Waiting, Closed and Archived do not, so moving a ticket to Waiting frees a slot. Use a database lock or queue worker so two tickets cannot be assigned past the cap concurrently.

**Manual assignment \[MUST\]:** any user can set the User field to themselves or anyone visible under their rights. Reassignment notifies the new owner (section 13).
