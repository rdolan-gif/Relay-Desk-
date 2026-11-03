-- Rights profiles that could already edit every profile (full administrators) get
-- every CRM database and record type, so existing administrators keep seeing all data.
UPDATE "rights_profiles" SET "all_crm_databases" = true, "all_crm_record_types" = true
WHERE "edit_all_access_profiles" = true AND "edit_all_rights_profiles" = true;
