import type { SdkConfig } from './contracts';
import { request } from './http';

export interface ScriptSettings {
  projectId: string | null;
  endpoint: string | null;
}

/** Read data-* attributes from the loading script. Must be given the script captured at load time. */
export function readScriptSettings(script: HTMLScriptElement | null): ScriptSettings {
  if (!script) return { projectId: null, endpoint: null };
  const projectId = script.getAttribute('data-project-id');
  let endpoint = script.getAttribute('data-endpoint');
  if (!endpoint && script.src) {
    try {
      endpoint = new URL(script.src, window.location.href).origin;
    } catch {
      endpoint = null;
    }
  }
  return { projectId, endpoint };
}

export async function fetchConfig(endpoint: string, projectId: string): Promise<SdkConfig | null> {
  try {
    const res = await request<SdkConfig>(
      `${endpoint}/api/sdk/config?project_id=${encodeURIComponent(projectId)}`,
    );
    return res.status === 200 && res.body ? res.body : null;
  } catch {
    return null;
  }
}

export function originAllowed(config: SdkConfig, origin: string): boolean {
  return config.allowed_origins.includes(origin);
}
