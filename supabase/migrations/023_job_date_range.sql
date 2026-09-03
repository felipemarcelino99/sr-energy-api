-- Fluxo PC-OS (apresentação original): "DATA DO SERVIÇO (PODE SER MAIS DE UM
-- DIA), LEVANDO ESSA INFORMAÇÃO PARA O LAYOUT DO CALENDÁRIO". `jobs.scheduled_date`
-- continua sendo a data de início (retrocompatível — toda OS de um dia só só
-- preenche essa coluna). `scheduled_end_date` é opcional: quando presente, o
-- serviço se estende de scheduled_date até scheduled_end_date (inclusive), e o
-- frontend replica a OS em todos os dias do intervalo no calendário.
alter table jobs
  add column if not exists scheduled_end_date date;

-- Nunca deve terminar antes de começar (mas permite null — OS ainda sem data,
-- ou sem data final definida). Postgres não suporta `ADD CONSTRAINT IF NOT
-- EXISTS`, então checa via catálogo antes de adicionar (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_scheduled_end_date_after_start'
  ) then
    alter table jobs
      add constraint jobs_scheduled_end_date_after_start
        check (scheduled_end_date is null or scheduled_date is null or scheduled_end_date >= scheduled_date);
  end if;
end $$;
