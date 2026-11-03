-- Full administrators (who can edit every profile) get every category and team view.
UPDATE "rights_profiles" SET "all_categories" = true, "all_ticket_views" = true
WHERE "edit_all_access_profiles" = true AND "edit_all_rights_profiles" = true;
