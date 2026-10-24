/**
 * Wire contract between the First Five SDK and the First Five (Render) API, contract version 1.
 * Source of truth: packages/sdk-contract in github.com/Hasmitha0498/first-five.
 * dev/mock-server.mjs is a local executable copy of that contract.
 */

export type Mode = 'setup' | 'live';

export type EventName =
  | 'ff_page_viewed'
  | 'ff_element_clicked'
  | 'ff_form_submitted'
  | 'ff_custom_event'
  | 'ff_element_discovered';

export type ElementType =
  'button' | 'link' | 'submit' | 'role_button' | 'form' | 'custom' | 'other';

/** One event exactly as POSTed (the server schema is strict: no extra keys). */
export interface CanonicalEvent {
  schema_version: 1;
  event_id: string;
  event_name: EventName;
  project_id: string;
  /** Live mode only; omitted in setup mode. */
  study_id?: string;
  /** Live mode only; omitted in setup mode. */
  session_id?: string;
  mode: Mode;
  client_sequence: number;
  timestamp: string;
  page_path?: string;
  element_id?: string;
  element_type?: ElementType;
  element_label?: string;
  custom_event_name?: string;
  properties?: Record<string, string | number | boolean>;
}

/** GET /api/sdk/config?project_id=&sdk_version= */
export interface SdkConfigResponse {
  project_id: string;
  status: 'active';
  contract_version: 1;
  api_base_url: string;
  allowed_origins: string[];
  event_allowlist: string[];
  allowed_custom_events: string[];
  limits: { maxEventsPerBatch: number; [key: string]: number };
  /** Optional additive field; falls back to the origin of api_base_url. */
  first_five_origin?: string;
}

/** Normalised config used inside the SDK. */
export interface SdkConfig {
  status: string;
  apiBaseUrl: string;
  allowed_origins: string[];
  event_allowlist: string[];
  custom_event_allowlist: string[];
  max_batch_events: number;
  first_five_origin: string;
}

/** POST /api/sdk/exchange */
export interface ExchangeRequest {
  project_id: string;
  ticket: string;
  sdk_version: string;
}

export interface ExchangeResponse {
  credential: string;
  mode: Mode;
  expires_at: string;
  project_id: string;
  study?: {
    study_id: string;
    session_id: string;
    task: string;
    deadline_at: string;
    goal_type: 'element_clicked' | 'page_reached' | 'custom_event';
  };
  setup?: { setup_session_id: string; expires_at: string };
}

/** POST /api/sdk/events (Bearer credential) */
export interface EventsRequest {
  schema_version: 1;
  sdk_version: string;
  events: CanonicalEvent[];
}

export type SessionStatus = 'pending' | 'completed' | 'dropped' | 'invalid';
export type GoalStatus = 'pending' | 'verified';

export interface EventsResponse {
  accepted: string[];
  /** Already stored earlier: acknowledged, never retried. */
  duplicates: string[];
  rejected: { event_id: string | null; code: string; message: string }[];
  /** Live mode only: goal state after this batch committed (evaluated in the same transaction, C2). */
  goal: { verified: boolean; verified_event_id: string | null } | null;
  session_status: SessionStatus | null;
}

/** POST /api/sdk/session/end (Bearer) */
export interface EndRequest {
  reason: 'finished' | 'gave_up';
  /** C3: highest client_sequence the SDK assigned; lets the server wait for late events. */
  last_client_sequence: number;
}

export interface EndResponse {
  session_status: SessionStatus;
  final_reason: string | null;
  /** First Five URL with a one-time feedback handoff; null when no feedback is offered. */
  feedback_url: string | null;
}

/** POST /api/sdk/setup/finish (Bearer) */
export interface SetupFinishRequest {
  last_client_sequence: number;
}

export interface SetupFinishResponse {
  status: 'finished';
  /** Optional additive field; the SDK falls back to `${first_five_origin}/app/websites`. */
  return_url?: string;
}

export interface SdkErrorResponse {
  error: { code: string; message: string };
}

/** Credential plus the live/setup context, flattened for the SDK and kept in sessionStorage. */
export interface StoredCredential {
  credential: string;
  expires_at: string;
  mode: Mode;
  project_id: string;
  session_id: string | null;
  study_id: string | null;
  task_text?: string;
  deadline_at?: string;
}
