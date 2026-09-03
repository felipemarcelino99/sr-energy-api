-- Google Calendar integration
alter table employees add column google_refresh_token text;
alter table schedule_events add column google_event_id text;
alter table schedule_event_employees add column google_event_id text;
