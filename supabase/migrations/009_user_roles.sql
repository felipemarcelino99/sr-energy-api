-- CRIT-02: Tabela de roles desacoplada de user_metadata
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'employee'
               CHECK (role IN ('admin', 'manager', 'employee'))
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Usuário pode ler apenas seu próprio role
CREATE POLICY "users_read_own_role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Somente service_role pode inserir/atualizar/deletar
CREATE POLICY "service_manage_role" ON user_roles
  FOR ALL USING (auth.role() = 'service_role');

-- Migrar roles existentes de user_metadata para a nova tabela
INSERT INTO user_roles (user_id, role)
SELECT id, COALESCE(raw_user_meta_data->>'role', 'employee')
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
