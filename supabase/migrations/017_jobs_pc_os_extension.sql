-- Sub-plano 04 (fluxo PC-OS), item 4: estende `jobs` (OS) com os campos que
-- faltam para o fluxo comercial-técnico e migra `employee_id` único para
-- `job_employees` (many-to-many), sem perda de dado.

-- ── Novos campos de OS ──────────────────────────────────────────────────────
-- `contract_id`/`number`: vínculo com a PC de origem e o número compartilhado
-- (a OS herda o número da PC quando o contrato é aceito, ver
-- 018_contracts_accept_reject.sql — não gera um número novo).
-- `bag_id`: mala de teste — FK para `bags` já existente (decisão de escopo:
-- seleção do cadastro, não texto livre). `notes` já existe na tabela original
-- (002_create_tables.sql) — não duplicado aqui.
alter table jobs
  add column if not exists contract_id uuid references contracts(id),
  add column if not exists number text,
  add column if not exists scope_detail text,
  add column if not exists bag_id uuid references bags(id),
  add column if not exists service_address text,
  add column if not exists client_contact_name text,
  add column if not exists client_contact_phone text;

-- ── `job_employees` (many-to-many) ──────────────────────────────────────────
create table if not exists job_employees (
  job_id uuid not null references jobs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, employee_id)
);

create index if not exists job_employees_employee_id_idx on job_employees(employee_id);

-- Migra todo job com employee_id único existente para uma linha em
-- job_employees, preservando o vínculo (nenhum dado perdido, nenhum
-- funcionário ganha ou perde acesso por causa da migração).
insert into job_employees (job_id, employee_id)
select id, employee_id from jobs
where employee_id is not null
on conflict do nothing;

-- `employee_id` deixa de ser obrigatório: passa a ser o assignee legado usado
-- pelo fluxo de provisionamento de ferramentas/checklist (create_job_with_
-- provisioning, ver 015_atomic_operations.sql — fora do escopo desta feature),
-- mantido por compatibilidade. A fonte de verdade para "quem está atribuído
-- à OS" no fluxo PC-OS é `job_employees`; as rotas de ownership (src/routes/
-- jobs.ts) agora checam as duas (legado + tabela nova) para não regredir o
-- achado de IDOR do sub-plano 01.
alter table jobs alter column employee_id drop not null;

-- OS criada automaticamente ao aceitar uma PC (item 3) nasce "esqueleto": só
-- número, contrato de origem e status — os campos operacionais (colaboradores,
-- máquina, data, escopo, endereço etc.) são preenchidos depois pelo gestor via
-- formulário estendido de OS (item 12 do plano, frontend). Por isso os campos
-- abaixo, antes obrigatórios, passam a aceitar NULL até serem preenchidos.
alter table jobs alter column machine_id drop not null;
alter table jobs alter column job_type drop not null;
alter table jobs alter column description drop not null;
alter table jobs alter column scheduled_date drop not null;
alter table jobs alter column city drop not null;
alter table jobs alter column state drop not null;
alter table jobs alter column start_time drop not null;
alter table jobs alter column end_time drop not null;
