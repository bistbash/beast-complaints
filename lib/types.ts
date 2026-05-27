import type {
  InquiryStatus,
  InquiryPriority,
  InquiryCategory,
  JustificationDecision,
  MessageType,
  HistoryAction,
} from './constants.ts';

export interface BeastUser {
  username: string;
  displayName?: string;
  email?: string;
  groups: string[];
  roles?: Array<{ key: string; data?: Record<string, unknown> }>;
  avatarUrl?: string | null;
}

export interface DatasetColumn {
  columnIndex: number;
  originalHeader: string;
  pgColumnName: string;
  pgType: string;
  nullable: boolean;
}

export interface DatasetMeta {
  datasetId: string;
  tableName: string;
  pkColumns: string[];
  createdBy: string | null;
  columns: DatasetColumn[];
}

/**
 * Logical inquiry view. The underlying db-smart dataset stores columns with the
 * Google Form's original names (title, full_name, email, request_category, ...);
 * the inquiries service SELECTs them with aliases so the rest of the codebase
 * sees these friendlier names.
 */
export interface InquiryRow {
  inquiry_id: string;
  subject: string;
  description: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  category: InquiryCategory | string | null;

  /** Submitter (parent) data — comes from the Google Form via db-smart sync. */
  submitter_name: string;
  submitter_email: string;
  submitter_phone: string | null;
  submitter_relation: string | null;

  /** Additional metadata captured by the Google Form. */
  grade_level: string | null;
  class_name: number | null;
  department: string | null;
  entity: string | null;
  role: string | null;
  role_bislat: string | null;

  /** Raw form submission timestamp (text, DD/MM/YYYY HH:MM:SS — Google Sheets format). */
  form_timestamp: string | null;

  created_at: string;
  routed_at: string | null;
  routed_by: string | null;
  assigned_group: string | null;
  assigned_user: string | null;

  team_response: string | null;
  team_response_at: string | null;
  team_response_by: string | null;

  manager_response: string | null;
  manager_response_at: string | null;
  manager_response_by: string | null;
  /** Manager's verdict — required before closing a new inquiry. NULL for legacy rows. */
  justification: JustificationDecision | null;
  justification_at: string | null;
  justification_by: string | null;

  closed_at: string | null;
  last_activity_at: string;
  due_at: string | null;
  closing_email_sent_at: string | null;
}

export interface MessageRow {
  id: string;
  inquiry_id: string;
  author: string;
  author_name: string | null;
  content: string;
  message_type: MessageType;
  created_at: string;
}

export interface HistoryRow {
  id: string;
  inquiry_id: string;
  action: HistoryAction;
  actor: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface UserCapabilities {
  /** Member of ADMIN_GROUP (e.g. `tichnun`). Full system access. */
  isAdmin: boolean;
  /** Platform role `naat_pniot_lakoach`. Routes inquiries. */
  isNavigator: boolean;
  /** Manager: ADMIN_GROUP **or** has any MANAGER_ROLE_KEYS (default `madr`). */
  isManager: boolean;
  /** Super team member: in KEVA_GROUP (default `keva`). */
  isKeva: boolean;

  groups: string[];
  /** Groups this user can route TO (intersection of TARGET_GROUPS and user.groups for keva; all for navigator/admin). */
  manageableGroups: string[];

  email: string;
  displayName: string;
  username: string;

  canRoute: boolean;
  canViewAll: boolean;
  canWriteTeamResponse: boolean;
  canWriteManagerResponse: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: BeastUser;
    beastToken?: string;
  }
}
