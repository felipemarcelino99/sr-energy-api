-- Fix: PUT /jobs/:id/report sempre respondia 404 mesmo com o relatório existindo.
-- src/routes/reports.ts fazia update({ content, updated_at }) mas job_reports
-- (002_create_tables.sql:83-89) nunca teve coluna updated_at — o UPDATE falhava
-- no Postgres, e o erro era mascarado como "Report not found" pelo padrão
-- `if (error || !data) return 404`.

alter table job_reports add column updated_at timestamptz not null default now();
