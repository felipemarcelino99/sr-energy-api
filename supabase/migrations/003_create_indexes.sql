-- Fast vector similarity search por máquina
create index on machine_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Listagens comuns
create index on jobs (employee_id);
create index on jobs (status);
create index on jobs (scheduled_date);
create index on notifications (user_id, read);
create index on salary_adjustments (employee_id);
create index on evidences (report_id);
