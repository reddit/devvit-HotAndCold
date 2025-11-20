import { sanitizeValueForEvent, sanitizeKeyForEvent } from './sanitize';
import { mapValueWithKeys } from './walk';
import { sampleByDistinctId } from 'posthog-js/lib/src/customizations';
import { sampleOnProperty } from 'posthog-js/lib/src/extensions/sampling';

const SAMPLE_RATE = 0.05;

export const shouldSampleUser = (distinctId: string): boolean => {
  return sampleOnProperty(distinctId, SAMPLE_RATE);
};

export const beforeSend =
  (isProd: boolean) =>
  (rawEvent: any): any => {
    // Only sample in production
    const sampledEvent = isProd ? sampleByDistinctId(SAMPLE_RATE)(rawEvent) : rawEvent;
    if (sampledEvent === null) return null;

    if (sampledEvent.event === '$pageview' && !sampledEvent.properties.page) {
      return null;
    }

    // This rips through our quota quickly, remove to save money on event cost
    if (sampledEvent.event === '$pageview' && sampledEvent.properties.page === 'splash') {
      return null;
    }

    if (
      filterExceptionEvent(sampledEvent, (event) =>
        event.properties.$exception_values.some((x) => x.toLowerCase().includes('abort'))
      )
    ) {
      return null;
    }

    const event = mapValueWithKeys(sampledEvent, sanitizeValueForEvent, sanitizeKeyForEvent);

    const eventString = JSON.stringify(event);
    if (
      eventString.includes('webbit_token') ||
      // webbitToken in context
      eventString.includes('webbitToken') ||
      // best effort
      eventString.includes('token=ey') ||
      eventString.includes('token:ey') ||
      (eventString.includes('t2_') && !eventString.includes('t2_xxx'))
    ) {
      // don't show the event data
      console.warn('Skipping event due to malformed data:', !isProd ? event : event?.event);
      return null;
    }

    // console.log('Sending event:', rawEvent);

    return event;
  };

/** Example raw frame metadata collected by PostHog. */
type RawStackFrame = {
  /** 110154 */
  colno: number;
  /** https://syllo-app-evua8s-0-0-87-webview.devvit.net/index.js */
  filename: string;
  /** ? */
  function: string;
  /** true */
  in_app: boolean;
  /** 72 */
  lineno: number;
  /** false */
  synthetic: boolean;
};

/** PostHog junk drawer metadata wrapper. */
type StackFrameJunkDrawer = {
  /** {"colno":110154,"filename":"https://syllo-app-evua8s-0-0-87-webview.devvit.net/index.js",...} */
  raw_frame: RawStackFrame;
};

/** Example stack frame for a PostHog exception. */
type StackFrame = {
  /** 0e20b87d7906b22488c1fe3a536af14797d9f6717efdf1845134f639754fc994c8102ad96eb6f8769011ecc57fa2e4052d9c7371bd0301ad5ddf49437cbfaf60/0 */
  raw_id: string;
  /** ? */
  mangled_name: string;
  /** 0 */
  line: number;
  /** 87496 */
  column: number;
  /** ../../node_modules/posthog-js/dist/module.js */
  source: string;
  /** false */
  in_app: boolean;
  /** Js */
  resolved_name: string;
  /** javascript */
  lang: string;
  /** true */
  resolved: boolean;
  /** false */
  synthetic: boolean;
  /** false */
  suspicious: boolean;
  /** {"raw_frame":{"filename":"https://syllo-app-evua8s-0-0-87-webview.devvit.net/index.js",...}} */
  junk_drawer: StackFrameJunkDrawer;
};

/** Example stacktrace metadata recorded for an exception. */
type Stacktrace = {
  /** resolved */
  type: string;
  /** Array of stack frames */
  frames: StackFrame[];
};

/** Mechanism metadata returned by PostHog. */
type ExceptionMechanism = {
  /** true */
  handled: boolean;
  /** generic */
  type: string;
  /** false */
  synthetic: boolean;
};

/** Example PostHog exception list entry. */
type ExceptionListEntry = {
  /** 019a5e60-6257-7680-bbd3-837f711abd41 */
  id: string;
  /** TRPCClientError */
  type: string;
  /** Failed to fetch */
  value: string;
  /** Mechanism metadata */
  mechanism: ExceptionMechanism;
  /** Stacktrace metadata */
  stacktrace: Stacktrace;
};

/** Example fingerprint record for an exception. */
type ExceptionFingerprintRecord = {
  /** exception */
  type: string;
  /** 019a5e60-6257-7680-bbd3-837f711abd41 */
  id?: string;
  /** 0e20b87d7906b22488c1fe3a536af14797d9f6717efdf1845134f639754fc994c8102ad96eb6f8769011ecc57fa2e4052d9c7371bd0301ad5ddf49437cbfaf60/0 */
  raw_id?: string;
  /** ["Exception Type"] */
  pieces: string[];
};

/** Full set of exception properties emitted by PostHog. */
type ExceptionEventProperties = {
  /** Array of exception entries */
  $exception_list: ExceptionListEntry[];
  /** 6b1452a9be563873682129837624514a64a86139bae7c42f22310fc32c8a560dbc308ec3f28316b72fe130ae3374bdee3f02edbeda6a36f7b296bd562d2a33d7 */
  $exception_fingerprint: string;
  /** 6b1452a9be563873682129837624514a64a86139bae7c42f22310fc32c8a560dbc308ec3f28316b72fe130ae3374bdee3f02edbeda6a36f7b296bd562d2a33d7 */
  $exception_proposed_fingerprint: string;
  /** [{"type":"exception","id":"019a5e60-6257-7680-bbd3-837f711abd41",...}] */
  $exception_fingerprint_record: ExceptionFingerprintRecord[];
  /** 0199e7be-3afd-7340-b54f-4c3c0c82c80c */
  $exception_issue_id: string;
  /** 401 */
  $viewport_width: number;
  /** 0.0.87 */
  app_version: string;
  /** Asia/Calcutta */
  $timezone: string;
  /** https://syllo-app-evua8s-0-0-87-webview.devvit.net/index.html?context=xxx */
  $current_url: string;
  /** 9dc45723658e9274d181f2f4d30e3b26e75ac814d5f6d1c5046e808dea2e6967 */
  $user_id: string;
  /** query */
  kind: string;
  /** America/New_York */
  $geoip_time_zone: string;
  /** https://syllo-app-evua8s-0-0-87-webview.devvit.net/index.html?context=xxx */
  $session_entry_url: string;
  /** 2025-05-24 */
  $config_defaults: string;
  /** Android */
  $device: string;
  /** Mobile */
  $device_type: string;
  /** 019a5e5f-7935-79bc-bf4a-cdc11404fa82 */
  $pageview_id: string;
  /** NA */
  $geoip_continent_code: string;
  /** $direct */
  $session_entry_referring_domain: string;
  /** false */
  $exception_capture_enabled_server_side: boolean;
  /** 1800000 */
  $configured_session_timeout_ms: number;
  /** US */
  $geoip_country_code: string;
  /** 34.138.223.73 */
  $ip: string;
  /** 141 */
  $browser_version: number;
  /** $direct */
  $referring_domain: string;
  /** 965 */
  $screen_height: number;
  /** en */
  $browser_language_prefix: string;
  /** 434 */
  $screen_width: number;
  /** 29415 */
  $geoip_postal_code: string;
  /** Mozilla/5.0 (Linux; Android 16; motorola edge 50 pro Build/W1UM36H.19-13-4; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36 */
  $raw_user_agent: string;
  /** 019a5e5f-78ea-7785-a388-a46dc5f05c94 */
  $session_id: string;
  /** react-query */
  source: string;
  /** null */
  $replay_minimum_duration: number | null;
  /** 2025-11-07T12:51:46.533Z */
  $initialization_time: string;
  /** $direct */
  $session_entry_referrer: string;
  /** 0 */
  $sdk_debug_replay_internal_buffer_size: number;
  /** {} */
  $session_recording_canvas_recording: Record<string, unknown>;
  /** web */
  $lib: string;
  /** null */
  $replay_sample_rate: number | null;
  /** syllo-app-evua8s-0-0-87-webview.devvit.net */
  $host: string;
  /** disabled */
  $recording_status: string;
  /** phc_mx9qeMfnLBzl5tc7dKXpjDD6DRWBNlQsccFqrYVzQxe */
  token: string;
  /** https://syllo-app-evua8s-0-0-87-webview.devvit.net/api/collect */
  $lib_custom_api_host: string;
  /** Android */
  $os: string;
  /** United States */
  $geoip_country_name: string;
  /** 2 */
  $sdk_debug_retry_queue_size: number;
  /** false */
  $autocapture_disabled_server_side: boolean;
  /** 1762519906.741 */
  $time: number;
  /** 1762519906538 */
  $sdk_debug_session_start: number;
  /** /index.html */
  $session_entry_pathname: string;
  /** North America */
  $geoip_continent_name: string;
  /** 9dc45723658e9274d181f2f4d30e3b26e75ac814d5f6d1c5046e808dea2e6967 */
  distinct_id: string;
  /** [["isAdmin"],{"type":"query"}] */
  queryHash: string;
  /** t3_1oqsih5 */
  post_id: string;
  /** syllo-app */
  app_name: string;
  /** null */
  $sdk_debug_current_session_duration: number | null;
  /** {} */
  $session_recording_network_payload_capture: Record<string, unknown>;
  /** -330 */
  $timezone_offset: number;
  /** 019a5e5f-78eb-77eb-8173-8e773673e52a */
  $window_id: string;
  /** $direct */
  $referrer: string;
  /** [["isAdmin"],{"type":"query"}] */
  queryKey: string;
  /** true */
  $is_identified: boolean;
  /** false */
  $web_vitals_enabled_server_side: boolean;
  /** Chrome */
  $browser: string;
  /** 019a5e5f-78f1-74a2-8a68-fcc4620ae612 */
  $device_id: string;
  /** 45x8228f607zrm7p */
  $insert_id: string;
  /** 512 */
  $viewport_height: number;
  /** en-US */
  $browser_language: string;
  /** 0 */
  $sdk_debug_replay_internal_buffer_length: number;
  /** North Charleston */
  $geoip_city_name: string;
  /** /index.html */
  $pathname: string;
  /** syllo-app-evua8s-0-0-87-webview.devvit.net */
  $session_entry_host: string;
  /** true */
  $process_person_profile: boolean;
  /** 120 */
  puzzle_number: number;
  /** error */
  $exception_level: string;
  /** 1.268.4 */
  $lib_version: string;
  /** 95.69 */
  $lib_rate_limit_remaining_tokens: number;
  /** true */
  $exception_handled: boolean;
  /** ["TRPCClientError","TypeError"] */
  $exception_types: string[];
  /** ["Failed to fetch"] */
  $exception_values: string[];
  /** ["../../src/devvit.v1.ts"] */
  $exception_sources: string[];
  /** ["<anonymous>"] */
  $exception_functions: string[];
};

/** PostHog exception event shape. */
type ExceptionEvent = {
  /** 019a5e5f-79b4-73c8-b875-90b9de55a504 */
  uuid: string;
  /** $exception */
  event: string;
  /** {"$exception_list":[{"id":"019a5e60-6257-7680-bbd3-837f711abd41",...}]} */
  properties: ExceptionEventProperties;
  /** 2025-11-07T12:51:58.326000Z */
  timestamp: string;
  /** 225882 */
  team_id: number;
  /** 9dc45723658e9274d181f2f4d30e3b26e75ac814d5f6d1c5046e808dea2e6967 */
  distinct_id: string;
  /** "" */
  elements_chain: string;
  /** 2025-11-07T12:52:46.240000Z */
  created_at: string;
  /** full */
  person_mode: string;
};

function filterExceptionEvent(
  event: ExceptionEvent,
  predicate: (event: ExceptionEvent) => boolean
) {
  return event.event === '$exception' && predicate(event);
}
