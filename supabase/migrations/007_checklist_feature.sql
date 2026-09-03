-- Tools
create table tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Machine tools (N:N)
create table machine_tools (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  tool_id uuid not null references tools(id) on delete cascade,
  quantity_required integer not null default 1 check (quantity_required > 0),
  unique (machine_id, tool_id)
);

-- Job checklists
create table job_checklists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  tool_id uuid not null references tools(id),
  checked boolean not null default false,
  checked_at timestamptz,
  phase text not null default 'pre_work' check (phase in ('pre_work', 'pre_report')),
  created_at timestamptz default now()
);

-- RLS
alter table tools enable row level security;
alter table machine_tools enable row level security;
alter table job_checklists enable row level security;

create policy "authenticated_tools" on tools for all using (auth.role() = 'authenticated');
create policy "authenticated_machine_tools" on machine_tools for all using (auth.role() = 'authenticated');
create policy "authenticated_job_checklists" on job_checklists for all using (auth.role() = 'authenticated');
