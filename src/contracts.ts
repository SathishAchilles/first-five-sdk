/**
 * Wire contract between the First Five SDK and the First Five (Render) API.
 * The Render API must implement exactly these shapes; dev/mock-server.mjs is the
 * executable reference.
 */

export type Mode = 'setup' | 'live';

export type EventName =
  | 'ff_page_viewed'
  | 'ff_element_clicked'
  | 'ff_form_submitted'
  | 'ff_custom_event'
  | 'ff_element_discovered';

export interface CanonicalEvent {
  schema_version: 1;
  event_id: string;
  event_name: EventName;
  project_id: string;
  study_id: string | null;
  session_id: string | null;
  mode: Mode;
  client_sequence: number;
  client_timestamp: string;
  page_path: string;
  element_key?: string;
  element_type?: string;
  element_label?: string;
  form_key?: string;
  custom_name?: string;
  custom_props?: Record<string, string | number | boolean>;
}

/** GET /api/sdk/config?project_id= */
export interface SdkConfig {
  status: string;
  allowed_origins: string[];
  events_url: string;
  event_allowlist: EventName[];
  custom_event_allowlist: string[];
  max_batch_events: number;
  first_five_origin: string;
}

/** POST /api/sdk/exchange */
export interface ExchangeRequest {
  project_id: string;
  ticket: string;
  kind: Mode;
  sdk_version: string;
}

export interface ExchangeResponse {
  credential: string;
  expires_at: string;
  mode: Mode;
  session_id: string | null;
  study_id: string | null;
  task_text?: string;
  deadline_at?: string;
}

/** POST /api/sdk/events (Bearer credential, header X-FirstFive-SDK) */
export interface EventsRequest {
  batch_id: string;
  events: CanonicalEvent[];
}

export type GoalStatus = 'pending' | 'verified';

export interface EventsResponse {
  accepted: string[];
  rejected: { event_id: string; code: string }[];
  last_acked_sequence: number;
  /** Session-level, sent on every live ACK, evaluated inside the events transaction (C2). */
  goal_status?: GoalStatus;
}

/** POST /api/sessions/:id/end (Bearer) */
export interface EndRequest {
  reason: 'finish' | 'stuck';
  last_client_sequence: number;
}

export interface FeedbackHandoff {
  url: string;
  expires_at: string;
}

export interface EndResponse {
  outcome: 'completed' | 'dropped' | 'finalizing';
  /** Always present, even while the server holds its C3 grace window. */
  feedback_handoff: FeedbackHandoff;
}

/** POST /api/sdk/setup/finish (Bearer) */
export interface SetupFinishRequest {
  last_client_sequence: number;
}

export interface SetupFinishResponse {
  return_url: string;
}

export interface StoredCredential extends ExchangeResponse {
  project_id: string;
}
