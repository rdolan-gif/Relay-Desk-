# 13. Notifications, followers, mentions, presence


Users are told about ticket events in an in-app notification centre and, if the category is set up for it, by email to their notification address.

**Email notification rules per category, per user \[MUST\]**

| Rule                | Sends when                                                                                           |
|---------------------|------------------------------------------------------------------------------------------------------|
| Owner               | A new ticket in this category is assigned to the user, or a new activity lands on a ticket they own. |
| Followed            | A ticket they follow in this category gets a new activity.                                           |
| New                 | A ticket is created in this category, or moved into it.                                              |
| Edit / new activity | Any ticket in this category gets a new activity.                                                     |

**In-app notification centre \[MUST\]:** bell icon with unread count; entries for assignment to me, new activity on my or followed tickets, @mentions, SLA about to breach (configurable, default 30 working minutes before) and breached, failed email sends, import/export jobs finished. Mark read, mark all read, click opens the item. Real-time push over WebSocket.

**Followers \[MUST\]:** any user can follow or unfollow a ticket; the author of a comment and anyone @mentioned are added as followers automatically \[SHOULD\]. Followers never include external users.

**@mentions \[MUST\]:** typing @ in a comment lists users visible under the author's rights; the mentioned user is notified even if not a follower.

**Presence \[MUST\]:** while a ticket is open, avatars show other viewers and editors (6.2). If two users save conflicting changes to the same field, the second save is rejected with a message showing the current value and a one-click reload (optimistic locking on a ticket version number).

**Digest \[LATER\]:** a daily summary email of a user's open and breaching tickets.

No notification is ever sent to the user who caused the event.
