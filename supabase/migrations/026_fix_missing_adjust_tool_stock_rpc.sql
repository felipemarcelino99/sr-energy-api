-- Mesmo drift do achado em 025: as funções adjust_tool_stock e
-- create_schedule_event_with_employees (015_atomic_operations.sql) também estavam
-- ausentes neste ambiente apesar da migration constar como aplicada — a primeira
-- causava 500 ("Could not find the function public.adjust_tool_stock(p_delta,
-- p_tool_id) in the schema cache") ao cancelar uma OS (restoreToolStock em jobs.ts);
-- a segunda causava 500 idêntico ao criar qualquer evento de agenda
-- (schedule-events.ts). `create or replace function` é idempotente — seguro
-- reexecutar.
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
