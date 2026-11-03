# 17. History, audit and reporting


**Entity history \[MUST\]:** every create, update, delete, merge, move and anonymisation of tickets, contacts, accounts and records writes a HistoryEntry (who, when, session, field, old value, new value). Written in the same database transaction as the change. Never editable.

**System audit log \[MUST\]:** admin-only list of security and configuration events: logins (success/fail, IP), password and 2FA changes, user/access/rights changes, settings changes with diff, exports, bulk jobs, anonymisations and erasures. Filterable and exportable; retained 2 years.

**Ticket reporting \[MUST\]** — a Reporting module with date range, category, user, queue and priority filters, showing:

| Metric                     | Definition                                                                     |
|----------------------------|--------------------------------------------------------------------------------|
| Tickets created / closed   | Count in period                                                                |
| Backlog                    | Open + Waiting at end of each day                                              |
| First-answer SLA met %     | Tickets with first_answer_met = true ÷ tickets where it was decided            |
| Solution SLA met %         | Same, for solution_met                                                         |
| Median first response time | Working-time minutes from creation to first qualifying response                |
| Median resolution time     | Working-time minutes from creation to first close, minus Waiting time          |
| Reopen rate                | Tickets reopened at least once ÷ tickets closed                                |
| Agent workload             | Open tickets per user now; tickets closed per user in period; time spent (6.5) |
| Volume by hour/weekday     | Inbound emails heatmap                                                         |

Each metric is shown as a chart plus a table, drillable to the underlying ticket list, and exportable to CSV/XLSX. Scheduled email reports \[LATER\]. Custom report builder and wallboards \[LATER\].

**Activities listing \[SHOULD\]:** a supervisor list of all email activities across tickets with filters (queue, direction, status, user, date), to spot failures and unassigned mail.
