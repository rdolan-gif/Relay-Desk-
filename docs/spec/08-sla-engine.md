# 8. SLA engine


An SLA defines, per priority, how many working hours (or minutes) the team has to first respond and to solve a ticket; deadlines are computed only inside the category's working hours ([SLA](https://docs.daktela.com/contact-centre/administrator/tickets/sla/)). Implement this as a pure, heavily unit-tested module.

**SLA definition \[MUST\]:** title, unit (hours or minutes), and for each priority Low / Normal / High a *Solution* time (required) and a *Response* time (optional).

**Time group \[MUST\]:** a named weekly schedule (multiple intervals per weekday), a timezone, and dated exceptions (bank holidays, closures). UK bank holidays should be importable.

**Which SLA applies**

1.  If the ticket's primary contact belongs to an account with an SLA, use the account's SLA.

2.  Otherwise use the category's SLA.

3.  Working hours always come from the category, never the account.

**Deadline calculation** (all additions are in working time)

- Only Solution set: deadline = created_at + Solution.

- Response and Solution set: first_answer_deadline = created_at + Response; deadline = created_at + Response + Solution.

- Example: Solution 4 h, working hours 09:00–17:00 daily, ticket created 16:00 → deadline 12:00 next working day.

- Recalculate deadlines when priority, category or contact (account) changes, unless a deadline was set manually. A manual deadline is never recalculated.

**What counts as a response:** an outgoing email sent by an agent (auto-responses and system emails do not count); later channels: an outbound message or a connected call. Except for email, an incoming activity merged into the ticket can also count. An unconnected call never counts.

**What counts as a solution:** moving the ticket to Closed (or Archived).

**Waiting pause:** while a ticket is Waiting, the solution countdown stops; on reopening, deadline is extended by the working time spent in Waiting. The first-answer countdown is *not* paused.

**Outcome flags (store, do not just display):** first_answer_met (true/false/null) and solution_met (true/false/null), frozen at the moment they are decided. Reporting uses these.

**Acceptance tests (minimum)**

- Ticket at 16:00 Friday, 4 h solution, Mon–Fri 09–17 → deadline Monday 12:00.

- Same, with Monday a bank holiday in the time group → Tuesday 12:00.

- Response 1 h + Solution 8 h, created 10:00 Tue → first answer due 11:00 Tue, deadline 11:00 Wed.

- Ticket Waiting from 12:00 to 15:00 the same working day → deadline moves 3 working hours later.

- Contact's account has its own SLA → account SLA times used with the category's working hours.

- DST change weekend in Europe/London does not shift working hours.
