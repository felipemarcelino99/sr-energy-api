-- ============================================================
-- SEED: Dados de exemplo para toda a aplicação
-- Depende de: 006_seed_users.sql (Carlos Gerente, João Silva, Maria Souza)
-- ============================================================

DO $$
DECLARE
  -- Auth user IDs (definidos em 006_seed_users)
  mgr_user_id  uuid := 'a0000000-0000-0000-0000-000000000001';
  emp1_user_id uuid := 'a0000000-0000-0000-0000-000000000002';
  emp2_user_id uuid := 'a0000000-0000-0000-0000-000000000003';

  -- Employee IDs (buscados da tabela)
  mgr_id  uuid;
  emp1_id uuid;
  emp2_id uuid;

  -- Machine IDs (fixos para referência cruzada)
  machine1_id uuid := 'b1000000-0000-0000-0000-000000000001'; -- Inversor SMA
  machine2_id uuid := 'b1000000-0000-0000-0000-000000000002'; -- Gerador Stemac
  machine3_id uuid := 'b1000000-0000-0000-0000-000000000003'; -- Transformador ABB
  machine4_id uuid := 'b1000000-0000-0000-0000-000000000004'; -- UPS APC

  -- Tool IDs
  tool1_id uuid := 'c1000000-0000-0000-0000-000000000001'; -- Multímetro
  tool2_id uuid := 'c1000000-0000-0000-0000-000000000002'; -- Alicate Amperímetro
  tool3_id uuid := 'c1000000-0000-0000-0000-000000000003'; -- Chave de Torque
  tool4_id uuid := 'c1000000-0000-0000-0000-000000000004'; -- Maleta de Ferramentas
  tool5_id uuid := 'c1000000-0000-0000-0000-000000000005'; -- EPI Completo
  tool6_id uuid := 'c1000000-0000-0000-0000-000000000006'; -- Termômetro Infravermelho
  tool7_id uuid := 'c1000000-0000-0000-0000-000000000007'; -- Tablet para Relatório

  -- Contract IDs
  contract1_id uuid := 'd1000000-0000-0000-0000-000000000001';
  contract2_id uuid := 'd1000000-0000-0000-0000-000000000002';
  contract3_id uuid := 'd1000000-0000-0000-0000-000000000003';

  -- Job IDs
  job1_id uuid := 'e1000000-0000-0000-0000-000000000001'; -- completed
  job2_id uuid := 'e1000000-0000-0000-0000-000000000002'; -- completed
  job3_id uuid := 'e1000000-0000-0000-0000-000000000003'; -- in_progress
  job4_id uuid := 'e1000000-0000-0000-0000-000000000004'; -- scheduled
  job5_id uuid := 'e1000000-0000-0000-0000-000000000005'; -- scheduled
  job6_id uuid := 'e1000000-0000-0000-0000-000000000006'; -- cancelled

  -- Report IDs
  report1_id uuid := 'f1000000-0000-0000-0000-000000000001';
  report2_id uuid := 'f1000000-0000-0000-0000-000000000002';

BEGIN
  -- Busca IDs reais dos funcionários
  SELECT id INTO mgr_id  FROM employees WHERE user_id = mgr_user_id;
  SELECT id INTO emp1_id FROM employees WHERE user_id = emp1_user_id;
  SELECT id INTO emp2_id FROM employees WHERE user_id = emp2_user_id;

  -- -------------------------------------------------------
  -- MACHINES
  -- -------------------------------------------------------
  INSERT INTO machines (id, name, brand, model, serial_number, year) VALUES
  (machine1_id, 'Inversor Solar',         'SMA',   'Sunny Boy 5000TL', 'SMA-5K-2021-001',  2021),
  (machine2_id, 'Gerador Diesel',         'Stemac', 'GE150',           'STM-150-2020-004', 2020),
  (machine3_id, 'Transformador Trifásico','ABB',    'ONAN 300kVA',     'ABB-300-2019-012', 2019),
  (machine4_id, 'No-Break Industrial',    'APC',    'Smart-UPS 10kVA', 'APC-10K-2022-003', 2022);

  -- -------------------------------------------------------
  -- TOOLS
  -- -------------------------------------------------------
  INSERT INTO tools (id, name, description, status, quantity) VALUES
  (tool1_id, 'Multímetro Digital',       'Fluke 87V — medição de tensão, corrente e resistência',        'active', 4),
  (tool2_id, 'Alicate Amperímetro',      'Fluke 376 FC — medição de corrente sem contato',               'active', 3),
  (tool3_id, 'Chave de Torque',          'Torquímetro 5–50 Nm com escala de precisão',                   'active', 2),
  (tool4_id, 'Maleta de Ferramentas',    'Kit completo com chaves Phillips, fenda, Allen e alicates',    'active', 5),
  (tool5_id, 'EPI Completo',             'Capacete dielétrico, luvas isolantes e óculos de proteção',    'active', 6),
  (tool6_id, 'Termômetro Infravermelho', 'Leitura sem contato de -50°C a 500°C (Fluke 62 Max)',          'active', 3),
  (tool7_id, 'Tablet para Relatório',    'Tablet com aplicativo de inspeção e câmera para evidências',   'active', 2);

  -- -------------------------------------------------------
  -- MACHINE → TOOLS
  -- -------------------------------------------------------
  INSERT INTO machine_tools (machine_id, tool_id, quantity_required) VALUES
  -- Inversor Solar: multímetro, alicate, EPI
  (machine1_id, tool1_id, 1),
  (machine1_id, tool2_id, 1),
  (machine1_id, tool5_id, 1),
  (machine1_id, tool7_id, 1),
  -- Gerador Diesel: multímetro, torque, maleta, EPI, termômetro
  (machine2_id, tool1_id, 1),
  (machine2_id, tool3_id, 1),
  (machine2_id, tool4_id, 1),
  (machine2_id, tool5_id, 1),
  (machine2_id, tool6_id, 1),
  -- Transformador: multímetro, torque, EPI, termômetro
  (machine3_id, tool1_id, 1),
  (machine3_id, tool3_id, 1),
  (machine3_id, tool5_id, 1),
  (machine3_id, tool6_id, 1),
  -- No-Break: multímetro, maleta, EPI, tablet
  (machine4_id, tool1_id, 1),
  (machine4_id, tool4_id, 1),
  (machine4_id, tool5_id, 1),
  (machine4_id, tool7_id, 1);

  -- -------------------------------------------------------
  -- CONTRACTS
  -- -------------------------------------------------------
  INSERT INTO contracts (id, client_name, client_cnpj, description, start_date, end_date) VALUES
  (contract1_id,
   'Fazenda Solar Norte',
   '12.345.678/0001-90',
   'Instalação e manutenção preventiva de 200 painéis solares com inversores SMA — Contrato anual com visitas trimestrais.',
   '2025-01-01', '2026-12-31'),
  (contract2_id,
   'Condomínio Parque Verde',
   '98.765.432/0001-11',
   'Fornecimento, instalação e manutenção de sistema de energia backup (UPS + Gerador) — Atendimento 24h em emergências.',
   '2025-06-01', '2027-05-31'),
  (contract3_id,
   'Metalúrgica Boa Sorte Ltda',
   '55.123.456/0001-44',
   'Manutenção preventiva e corretiva de transformadores e inversores industriais — Visitas mensais e suporte técnico.',
   '2024-08-01', '2026-07-31');

  -- -------------------------------------------------------
  -- JOBS
  -- -------------------------------------------------------
  -- Job 1: completed — João, Inversor Solar, Curitiba
  INSERT INTO jobs (id, employee_id, machine_id, job_type, status, description, scheduled_date, city, state, accommodation, car, start_time, end_time)
  VALUES (job1_id, emp1_id, machine1_id, 'maintenance', 'completed',
    'Manutenção preventiva trimestral do inversor solar. Verificação de tensões CC/CA, limpeza de filtros e atualização de firmware.',
    '2026-02-15', 'Curitiba', 'PR', false, true, '08:00', '17:00');

  -- Job 2: completed — Maria, Gerador Diesel, Londrina
  INSERT INTO jobs (id, employee_id, machine_id, job_type, status, description, scheduled_date, city, state, accommodation, car, start_time, end_time)
  VALUES (job2_id, emp2_id, machine2_id, 'maintenance', 'completed',
    'Revisão completa do gerador diesel. Troca de óleo (20L SAE 15W40), filtros e verificação do sistema elétrico. Teste de carga 120kVA por 2h.',
    '2026-02-28', 'Londrina', 'PR', true, true, '07:00', '16:00');

  -- Job 3: in_progress — João, Transformador, Maringá
  INSERT INTO jobs (id, employee_id, machine_id, job_type, status, description, scheduled_date, city, state, accommodation, car, start_time, end_time)
  VALUES (job3_id, emp1_id, machine3_id, 'maintenance', 'in_progress',
    'Inspeção e calibração do transformador trifásico. Análise de óleo isolante, termografia e medição de resistência de isolamento.',
    '2026-04-05', 'Maringá', 'PR', true, true, '08:00', '17:00');

  -- Job 4: scheduled — João, No-Break, São Paulo
  INSERT INTO jobs (id, employee_id, machine_id, job_type, status, description, scheduled_date, city, state, accommodation, car, start_time, end_time)
  VALUES (job4_id, emp1_id, machine4_id, 'implementation', 'scheduled',
    'Instalação de novo UPS 10kVA no data center do cliente. Configuração de bypass, testes de autonomia e treinamento da equipe local.',
    '2026-04-20', 'São Paulo', 'SP', true, false, '08:00', '18:00');

  -- Job 5: scheduled — Maria, Inversor Solar, Curitiba
  INSERT INTO jobs (id, employee_id, machine_id, job_type, status, description, scheduled_date, city, state, accommodation, car, start_time, end_time)
  VALUES (job5_id, emp2_id, machine1_id, 'maintenance', 'scheduled',
    'Manutenção preventiva semestral do inversor solar. Segunda visita do ano — verificação de conexões e limpeza de painéis.',
    '2026-05-12', 'Curitiba', 'PR', false, true, '09:00', '16:00');

  -- Job 6: cancelled — Maria, Gerador, Cascavel
  INSERT INTO jobs (id, employee_id, machine_id, job_type, status, description, scheduled_date, city, state, accommodation, car, start_time, end_time, notes)
  VALUES (job6_id, emp2_id, machine2_id, 'maintenance', 'cancelled',
    'Manutenção emergencial do gerador após alarme de temperatura.',
    '2026-03-10', 'Cascavel', 'PR', true, true, '07:00', '17:00',
    'Cliente solicitou cancelamento — equipe interna realizou reparo provisório. Reagendar para maio.');

  -- -------------------------------------------------------
  -- JOB REPORTS (jobs concluídos)
  -- -------------------------------------------------------
  INSERT INTO job_reports (id, job_id, content, employee_id, submitted_at) VALUES
  (report1_id, job1_id,
   '<h2>Manutenção Preventiva — Inversor Solar SMA Sunny Boy 5000TL</h2><p><strong>Data:</strong> 15/02/2026 | <strong>Técnico:</strong> João Silva</p><h3>Atividades Realizadas</h3><ul><li>Verificação de tensão CC (entrada): 380V — dentro do nominal</li><li>Corrente CA (saída): 22A — dentro do nominal</li><li>Limpeza dos filtros de ventilação</li><li>Atualização de firmware: v3.11 → v3.12</li><li>Inspeção visual de cabos e conectores — sem avarias</li></ul><h3>Conclusão</h3><p>Sistema em perfeito estado de funcionamento. Próxima manutenção preventiva: 15/05/2026.</p>',
   emp1_id, '2026-02-15 17:30:00+00'),
  (report2_id, job2_id,
   '<h2>Revisão Completa — Gerador Diesel Stemac GE150</h2><p><strong>Data:</strong> 28/02/2026 | <strong>Técnico:</strong> Maria Souza</p><h3>Atividades Realizadas</h3><ul><li>Troca de óleo lubrificante: 20L SAE 15W40 (Mobil Delvac)</li><li>Substituição de filtro de óleo, ar e combustível</li><li>Verificação e limpeza do alternador</li><li>Teste de carga: 120kVA por 2h contínuas sem anomalias</li><li>Leitura do hodômetro: 1.240h — próxima revisão em 1.490h</li></ul><h3>Conclusão</h3><p>Equipamento em condições operacionais satisfatórias. Recomendado acompanhamento do nível de refrigerante na próxima visita.</p>',
   emp2_id, '2026-02-28 16:45:00+00');

  -- Vincula relatórios aos jobs
  UPDATE jobs SET report_id = report1_id WHERE id = job1_id;
  UPDATE jobs SET report_id = report2_id WHERE id = job2_id;

  -- -------------------------------------------------------
  -- JOB CHECKLISTS
  -- -------------------------------------------------------
  -- Job 1 completed — pre_work (todos marcados)
  INSERT INTO job_checklists (job_id, employee_id, tool_id, phase, checked, checked_at) VALUES
  (job1_id, emp1_id, tool1_id, 'pre_work', true, '2026-02-15 08:10:00+00'),
  (job1_id, emp1_id, tool2_id, 'pre_work', true, '2026-02-15 08:10:00+00'),
  (job1_id, emp1_id, tool5_id, 'pre_work', true, '2026-02-15 08:10:00+00'),
  (job1_id, emp1_id, tool7_id, 'pre_work', true, '2026-02-15 08:10:00+00'),
  -- Job 1 completed — pre_report (todos marcados)
  (job1_id, emp1_id, tool1_id, 'pre_report', true, '2026-02-15 17:00:00+00'),
  (job1_id, emp1_id, tool2_id, 'pre_report', true, '2026-02-15 17:00:00+00'),
  (job1_id, emp1_id, tool5_id, 'pre_report', true, '2026-02-15 17:00:00+00'),
  (job1_id, emp1_id, tool7_id, 'pre_report', true, '2026-02-15 17:00:00+00'),

  -- Job 2 completed — pre_work (todos marcados)
  (job2_id, emp2_id, tool1_id, 'pre_work', true, '2026-02-28 07:15:00+00'),
  (job2_id, emp2_id, tool3_id, 'pre_work', true, '2026-02-28 07:15:00+00'),
  (job2_id, emp2_id, tool4_id, 'pre_work', true, '2026-02-28 07:15:00+00'),
  (job2_id, emp2_id, tool5_id, 'pre_work', true, '2026-02-28 07:15:00+00'),
  (job2_id, emp2_id, tool6_id, 'pre_work', true, '2026-02-28 07:15:00+00'),
  -- Job 2 completed — pre_report (todos marcados)
  (job2_id, emp2_id, tool1_id, 'pre_report', true, '2026-02-28 16:30:00+00'),
  (job2_id, emp2_id, tool3_id, 'pre_report', true, '2026-02-28 16:30:00+00'),
  (job2_id, emp2_id, tool4_id, 'pre_report', true, '2026-02-28 16:30:00+00'),
  (job2_id, emp2_id, tool5_id, 'pre_report', true, '2026-02-28 16:30:00+00'),
  (job2_id, emp2_id, tool6_id, 'pre_report', true, '2026-02-28 16:30:00+00'),

  -- Job 3 in_progress — pre_work parcialmente marcado
  (job3_id, emp1_id, tool1_id, 'pre_work', true,  '2026-04-05 08:20:00+00'),
  (job3_id, emp1_id, tool3_id, 'pre_work', true,  '2026-04-05 08:20:00+00'),
  (job3_id, emp1_id, tool5_id, 'pre_work', false, null),
  (job3_id, emp1_id, tool6_id, 'pre_work', false, null);

  -- -------------------------------------------------------
  -- SALARY ADJUSTMENTS
  -- -------------------------------------------------------
  INSERT INTO salary_adjustments (employee_id, previous_salary, new_salary, reason, adjusted_at) VALUES
  (emp1_id, 4000.00, 4500.00, 'Reajuste anual 2025 — avaliação de desempenho positiva e cumprimento de metas técnicas.', '2025-01-15 00:00:00+00'),
  (emp2_id, 4000.00, 4500.00, 'Reajuste anual 2025 — avaliação de desempenho positiva e cumprimento de metas técnicas.', '2025-01-15 00:00:00+00');

  -- -------------------------------------------------------
  -- TRANSACTIONS
  -- -------------------------------------------------------
  INSERT INTO transactions (type, amount, description, category, destination, date) VALUES
  ('credit', 15000.00, 'Recebimento parcela mensal — Fazenda Solar Norte',           'contrato',               'Fazenda Solar Norte',          '2026-01-05'),
  ('credit',  8500.00, 'Recebimento parcela mensal — Condomínio Parque Verde',        'contrato',               'Condomínio Parque Verde',      '2026-01-10'),
  ('debit',   3200.00, 'Combustível e diárias de viagem — Janeiro',                  'despesas operacionais',  null,                           '2026-01-31'),
  ('debit',    950.00, 'Reposição de consumíveis (fusíveis, cabos, bornes)',          'materiais',              null,                           '2026-01-20'),
  ('credit', 15000.00, 'Recebimento parcela mensal — Fazenda Solar Norte',           'contrato',               'Fazenda Solar Norte',          '2026-02-05'),
  ('credit',  8500.00, 'Recebimento parcela mensal — Condomínio Parque Verde',        'contrato',               'Condomínio Parque Verde',      '2026-02-10'),
  ('credit', 12000.00, 'Recebimento trimestral — Metalúrgica Boa Sorte',             'contrato',               'Metalúrgica Boa Sorte Ltda',   '2026-02-15'),
  ('debit',   2800.00, 'Combustível e diárias de viagem — Fevereiro',                'despesas operacionais',  null,                           '2026-02-28'),
  ('debit',   1500.00, 'Manutenção e reposição de ferramentas (chaves, alicates)',   'equipamentos',           null,                           '2026-02-20'),
  ('credit', 15000.00, 'Recebimento parcela mensal — Fazenda Solar Norte',           'contrato',               'Fazenda Solar Norte',          '2026-03-05'),
  ('credit',  8500.00, 'Recebimento parcela mensal — Condomínio Parque Verde',        'contrato',               'Condomínio Parque Verde',      '2026-03-10'),
  ('debit',   4500.00, 'Aquisição de EPIs (capacetes, luvas, óculos) — estoque',     'equipamentos',           null,                           '2026-03-12'),
  ('debit',   2100.00, 'Combustível e diárias de viagem — Março',                   'despesas operacionais',  null,                           '2026-03-31');

END $$;
