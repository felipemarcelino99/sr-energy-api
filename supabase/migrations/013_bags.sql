-- Bags (malas de ferramentas)
CREATE TABLE bags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  model text NOT NULL,
  quantity int NOT NULL CHECK (quantity >= 1),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Calibration certificates linked to bags
CREATE TABLE calibration_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id uuid NOT NULL REFERENCES bags(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  expiry_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);
