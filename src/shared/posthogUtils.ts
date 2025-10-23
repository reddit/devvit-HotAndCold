import { sanitizeValueForEvent, sanitizeKeyForEvent } from './sanitize';
import { mapValueWithKeys } from './walk';
import { sampleByDistinctId } from 'posthog-js/lib/src/customizations';

const SAMPLE_RATE = 0.3;

export const beforeSend =
  (isProd: boolean) =>
  (rawEvent: any): any => {
    // Only sample in production
    const sampledEvent = isProd ? sampleByDistinctId(SAMPLE_RATE)(rawEvent) : rawEvent;
    if (sampledEvent === null) return null;

    if (sampledEvent.event === '$pageview' && !sampledEvent.properties.page) {
      console.warn('Skipping pageview event due to no page property', sampledEvent);
      return null;
    }

    // This rips through our quota quickly, remove to save money on event cost
    if (sampledEvent.event === '$pageview' && sampledEvent.properties.page === 'splash') {
      return null;
    }

    const event = mapValueWithKeys(sampledEvent, sanitizeValueForEvent, sanitizeKeyForEvent);

    const eventString = JSON.stringify(event);
    if (
      eventString.includes('webbit_token') ||
      // webbitToken in context
      eventString.includes('webbitToken') ||
      (eventString.includes('t2_') && !eventString.includes('t2_xxx'))
    ) {
      // don't show the event data
      console.warn('Skipping event due to malformed data:', !isProd ? event : event?.event);
      return null;
    }

    // console.log('Sending event:', rawEvent);

    return event;
  };
