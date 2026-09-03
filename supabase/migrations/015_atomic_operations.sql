-- Sub-plano 02 (qualidade backend): elimina race conditions e registros órfãos
-- causados por operações multi-step feitas via read-modify-write no lado da
-- aplicação. Move as operações críticas para funções Postgres (RPC via
-- supabase-js `.rpc()`), que rodam dentro de uma única transação implícita e
-- usam UPDATE atômico (row-level lock) para o ajuste de estoque.

-- ── 1/9. Ajuste atômico de estoque de ferramenta ────────────────────────────
-- Usado tanto para consumir quanto para restaurar estoque (delta negativo ou
-- positivo). Um único UPDATE por chamada é atômico em relação a chamadas
-- concorrentes: o Postgres serializa via row-level lock, então não há mais
-- janela entre "ler quantity" e "escrever quantity" (a causa da corrupção).
-- Clampa em 0 (mesmo comportamento do código anterior: nunca deixa estoque
-- negativo, e não bloqueia a criação de job por estoque insuficiente — isso é
-- só sinalizado para o usuário via insufficient_tools).
create or replace function adjust_tool_stock(p_tool_id uuid, p_delta integer)
returns integer
language plpgsql
as $$
declare
  v_quantity integer;
begin
  update tools
  set quantity = greatest(quantity + p_delta, 0),
      updated_at = now()
  where id = p_tool_id
  returning quantity into v_quantity;

  if not found then
    raise exception 'tool % not found', p_tool_id;
  end if;

  return v_quantity;
end;
$$;

-- ── 2. Criação de job transacional ──────────────────────────────────────────
-- Antes: insert job -> update estoque (loop) -> insert checklist (erro
-- ignorado) rodavam como chamadas HTTP separadas para o PostgREST, sem
-- garantia atômica — uma falha no meio deixava job/estoque/checklist
-- inconsistentes entre si. Agora tudo roda dentro de uma função plpgsql:
-- se qualquer INSERT/UPDATE falhar (ex.: checklist com FK inválida), a
-- exceção propaga e o Postgres desfaz automaticamente TODAS as mudanças
-- feitas pela função (job, estoque e checklist), sem estado órfão.
create or replace function create_job_with_provisioning(p_job jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_job jobs%rowtype;
  v_insufficient text[] := '{}';
  mt record;
begin
  insert into jobs (
    employee_id, machine_id, job_type, description, scheduled_date, city, state,
    accommodation, car, start_time, end_time, notes, address,
    car_pickup_time, car_return_time, car_pickup_address, os_code
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
    p_job->>'os_code'
  )
  returning * into v_job;

  for mt in
    select mt.tool_id as tool_id, mt.quantity_required as quantity_required,
           t.name as tool_name, t.quantity as tool_quantity
    from machine_tools mt
    join tools t on t.id = mt.tool_id
    where mt.machine_id = v_job.machine_id
  loop
    if mt.tool_quantity < mt.quantity_required then
      v_insufficient := array_append(v_insufficient, mt.tool_name);
    end if;

    -- mesma expressão atômica de adjust_tool_stock (não pode chamar a
    -- função aqui porque precisamos do lock dentro da MESMA transação, o
    -- que já é o caso — plpgsql roda tudo em uma transação só).
    update tools
    set quantity = greatest(quantity - mt.quantity_required, 0), updated_at = now()
    where id = mt.tool_id;

    insert into job_checklists (job_id, employee_id, tool_id, phase)
    values (v_job.id, v_job.employee_id, mt.tool_id, 'pre_work');
  end loop;

  return jsonb_build_object(
    'job', to_jsonb(v_job),
    'insufficient_tools', to_jsonb(v_insufficient)
  );
end;
$$;

-- ── 3. Criação de schedule_event + vínculos de funcionário transacional ────
-- Antes: insert em schedule_events e insert em schedule_event_employees eram
-- duas chamadas separadas; se a segunda falhasse, o evento ficava órfão (sem
-- nenhum funcionário vinculado). Agora roda em uma função só.
create or replace function create_schedule_event_with_employees(p_event jsonb, p_employee_ids uuid[])
returns jsonb
language plpgsql
as $$
declare
  v_event schedule_events%rowtype;
  v_employee_id uuid;
begin
  insert into schedule_events (type, start_date, end_date, notes)
  values (
    p_event->>'type',
    (p_event->>'start_date')::date,
    (p_event->>'end_date')::date,
    p_event->>'notes'
  )
  returning * into v_event;

  foreach v_employee_id in array p_employee_ids
  loop
    insert into schedule_event_employees (schedule_event_id, employee_id)
    values (v_event.id, v_employee_id);
  end loop;

  return to_jsonb(v_event);
end;
$$;

-- ── 4. Estado de sincronização com Google Calendar visível ao usuário ──────
-- O sync continua fire-and-forget (não pode travar a resposta HTTP), mas
-- agora o resultado (sucesso/falha) fica registrado no próprio registro em
-- vez de só ir para o log — o front pode mostrar "sincronização pendente" ou
-- "falhou" em vez de mentir que está tudo sincronizado.
alter table schedule_events
  add column if not exists calendar_sync_status text not null default 'pending'
    check (calendar_sync_status in ('pending', 'synced', 'failed', 'skipped'));
