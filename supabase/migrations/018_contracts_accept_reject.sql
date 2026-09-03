-- Sub-plano 04 (fluxo PC-OS), item 3: transição de status da PC (`contracts`)
-- e criação automática da OS (`jobs`) ao aceitar, dentro de uma única função
-- Postgres — mesmo padrão de RPC transacional do sub-plano 02
-- (create_job_with_provisioning, ver 015_atomic_operations.sql): se a criação
-- da OS falhar por qualquer motivo, o Postgres desfaz também a mudança de
-- status do contrato, nunca deixando um contrato "accepted" sem OS
-- correspondente.
--
-- `select ... for update` trava a linha do contrato durante a transição,
-- evitando que dois PATCH /accept concorrentes para o mesmo contrato criem
-- duas OS (o segundo encontra status já != 'pending' e falha).

create or replace function accept_contract(p_contract_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_contract contracts%rowtype;
  v_job jobs%rowtype;
begin
  select * into v_contract from contracts where id = p_contract_id for update;
  if not found then
    raise exception 'contract % not found', p_contract_id;
  end if;
  if v_contract.status <> 'pending' then
    raise exception 'contract % is not pending (status=%)', p_contract_id, v_contract.status;
  end if;

  update contracts set status = 'accepted', updated_at = now()
  where id = p_contract_id
  returning * into v_contract;

  -- A OS nasce com o MESMO número da PC (não chama next_document_number() de
  -- novo) — é a mesma numeração vista pelo cliente do início ao fim do fluxo.
  insert into jobs (contract_id, number, status)
  values (v_contract.id, v_contract.number, 'pending')
  returning * into v_job;

  return jsonb_build_object('contract', to_jsonb(v_contract), 'job', to_jsonb(v_job));
end;
$$;

create or replace function reject_contract(p_contract_id uuid)
returns contracts
language plpgsql
as $$
declare
  v_contract contracts%rowtype;
begin
  select * into v_contract from contracts where id = p_contract_id for update;
  if not found then
    raise exception 'contract % not found', p_contract_id;
  end if;
  if v_contract.status <> 'pending' then
    raise exception 'contract % is not pending (status=%)', p_contract_id, v_contract.status;
  end if;

  update contracts set status = 'rejected', updated_at = now()
  where id = p_contract_id
  returning * into v_contract;

  return v_contract;
end;
$$;
