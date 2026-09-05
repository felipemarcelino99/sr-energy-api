-- Correção de drift: a função create_job_with_provisioning (015_atomic_operations.sql)
-- estava ausente neste ambiente apesar da migration constar como aplicada no
-- histórico (supabase migration list), causando 500 ("Could not find the function
-- public.create_job_with_provisioning(p_job) in the schema cache") em toda criação
-- de OS. `create or replace function` é idempotente — seguro reexecutar mesmo se a
-- função já existir em outro ambiente.
--
-- Bug adicional encontrado ao reexecutar: a variável de loop `mt` tinha o MESMO
-- nome do alias `machine_tools mt` usado dentro da própria query do `for ... in`
-- — o PL/pgSQL resolve `mt.tool_id` no SELECT como o record da variável de loop
-- (ainda não atribuído na primeira iteração), não o alias da tabela, resultando em
-- "record \"mt\" is not assigned yet". Renomeada para `v_mt` para eliminar a colisão.
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
