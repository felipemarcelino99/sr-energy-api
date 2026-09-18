export type Role = 'admin' | 'manager' | 'employee'
// Sub-plano 01 (épico ajustes-cliente-2026-09), item 1: 10 tipos de serviço
// novos, substituindo 'maintenance'/'implementation' (dados legados viram
// NULL, ver supabase/migrations/030_pc_os_vinculo_direto.sql). Mantido em
// sincronia manual com o enum zod em src/routes/jobs.ts.
export type JobType =
  | 'pre_commissioning' | 'commissioning' | 'pre_taf' | 'taf' | 'technical_visit'
  | 'field_survey' | 'studies' | 'bench_tests' | 'energization_support' | 'development'
// 'pending': status inicial da OS esqueleto criada por `accept_proposal`
// (supabase/migrations/030_pc_os_vinculo_direto.sql) — já existia como valor
// aceito pelo CHECK constraint do banco (012_missing_columns.sql) mas faltava
// aqui.
export type JobStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type TransactionType = 'credit' | 'debit'
export type EvidenceType = 'image' | 'pdf' | 'video' | 'audio'

export interface JwtPayload {
  sub: string        // user_id
  email: string
  role: string
  user_metadata: { role: Role; name: string }
  aud: string
  exp: number
}

// Sub-plano 02 (épico ajustes-cliente-2026-09): `cnpj` (documento de empresa)
// vira `cpf` (documento pessoal — funcionário é PF, ver
// supabase/migrations/032_employee_cpf_cor_foto.sql). `color`: identificação
// visual no calendário de OS (antes calculada no front por hash do id, com
// colisões). `photo_path`: chave no bucket privado `employee-photos` — nunca
// a URL (expira, ver storage.service.ts); `photo_url` é computado na leitura
// (src/routes/employees.ts) e não existe como coluna.
export interface Employee {
  id: string; user_id: string | null; name: string; email: string
  phone: string; role: 'employee' | 'manager'; cpf?: string; color?: string
  photo_path?: string
  salary: number; hired_at: string; created_at: string; updated_at: string
}

export interface Machine {
  id: string; name: string; brand: string; model: string
  serial_number: string; year: number; manual_url?: string
  created_at: string; updated_at: string
}

export interface Contract {
  id: string; client_id: string | null; description: string
  start_date: string; end_date: string; contract_type?: string
  contract_value?: number; recurring?: boolean; file_url?: string
  created_at: string; updated_at: string
  clients?: { id: string; razao_social: string; cnpj: string } | null
}

export interface Job {
  id: string; employee_id: string; machine_id: string
  job_type: JobType; status: JobStatus; description: string
  scheduled_date: string; city: string; state: string
  accommodation: boolean; car: boolean; start_time: string; end_time: string
  notes?: string; report_id?: string; created_at: string; updated_at: string
}

export interface JobReport {
  id: string; job_id: string; content: string
  submitted_at: string; employee_id: string
}

export interface Evidence {
  id: string; report_id: string; url: string
  mime_type: string; file_name: string; type: EvidenceType
}

export interface Transaction {
  id: string; type: TransactionType; amount: number
  description: string; category: string; destination?: string
  date: string; created_at: string
}

export interface Notification {
  id: string; user_id: string; title: string
  message: string; read: boolean; created_at: string
}

export interface SalaryAdjustment {
  id: string; employee_id: string; previous_salary: number
  new_salary: number; reason: string; adjusted_at: string
}
