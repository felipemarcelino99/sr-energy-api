-- CRIT-03: Habilitar RLS em todas as tabelas de negócio

-- Employees
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emp_self_select" ON employees FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "emp_admin_all" ON employees FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- Contracts
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts_self_select" ON contracts FOR SELECT
  USING (auth.uid() = employee_user_id);

CREATE POLICY "contracts_admin_all" ON contracts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- Transactions: apenas admin
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_admin_all" ON transactions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- Jobs: todos autenticados leem; admin e manager escrevem
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs_authenticated_select" ON jobs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "jobs_manager_admin_all" ON jobs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager')
  ));

-- Machines: todos autenticados leem; admin e manager escrevem
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "machines_authenticated_select" ON machines FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "machines_manager_admin_all" ON machines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager')
  ));

-- Schedule events: todos autenticados leem; admin e manager escrevem
ALTER TABLE schedule_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_events_authenticated_select" ON schedule_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "schedule_events_manager_admin_all" ON schedule_events FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager')
  ));
