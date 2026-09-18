-- Sub-plano 02 (épico ajustes-cliente-2026-09): funcionário passa a ter CPF
-- (documento pessoal) no lugar de CNPJ (documento de empresa — não fazia
-- sentido para um colaborador PF), cor de identificação visual (hoje
-- calculada no front por hash do id, com colisões — ver contexto do plano)
-- e foto de perfil.
--
-- Pendente de aplicação: mesmo bloqueio de Docker do sub-plano 01 (ver
-- 030_pc_os_vinculo_direto.sql) — migration escrita e revisada, mas não
-- executada em banco algum (nem local, nem remoto) nesta sessão.

-- ── cnpj → cpf ───────────────────────────────────────────────────────────
-- Base é homolog — dado de teste, sem valor para preservar. Sem tentativa de
-- reaproveitar/mapear cnpj existente pra cpf (formatos incompatíveis, e
-- dígitos verificadores diferentes).
alter table employees drop column if exists cnpj;
alter table employees add column if not exists cpf text;

-- Unique parcial: permite múltiplos NULL (funcionário sem CPF cadastrado
-- ainda), mas nunca dois funcionários com o mesmo CPF preenchido.
create unique index if not exists employees_cpf_unique_idx
  on employees (cpf) where cpf is not null;

-- ── color ────────────────────────────────────────────────────────────────
alter table employees add column if not exists color text;
alter table employees drop constraint if exists employees_color_format_check;
alter table employees add constraint employees_color_format_check
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- Backfill: paleta de 20 cores distintas (ordem por created_at) — sem
-- colisão até 20 funcionários (equipe atual é bem menor). Acima disso, a
-- paleta repete (ciclo de 20) — aceitável, é só backfill inicial; o cadastro
-- passa a exigir cor explícita dali em diante (validação no Zod, ver
-- src/routes/employees.ts).
with palette(hex) as (
  values
    ('#e6194b'), ('#3cb44b'), ('#ffe119'), ('#4363d8'), ('#f58231'),
    ('#911eb4'), ('#46f0f0'), ('#f032e6'), ('#bcf60c'), ('#fabebe'),
    ('#008080'), ('#e6beff'), ('#9a6324'), ('#fffac8'), ('#800000'),
    ('#aaffc3'), ('#808000'), ('#ffd8b1'), ('#000075'), ('#808080')
),
palette_ranked as (
  select hex, row_number() over () as prn from palette
),
ranked as (
  select id, row_number() over (order by created_at, id) as rn from employees
)
update employees e
set color = pr.hex
from ranked r
join palette_ranked pr on pr.prn = ((r.rn - 1) % 20) + 1
where r.id = e.id
  and e.color is null;

-- ── photo_path ───────────────────────────────────────────────────────────
-- Guarda só o path no bucket privado `employee-photos` (não a URL — expira,
-- ver storage.service.ts / SIGNED_BUCKETS). A URL assinada é gerada na
-- leitura (GET /employees), TTL curto (1h), igual ao padrão dos demais
-- buckets privados. Bucket `employee-photos` criado manualmente (local e
-- remoto) — não há criação declarativa via migration/config.toml no projeto
-- para nenhum bucket existente.
alter table employees add column if not exists photo_path text;
