-- Sub-plano 01 (épico ajustes-cliente-2026-09), item 1: revisão de decisão de
-- negócio — aceitar uma PC deixa de criar um Contrato automaticamente. A OS
-- (jobs) passa a se vincular DIRETO à PC (proposals) via `jobs.proposal_id`
-- (1:1) e ao cliente via `jobs.client_id` (não depende mais de resolver o
-- cliente através de um contrato intermediário). `proposals.contract_id`
-- deixa de significar "contrato criado no aceite desta PC" e passa a
-- significar "contrato grande (locação/recorrente) ao qual esta PC pertence,
-- quando o gestor escolhe vincular manualmente" — segue opcional e a coluna
-- já existia (021_proposals_split.sql), não muda de tipo.
--
-- Pendente de aplicação: ambiente sem Docker disponível para `supabase start`
-- local nesta sessão — migration escrita e revisada, mas não executada em
-- nenhum banco (nem local, nem remoto). Ver 031_limpeza_contratos_auto.sql
-- para o cleanup dos contratos criados pelo fluxo antigo (destrutiva, não
-- roda aqui).

-- ── `jobs.proposal_id` / `jobs.client_id` ───────────────────────────────────
alter table jobs
  add column if not exists proposal_id uuid unique references proposals(id),
  add column if not exists client_id uuid references clients(id);

-- Backfill: toda PC já aceita (proposals.job_id preenchido pelo accept_proposal
-- antigo) aponta pra OS que ela criou — grava o vínculo reverso que passa a
-- ser a fonte de verdade daqui pra frente.
update jobs j
set proposal_id = p.id
from proposals p
where p.job_id = j.id
  and j.proposal_id is null;

-- client_id: preferimos o cliente do contrato que a OS já carrega (fluxo
-- antigo, contrato criado automaticamente no aceite); se a OS não tem
-- contrato (ou o contrato não tem cliente), cai pro cliente da PC de origem
-- recém vinculada acima.
update jobs j
set client_id = c.client_id
from contracts c
where j.contract_id = c.id
  and j.client_id is null
  and c.client_id is not null;

update jobs j
set client_id = p.client_id
from proposals p
where j.proposal_id = p.id
  and j.client_id is null
  and p.client_id is not null;

-- ── `proposals.end_date` sai de cena ────────────────────────────────────────
-- A PC deixa de ter data final (só o Contrato/locação grande tem prazo). A
-- coluna `start_date` já era nullable no banco desde 021_proposals_split.sql
-- (só o Zod exigia as duas — corrigido em routes/proposals.ts junto desta
-- migration), então não precisa de ALTER aqui.
alter table proposals drop column if exists end_date;

-- ── `jobs.job_type`: 10 valores novos, valores legados viram NULL ──────────
-- Os slugs antigos ('maintenance', 'implementation') não têm mapeamento 1:1
-- pros novos tipos de serviço (decisão de produto) — dado histórico limitado
-- (poucos jobs de teste/homologação), a normalização é NULL em vez de tentar
-- adivinhar o novo valor.
update jobs
set job_type = null
where job_type is not null
  and job_type not in (
    'pre_commissioning', 'commissioning', 'pre_taf', 'taf', 'technical_visit',
    'field_survey', 'studies', 'bench_tests', 'energization_support', 'development'
  );

alter table jobs drop constraint if exists jobs_job_type_check;
alter table jobs add constraint jobs_job_type_check
  check (job_type is null or job_type in (
    'pre_commissioning', 'commissioning', 'pre_taf', 'taf', 'technical_visit',
    'field_survey', 'studies', 'bench_tests', 'energization_support', 'development'
  ));

-- ── `accept_proposal`: sem INSERT em contracts ──────────────────────────────
-- Só cria a OS, já vinculada (proposal_id/client_id/contract_id herdado da
-- PC quando ela já tem um contrato escolhido) — a PC nunca mais gera um
-- Contrato "esqueleto" sozinha.
create or replace function accept_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_proposal proposals%rowtype;
  v_job jobs%rowtype;
begin
  select * into v_proposal from proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id;
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal % is not pending (status=%)', p_proposal_id, v_proposal.status;
  end if;

  insert into jobs (
    proposal_id, client_id, contract_id, number, scheduled_date, scope_detail, status
  )
  values (
    v_proposal.id, v_proposal.client_id, v_proposal.contract_id, v_proposal.number,
    v_proposal.start_date, v_proposal.description, 'pending'
  )
  returning * into v_job;

  update proposals
  set status = 'accepted',
      job_id = v_job.id,
      updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'job', to_jsonb(v_job)
  );
end;
$$;

-- ── `accept_contract`: legado sem uso (rotas migraram pra accept_proposal em
-- 021_proposals_split.sql; confirmado sem referência em src/) ──────────────
drop function if exists accept_contract(uuid);

-- ── `create_job_with_provisioning`: passa a gravar os campos de vínculo
-- PC/Contrato/Cliente e os campos operacionais adicionados em
-- 017_jobs_pc_os_extension.sql que a função anterior (025) ainda ignorava ──
create or replace function create_job_with_provisioning(p_job jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_job jobs%rowtype;
  v_insufficient text[] := '{}';
  v_mt record;
begin
  insert into jobs (
    employee_id, machine_id, job_type, description, scheduled_date, city, state,
    accommodation, car, start_time, end_time, notes, address,
    car_pickup_time, car_return_time, car_pickup_address, os_code,
    contract_id, proposal_id, client_id, number, scheduled_end_date, scope_detail, bag_id
  )
  values (
    (p_job->>'employee_id')::uuid,
    (p_job->>'machine_id')::uuid,
    p_job->>'job_type',
    p_job->>'description',
    (p_job->>'scheduled_date')::date,
    p_job->>'city',
    p_job->>'state',
    coalesce((p_job->>'accommodation')::boolean, false),
    coalesce((p_job->>'car')::boolean, false),
    p_job->>'start_time',
    p_job->>'end_time',
    p_job->>'notes',
    p_job->>'address',
    p_job->>'car_pickup_time',
    p_job->>'car_return_time',
    p_job->>'car_pickup_address',
    p_job->>'os_code',
    (p_job->>'contract_id')::uuid,
    (p_job->>'proposal_id')::uuid,
    (p_job->>'client_id')::uuid,
    p_job->>'number',
    (p_job->>'scheduled_end_date')::date,
    p_job->>'scope_detail',
    (p_job->>'bag_id')::uuid
  )
  returning * into v_job;

  for v_mt in
    select mt.tool_id as tool_id, mt.quantity_required as quantity_required,
           t.name as tool_name, t.quantity as tool_quantity
    from machine_tools mt
    join tools t on t.id = mt.tool_id
    where mt.machine_id = v_job.machine_id
  loop
    if v_mt.tool_quantity < v_mt.quantity_required then
      v_insufficient := array_append(v_insufficient, v_mt.tool_name);
    end if;

    update tools
    set quantity = greatest(quantity - v_mt.quantity_required, 0), updated_at = now()
    where id = v_mt.tool_id;

    insert into job_checklists (job_id, employee_id, tool_id, phase)
    values (v_job.id, v_job.employee_id, v_mt.tool_id, 'pre_work');
  end loop;

  return jsonb_build_object(
    'job', to_jsonb(v_job),
    'insufficient_tools', to_jsonb(v_insufficient)
  );
end;
$$;
