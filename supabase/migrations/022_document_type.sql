-- Fluxo PC-OS (apresentação original, "Apresentação Fluxo de PC-OS.pdf"): cada
-- documento anexado a uma OS tem um tipo — Relatório de Despesas (RD),
-- Relatório Diário de Obras (RDO) ou Relatório Técnico (RT) — e é exibido com
-- o código `TIPO-NÚMERO` (ex: `RT-26051`), reaproveitando o número da PC/OS
-- (compartilhado entre proposals/contracts/jobs, ver 016_contracts_pc_extension.sql).
-- O código de exibição não é armazenado — é montado no frontend a partir do
-- `document_type` + `number` da entidade já carregada na tela (evita duplicar
-- dado e mantê-lo sincronizado se o número mudar).
alter table documents
  add column if not exists document_type text not null default 'other'
    check (document_type in ('RD', 'RDO', 'RT', 'other'));
