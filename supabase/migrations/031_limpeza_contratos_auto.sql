-- ⚠️ MIGRATION DESTRUTIVA — NÃO EXECUTAR SEM CONFIRMAÇÃO EXPLÍCITA DO USUÁRIO,
-- em nenhum ambiente (local ou remoto). Este arquivo foi escrito como parte
-- do sub-plano 01 (épico ajustes-cliente-2026-09) mas propositalmente não foi
-- rodado pelo agente — nem localmente (Docker indisponível nesta sessão) nem
-- no remoto (fora do escopo do agente, ver CLAUDE.md global de prod-safety).
--
-- Antes de aplicar, rode a query de verificação abaixo e confirme com o
-- usuário que a contagem/lista faz sentido:
--
--   select count(*) as contratos_auto_gerados
--   from contracts c
--   where c.id in (select contract_id from proposals where contract_id is not null)
--     and exists (
--       select 1 from proposals p
--       where p.contract_id = c.id and p.number = c.number
--     );
--
-- O que este script faz: apaga os contratos que o `accept_proposal` antigo
-- (021_proposals_split.sql / 027_fix_proposal_recurring_null.sql) criava
-- automaticamente a cada PC aceita — identificados por serem o contract_id
-- de uma proposal com o MESMO número (`number`) copiado da PC (assinatura do
-- fluxo antigo; um contrato vinculado manualmente por um gestor via
-- `contract_id` novo do sub-plano 01 nunca compartilha o `number` da PC,
-- porque contratos manuais não têm número automático desde
-- 021_proposals_split.sql:87). Depois zera `contract_id` nas proposals e
-- jobs que apontavam pra esses contratos removidos, pra não deixar FK
-- pendurada em linha já apagada.

begin;

-- 1) Zera o vínculo nas proposals que apontavam pro contrato auto-gerado
--    (a PC continua intacta — só perde o "contrato" que era, na prática, uma
--    cópia dela mesma).
update proposals p
set contract_id = null
where p.contract_id in (
  select c.id from contracts c
  where c.number = p.number
);

-- 2) Zera o vínculo nos jobs que herdaram contract_id do contrato auto-gerado
--    (a OS já tem proposal_id/client_id preenchidos pela migration 030 —
--    perder o contract_id não perde o vínculo com a PC nem com o cliente).
update jobs j
set contract_id = null
where j.contract_id in (
  select c.id from contracts c
  join proposals p on p.number = c.number
);

-- 3) Apaga os contratos órfãos (auto-gerados pelo fluxo antigo, agora sem
--    nenhuma proposal/job apontando pra eles).
delete from contracts c
where exists (
  select 1 from proposals p where p.number = c.number
);

commit;
