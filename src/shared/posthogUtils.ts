import { sanitizeValueForEvent, sanitizeKeyForEvent } from './sanitize';
import { mapValueWithKeys } from './walk';

export const beforeSend =
  (isProd: boolean) =>
  (rawEvent: any): any => {
    if (rawEvent.event === '$pageview') {
      console.warn('Skipping pageview event');
      return null;
    }

    console.log('Sending event:', rawEvent);
    // This rips through our quota quickly, remove to save money on event cost
    if (rawEvent.event === '$pageview' && rawEvent.properties.page === 'splash') {
      return null;
    }

    const event = mapValueWithKeys(rawEvent, sanitizeValueForEvent, sanitizeKeyForEvent);

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

    return event;
  };
