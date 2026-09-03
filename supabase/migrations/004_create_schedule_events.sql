-- Schedule Events
create table schedule_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('day_off', 'vacation', 'training', 'medical_leave')),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  start_date date not null,
  end_date date not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint schedule_events_dates_check check (end_date >= start_date)
);

-- Junction table: schedule_event ↔ employees (many-to-many)
create table schedule_event_employees (
  schedule_event_id uuid not null references schedule_events(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  primary key (schedule_event_id, employee_id)
);

-- Indexes
create index schedule_events_start_date_idx on schedule_events(start_date);
create index schedule_events_end_date_idx on schedule_events(end_date);
create index schedule_event_employees_employee_id_idx on schedule_event_employees(employee_id);
