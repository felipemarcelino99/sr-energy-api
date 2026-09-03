-- Sub-plano 04 (fluxo PC-OS), item 5: módulo de auditoria append-only.
-- Toda transição de status (contrato/OS) e todo acesso a documento (itens 6/7)
-- grava aqui. Histórico nunca pode ser alterado ou apagado, nem por bug futuro
-- na API — por isso o append-only é reforçado por GRANT/REVOKE de banco, não só
-- pela ausência de rota de update/delete no Fastify: mesmo a service_role key
-- (que a API usa e que ignora RLS) fica sem privilégio de UPDATE/DELETE nesta
-- tabela.

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity_type, entity_id, created_at desc);

alter table audit_log enable row level security;

-- RLS habilitada sem nenhuma policy = deny-all por padrão (defesa em camadas);
-- o controle de fato é o REVOKE abaixo, que vale mesmo para service_role.
revoke update, delete on audit_log from service_role, authenticated, anon, public;
grant select, insert on audit_log to service_role;
