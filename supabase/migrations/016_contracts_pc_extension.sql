-- Sub-plano 04 (fluxo PC-OS), item 1+2: `contracts` absorve o conceito de Proposta
-- Comercial (PC) — número `AAXXX` e status de negociação — e o gerador de numeração
-- atômico compartilhado entre `contracts` e `jobs` (a OS reaproveita o mesmo número
-- da PC que a originou, ver 018_contracts_accept_reject.sql).

-- ── Gerador de numeração AAXXX ──────────────────────────────────────────────
-- Contador por ano civil (AA = 2 últimos dígitos do ano corrente), sequencial
-- global (não corta por cliente/tipo — decisão de escopo confirmada na PRD).
-- Mesma classe de correção do achado de race condition de estoque (sub-plano 02,
-- ver 015_atomic_operations.sql): o `INSERT ... ON CONFLICT DO UPDATE ...
-- RETURNING` é uma única instrução SQL — o Postgres serializa concorrência via
-- lock da linha do contador (chave primária `year`), então duas chamadas
-- simultâneas nunca leem o mesmo `last_value` e escrevem o mesmo próximo número.
-- Não há round-trip de "ler contador em memória, calcular, escrever de volta"
-- no processo Node — todo o cálculo acontece dentro desta função, em uma
-- transação implícita por chamada.
create table if not exists document_number_counters (
  year int primary key,
  last_value int not null default 0
);

create or replace function next_document_number()
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from now())::int;
  v_yy text := to_char(now(), 'YY');
  v_next int;
begin
  insert into document_number_counters (year, last_value)
  values (v_year, 1)
  on conflict (year)
    do update set last_value = document_number_counters.last_value + 1
  returning last_value into v_next;

  return v_yy || lpad(v_next::text, 3, '0');
end;
$$;

-- ── Extensão de `contracts` (PC) ────────────────────────────────────────────
-- `client_id` (já existente, ver 014_clients.sql) já cobre o vínculo
-- Cliente/Empresa ↔ PC — não duplicamos dado de cliente aqui nem em `jobs`
-- (a OS referencia `contract_id`, ver 017_jobs_pc_os_extension.sql).
--
-- `number` tem DEFAULT que chama o gerador acima: todo INSERT em `contracts`
-- (rota POST /contracts) ganha número atomicamente sem a rota precisar saber
-- como o número é formado (deep module — a regra fica só no banco).
alter table contracts
  add column if not exists number text unique default next_document_number(),
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected'));

-- Backfill de contratos já existentes sem número (idempotente: só preenche NULL).
update contracts set number = next_document_number() where number is null;
