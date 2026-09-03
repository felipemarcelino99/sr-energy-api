-- Sub-plano 04 (fluxo PC-OS), revisão de decisão de negócio: a Proposta
-- Comercial (PC) deixa de ser uma linha de `contracts` com `status` (ver
-- 016_contracts_pc_extension.sql / 018_contracts_accept_reject.sql) e passa a
-- ser uma entidade própria (`proposals`). Aceitar uma PC agora CRIA um
-- Contrato novo E uma OS nova (não transforma a própria linha) — a PC
-- permanece imutável como registro histórico da negociação.

-- ── Tabela `proposals` ───────────────────────────────────────────────────────
-- Espelha os campos comerciais que hoje vivem em `contracts` (client_id,
-- description, contract_type, contract_value, recurring, start_date,
-- end_date, file_url — ver 002_create_tables.sql, 012_missing_columns.sql,
-- 014_clients.sql) + `status` (mesmo domínio de 016_contracts_pc_extension.sql)
-- + os vínculos preenchidos só na aceitação (`contract_id`, `job_id`).
--
-- `number` reaproveita o gerador atômico `next_document_number()` (mesma
-- função de 016_contracts_pc_extension.sql) — a numeração AAXXX nasce na PC e
-- é copiada explicitamente para o Contrato/OS na hora de aceitar (accept_proposal
-- abaixo), não gerada de novo.
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  number text unique default next_document_number(),
  client_id uuid references clients(id),
  description text,
  contract_type text check (contract_type in ('service', 'rental')),
  contract_value numeric,
  recurring boolean,
  start_date date,
  end_date date,
  file_url text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  contract_id uuid references contracts(id),
  job_id uuid references jobs(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Migração de dados existentes de `contracts` ──────────────────────────────
-- Hoje `contracts` mistura PC (status pending/rejected — nunca virou contrato
-- de verdade) e contrato real (status accepted — já tem OS provisionada). O
-- bloco abaixo separa as duas coisas mantendo o histórico de numeração.

-- 1) PCs ainda não aceitas ou recusadas: viram `proposals` puras, saem de
--    `contracts` (não são um contrato de verdade). Idempotente via
--    `where not exists` — reexecução não duplica.
insert into proposals (
  id, number, client_id, description, contract_type, contract_value,
  recurring, start_date, end_date, file_url, status, created_at, updated_at
)
select
  c.id, c.number, c.client_id, c.description, c.contract_type, c.contract_value,
  c.recurring, c.start_date, c.end_date, c.file_url, c.status, c.created_at, c.updated_at
from contracts c
where c.status in ('pending', 'rejected')
  and not exists (select 1 from proposals p where p.id = c.id);

delete from contracts
where status in ('pending', 'rejected');

-- 2) PCs já aceitas: a linha em `contracts` permanece como o contrato real
--    (não é removida). Cria-se uma linha espelho em `proposals`, já
--    `status = 'accepted'`, apontando `contract_id` para essa mesma linha de
--    `contracts` e `job_id` resolvido pela OS que o fluxo antigo
--    (accept_contract, ver 018_contracts_accept_reject.sql) criou com
--    `contract_id = contracts.id` (exatamente uma OS por contrato aceito,
--    dado o fluxo vigente até aqui). Idempotente via `where not exists`.
insert into proposals (
  id, number, client_id, description, contract_type, contract_value,
  recurring, start_date, end_date, file_url, status, contract_id, job_id,
  created_at, updated_at
)
select
  c.id, c.number, c.client_id, c.description, c.contract_type, c.contract_value,
  c.recurring, c.start_date, c.end_date, c.file_url, c.status, c.id,
  (select j.id from jobs j where j.contract_id = c.id limit 1),
  c.created_at, c.updated_at
from contracts c
where c.status = 'accepted'
  and not exists (select 1 from proposals p where p.id = c.id);

-- ── `contracts` deixa de carregar o conceito de PC ──────────────────────────
alter table contracts drop column if exists status;

-- Contratos manuais/locação (criados direto, sem passar por PC) passam a não
-- ter número automático — só quem nasce de uma PC aceita recebe `number`,
-- copiado explicitamente em `accept_proposal` abaixo. A coluna permanece
-- (histórico e contratos já numerados não são afetados), só o auto-gerar sai.
alter table contracts alter column number drop default;

-- ── `accept_proposal` / `reject_proposal` ────────────────────────────────────
-- Substituem `accept_contract`/`reject_contract` (018_contracts_accept_reject.sql)
-- para o novo fluxo: aceitar uma PC CRIA um Contrato novo e uma OS nova (a PC
-- em si nunca muda de tabela, só de `status` + os vínculos). Mesmo padrão de
-- `for update` + transação implícita da função: se a criação do Contrato ou
-- da OS falhar, a atualização de `status` da proposta é desfeita junto — nunca
-- fica uma PC "accepted" sem Contrato/OS correspondente.
--
-- As funções antigas `accept_contract`/`reject_contract` são deixadas como
-- estão no banco (não são mais chamadas pelas rotas, mas não há necessidade
-- de DROP FUNCTION aqui).
create or replace function accept_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_proposal proposals%rowtype;
  v_contract contracts%rowtype;
  v_job jobs%rowtype;
begin
  select * into v_proposal from proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id;
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal % is not pending (status=%)', p_proposal_id, v_proposal.status;
  end if;

  insert into contracts (
    client_id, description, contract_type, contract_value, recurring,
    start_date, end_date, file_url, number
  )
  values (
    v_proposal.client_id, v_proposal.description, v_proposal.contract_type,
    v_proposal.contract_value, v_proposal.recurring, v_proposal.start_date,
    v_proposal.end_date, v_proposal.file_url, v_proposal.number
  )
  returning * into v_contract;

  insert into jobs (contract_id, number, status)
  values (v_contract.id, v_contract.number, 'pending')
  returning * into v_job;

  update proposals
  set status = 'accepted',
      contract_id = v_contract.id,
      job_id = v_job.id,
      updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'contract', to_jsonb(v_contract),
    'job', to_jsonb(v_job)
  );
end;
$$;

create or replace function reject_proposal(p_proposal_id uuid)
returns proposals
language plpgsql
as $$
declare
  v_proposal proposals%rowtype;
begin
  select * into v_proposal from proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id;
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal % is not pending (status=%)', p_proposal_id, v_proposal.status;
  end if;

  update proposals set status = 'rejected', updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  return v_proposal;
end;
$$;
