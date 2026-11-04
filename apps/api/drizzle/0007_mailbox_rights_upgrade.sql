-- Full administrators can send from every mailbox.
UPDATE "rights_profiles" SET "all_mailboxes" = true
WHERE "edit_all_access_profiles" = true AND "edit_all_rights_profiles" = true;
