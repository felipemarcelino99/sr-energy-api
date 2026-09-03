-- Add missing columns to contracts table
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_type text CHECK (contract_type IN ('service', 'rental')),
  ADD COLUMN IF NOT EXISTS contract_value numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS recurring boolean DEFAULT false NOT NULL;

-- Add missing columns to jobs table
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS car_pickup_time text,
  ADD COLUMN IF NOT EXISTS car_return_time text,
  ADD COLUMN IF NOT EXISTS car_pickup_address text,
  ADD COLUMN IF NOT EXISTS os_code text;

-- Add 'pending' to jobs status check constraint
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('scheduled', 'pending', 'in_progress', 'completed', 'cancelled'));
