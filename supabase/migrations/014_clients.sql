-- Clients
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social text NOT NULL,
  cnpj text NOT NULL UNIQUE,
  segmento text NOT NULL,
  email text NOT NULL,
  telefone text,
  celular text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  endereco jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Link contracts to clients
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

-- Remove legacy columns
ALTER TABLE contracts
  DROP COLUMN IF EXISTS client_name,
  DROP COLUMN IF EXISTS client_cnpj;
