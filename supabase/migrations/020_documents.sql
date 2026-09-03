-- Sub-plano 04 (fluxo PC-OS), itens 6/7: abstração `documents` que cobre tanto
-- relatório gerado no portal (`storage_kind = 'internal'`, arquivo em bucket
-- Supabase) quanto acervo legado vinculado do Drive (`storage_kind =
-- 'drive_link'`, só a URL — controle de acesso é do Drive, não deste sistema).
--
-- `note` é obrigatório só para `drive_link` (motivo/contexto do vínculo,
-- exigido pela PRD); para `internal` é opcional (rótulo livre).

create table documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('contract', 'job')),
  entity_id uuid not null,
  storage_kind text not null check (storage_kind in ('internal', 'drive_link')),
  bucket text,
  path text,
  drive_url text,
  note text,
  label text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint documents_storage_kind_fields check (
    (storage_kind = 'internal' and bucket is not null and path is not null and drive_url is null)
    or
    (storage_kind = 'drive_link' and drive_url is not null and note is not null and bucket is null and path is null)
  )
);

create index documents_entity_idx on documents (entity_type, entity_id, created_at desc);

alter table documents enable row level security;

create policy "documents_authenticated_select" on documents for select
  using (auth.role() = 'authenticated');

create policy "documents_manager_admin_write" on documents for insert
  with check (exists (
    select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'manager')
  ));

-- Documento vinculado é histórico permanente (mesma lógica de append-only do
-- audit-log, item 5): nunca é editado ou removido, só substituído por um novo
-- vínculo se necessário. Reforçado por privilégio de banco, não só pela
-- ausência de rota de update/delete na API.
revoke update, delete on documents from service_role, authenticated, anon, public;
grant select, insert on documents to service_role;
