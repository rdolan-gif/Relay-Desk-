import type { AccessFlagMap, ModuleAccessMap, RightsProfile, UserType } from '@relay-desk/domain';

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    type: UserType;
    signature: string;
    hasCustomSignature: boolean;
    totpEnabled: boolean;
    hasPassword?: boolean;
    timezone: string;
    apiTokenCreatedAt: string | null;
  };
  access: { modules: ModuleAccessMap; flags: AccessFlagMap };
  rights: RightsProfile;
  csrfToken: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  type: UserType;
  accessProfileId: string | null;
  rightsProfileId: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  timezone: string;
}

export interface AccessProfileDto {
  id: string;
  name: string;
  description: string;
  modules: ModuleAccessMap;
  flags: AccessFlagMap;
}

export interface RightsProfileDto {
  id: string;
  name: string;
  description: string;
  userVisibility: 'all' | 'selected';
  visibleUserIds: string[];
  editableAccessProfiles: 'all' | string[];
  editableRightsProfiles: 'all' | string[];
  crmDatabases: 'all' | string[];
  crmRecordTypes: 'all' | string[];
  categories: 'all' | { categoryId: string; access: boolean; distribute: boolean; distributionLimit: number | null }[];
  ticketViews: 'all' | string[];
  mailboxes: 'all' | string[];
  macros: 'all' | string[];
  kbFolders: 'all' | { folderId: string; view: boolean; create: boolean; update: boolean; delete: boolean }[];
}

export interface AuditEntry {
  id: number;
  eventType: string;
  actorUserId: string | null;
  actorLabel: string | null;
  ip: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
