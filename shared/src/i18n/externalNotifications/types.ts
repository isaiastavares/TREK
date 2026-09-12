/**
 * `{appName}` is substituted at render time with the name the instance goes by
 * (server/src/app-config deriveBrand → 'TREK' unless a managed operator has set
 * APP_NAME). A locale that still spells the name out renders it literally, so a
 * translation lagging behind is stale wording, never a broken mail.
 */
export interface EmailStrings {
  footer: string;
  manage: string;
  madeWith: string;
  openTrek: string;
}

export interface EventText {
  title: string;
  body: string;
}

export type EventTextFn = (params: Record<string, string>) => EventText;

/** `body` carries the `{appName}` placeholder — see EmailStrings above. */
export interface PasswordResetStrings {
  subject: string;
  greeting: string;
  body: string;
  ctaIntro: string;
  expiry: string;
  ignore: string;
}

export type NotificationEventKey =
  | 'trip_invite'
  | 'booking_change'
  | 'trip_reminder'
  | 'todo_due'
  | 'vacay_invite'
  | 'vacay_share'
  | 'collection_invite'
  | 'photos_shared'
  | 'collab_message'
  | 'packing_tagged'
  | 'version_available'
  | 'replica_failure'
  | 'synology_session_cleared'
  | 'plugin_notification';

export interface NotificationLocale {
  email: EmailStrings;
  events: Record<NotificationEventKey, EventTextFn>;
  passwordReset: PasswordResetStrings;
}
