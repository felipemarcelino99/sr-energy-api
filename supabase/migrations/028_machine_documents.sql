-- Fix: GET/POST/DELETE /machines/:id/documents e /machines/:id/manual sempre
-- respondiam 500 (Could not find the table 'public.machine_documents' in the
-- schema cache) — a rota (src/routes/machines.ts) usa essa tabela desde antes
-- de qualquer migration que a criasse. Colunas replicadas exatamente do uso
-- no código: id, machine_id, filename, pdf_hash, url, created_at.

create table machine_documents (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  filename text not null,
  pdf_hash text not null,
  url text not null default '',
  created_at timestamptz not null default now()
);

create index machine_documents_machine_idx on machine_documents (machine_id, created_at desc);
create unique index machine_documents_machine_hash_idx on machine_documents (machine_id, pdf_hash);

alter table machine_documents enable row level security;

create policy "machine_documents_authenticated_select" on machine_documents for select
  using (auth.role() = 'authenticated');

create policy "machine_documents_manager_admin_write" on machine_documents for all
  using (exists (
    select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'manager')
  ));
