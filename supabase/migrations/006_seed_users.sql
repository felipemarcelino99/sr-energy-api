-- ============================================================
-- SEED: Usuários de exemplo
-- Senha padrão de todos: Sr@energy2025
-- ============================================================

-- UUIDs fixos para referenciar na tabela employees
DO $$
DECLARE
  manager_id  uuid := 'a0000000-0000-0000-0000-000000000001';
  employee1_id uuid := 'a0000000-0000-0000-0000-000000000002';
  employee2_id uuid := 'a0000000-0000-0000-0000-000000000003';
BEGIN

  -- -------------------------------------------------------
  -- Auth users
  -- -------------------------------------------------------
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
  (
    manager_id, 'authenticated', 'authenticated',
    'gerente@srenergia.com',
    crypt('Sr@energy2025', gen_salt('bf')),
    now(),
    '{"role": "manager", "name": "Carlos Gerente"}'::jsonb,
    now(), now()
  ),
  (
    employee1_id, 'authenticated', 'authenticated',
    'joao.silva@srenergia.com',
    crypt('Sr@energy2025', gen_salt('bf')),
    now(),
    '{"role": "employee", "name": "João Silva"}'::jsonb,
    now(), now()
  ),
  (
    employee2_id, 'authenticated', 'authenticated',
    'maria.souza@srenergia.com',
    crypt('Sr@energy2025', gen_salt('bf')),
    now(),
    '{"role": "employee", "name": "Maria Souza"}'::jsonb,
    now(), now()
  );

  -- -------------------------------------------------------
  -- Employees table
  -- -------------------------------------------------------
  INSERT INTO employees (user_id, name, email, phone, role, salary, hired_at) VALUES
  (
    manager_id,
    'Carlos Gerente',
    'gerente@srenergia.com',
    '(11) 91234-0001',
    'manager',
    8000.00,
    '2022-01-10'
  ),
  (
    employee1_id,
    'João Silva',
    'joao.silva@srenergia.com',
    '(11) 91234-0002',
    'employee',
    4500.00,
    '2023-03-15'
  ),
  (
    employee2_id,
    'Maria Souza',
    'maria.souza@srenergia.com',
    '(11) 91234-0003',
    'employee',
    4500.00,
    '2023-06-01'
  );

END $$;
