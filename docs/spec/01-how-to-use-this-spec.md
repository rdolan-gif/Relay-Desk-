# 1. How to use this spec


This document specifies a web-based helpdesk (ticketing) and CRM whose behaviour mirrors the email-and-ticket core of Daktela, plus the owner's quality-of-life changes in section 19. Behaviour described here was compiled from Daktela's public documentation and product pages (see section 21); where this spec and Daktela disagree, this spec wins.

**Instructions for Claude Code**

- Treat this document as the source of truth. Do not infer behaviour from "how Daktela probably works"; if something is unspecified, add it to docs/open-questions.md and choose the simplest reasonable behaviour.

- Split this spec into repo files on first run: CLAUDE.md (stack, commands, conventions, pointer to docs), docs/spec/ with one file per numbered section, and docs/open-questions.md.

- Build strictly in the phase order in section 20. Each phase must end with passing automated tests for every acceptance criterion listed for that phase.

- Business rules (state transitions, SLA maths, distribution, routing) live in a pure, framework-independent domain layer with exhaustive unit tests. UI and API call into it.

- Every rule written as "When X, the system Y" is a testable requirement. Write a test named after it.

- Requirement priority tags: **\[MUST\]** v1 blocker, **\[SHOULD\]** v1 if time allows, **\[LATER\]** do not build yet but do not design it out.

**Do not copy Daktela assets.** Reproduce functionality only. Do not use the Daktela name, logo, colours, icons, screenshots, documentation text or any of its code. Choose original naming for the product and UI. (The owner should take independent legal advice before commercial use; this note is not legal advice.)
