import { normalizeConfig, readScriptSettings } from '../../src/config';
import type { SdkConfigResponse } from '../../src/contracts';

function script(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

describe('snippet attributes', () => {
  it('reads the First Five snippet attributes', () => {
    const s = script({
      'data-firstfive-project': 'ffp_demo0001',
      'data-firstfive-api': 'https://first-five.onrender.com',
      src: 'https://unpkg.com/@firstfive/sdk/dist/firstfive.iife.min.js',
    });
    expect(readScriptSettings(s)).toEqual({
      projectId: 'ffp_demo0001',
      endpoint: 'https://first-five.onrender.com',
    });
  });

  it('keeps the 0.1.x names as aliases and defaults the endpoint to the script origin', () => {
    const s = script({
      'data-project-id': 'ffp_demo0001',
      src: 'https://api.example.com/sdk/v1/firstfive.js',
    });
    expect(readScriptSettings(s)).toEqual({
      projectId: 'ffp_demo0001',
      endpoint: 'https://api.example.com',
    });
  });
});

describe('config normalisation', () => {
  const body: SdkConfigResponse = {
    project_id: 'ffp_demo0001',
    status: 'active',
    contract_version: 1,
    api_base_url: 'https://first-five.onrender.com/',
    allowed_origins: ['https://shop.example'],
    event_allowlist: ['ff_page_viewed'],
    allowed_custom_events: [],
    limits: { maxEventsPerBatch: 50 },
  };

  it('derives first_five_origin from api_base_url and maps limits', () => {
    const c = normalizeConfig(body, 'https://x.test');
    expect(c.apiBaseUrl).toBe('https://first-five.onrender.com');
    expect(c.first_five_origin).toBe('https://first-five.onrender.com');
    expect(c.max_batch_events).toBe(50);
    expect(c.custom_event_allowlist).toEqual([]);
  });

  it('prefers an explicit first_five_origin', () => {
    expect(
      normalizeConfig({ ...body, first_five_origin: 'https://app.test' }, '').first_five_origin,
    ).toBe('https://app.test');
  });
});
