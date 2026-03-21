-- Employees
create table employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text not null,
  role text not null check (role in ('employee', 'manager')),
  cnpj text,
  salary numeric(12, 2) not null check (salary > 0),
  hired_at date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Salary adjustments
create table salary_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  previous_salary numeric(12, 2) not null,
  new_salary numeric(12, 2) not null check (new_salary > 0),
  reason text not null,
  adjusted_at timestamptz default now()
);

-- Machines
create table machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  model text not null,
  serial_number text not null unique,
  year int not null,
  manual_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Machine manual chunks (RAG)
create table machine_chunks (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  content text not null,
  embedding vector(1024),
  chunk_index int not null
);

-- Contracts
create table contracts (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_cnpj text not null,
  description text not null,
  start_date date not null,
  end_date date not null,
  file_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Jobs
create table jobs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  machine_id uuid not null references machines(id),
  job_type text not null check (job_type in ('maintenance', 'implementation')),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  description text not null,
  scheduled_date date not null,
  city text not null,
  state char(2) not null,
  accommodation boolean not null default false,
  car boolean not null default false,
  start_time text not null,
  end_time text not null,
  notes text,
  report_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Job reports
create table job_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  content text not null,
  submitted_at timestamptz default now(),
  employee_id uuid not null references employees(id)
);

-- Evidences
create table evidences (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references job_reports(id) on delete cascade,
  url text not null,
  mime_type text not null,
  file_name text not null,
  type text not null check (type in ('image', 'pdf', 'video', 'audio'))
);

-- Transactions
create table transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('credit', 'debit')),
  amount numeric(12, 2) not null check (amount > 0),
  description text not null,
  category text not null,
  destination text,
  date date not null,
  created_at timestamptz default now()
);

-- Notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz default now()
);

-- FK: jobs → job_reports (after both tables exist)
alter table jobs add constraint jobs_report_id_fkey
  foreign key (report_id) references job_reports(id) on delete set null;
