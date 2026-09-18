-- Script manual de teste visual — NÃO é uma migration (não vai em
-- supabase/migrations/). Cria 10 eventos de agenda (Folga/Férias/
-- Treinamento/Afastamento médico) no mesmo dia, distribuídos entre os
-- funcionários já cadastrados, só pra validar visualmente como o calendário
-- se comporta com muitas entradas num único dia.
--
-- Ajuste `target_date` antes de rodar. Rode você mesmo — o agente não
-- executa isso contra o Supabase remoto (regra de produção do projeto).
--
-- Limpeza depois (apaga só o que este script criou):
--   delete from schedule_event_employees
--   where schedule_event_id in (select id from schedule_events where notes like 'Teste visual #%');
--   delete from schedule_events where notes like 'Teste visual #%';

do $$
declare
  emp_ids uuid[];
  types text[] := array['day_off','vacation','training','medical_leave'];
  new_id uuid;
  i int;
  target_date date := '2026-09-20'; -- ajuste a data aqui
begin
  select array_agg(id) into emp_ids
  from (select id from employees order by name limit 4) e;

  if emp_ids is null or array_length(emp_ids, 1) = 0 then
    raise exception 'Nenhum funcionário encontrado.';
  end if;

  for i in 1..10 loop
    insert into schedule_events (type, status, start_date, end_date, notes, calendar_sync_status)
    values (types[1 + (i % 4)], 'active', target_date, target_date, 'Teste visual #' || i, 'skipped')
    returning id into new_id;

    insert into schedule_event_employees (schedule_event_id, employee_id)
    values (new_id, emp_ids[1 + (i % array_length(emp_ids,1))]);
  end loop;
end $$;
