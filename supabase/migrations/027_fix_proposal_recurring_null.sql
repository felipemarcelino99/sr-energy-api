-- Fix: accept_proposal falhava com 500 (null value in column "recurring" of
-- relation "contracts" violates not-null constraint) quando a proposta tinha
-- recurring = null (campo era opcional no Zod). Normaliza dados legados e
-- fecha a coluna como NOT NULL DEFAULT false, coerente com o novo default no
-- Zod (src/routes/proposals.ts). Corpo da função replicado de
-- 021_proposals_split.sql:100-146, só trocando v_proposal.recurring por
-- coalesce(v_proposal.recurring, false) na linha 123 original.

update proposals set recurring = false where recurring is null;
alter table proposals alter column recurring set default false;
alter table proposals alter column recurring set not null;

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
    v_proposal.contract_value, coalesce(v_proposal.recurring, false), v_proposal.start_date,
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
