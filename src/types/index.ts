export type Role = 'admin' | 'manager' | 'employee'
export type JobType = 'maintenance' | 'implementation'
export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
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

export interface Employee {
  id: string; user_id: string | null; name: string; email: string
  phone: string; role: 'employee' | 'manager'; cnpj?: string
  salary: number; hired_at: string; created_at: string; updated_at: string
}

export interface Machine {
  id: string; name: string; brand: string; model: string
  serial_number: string; year: number; manual_url?: string
  created_at: string; updated_at: string
}

export interface Contract {
  id: string; client_name: string; client_cnpj: string; description: string
  start_date: string; end_date: string; file_url?: string
  created_at: string; updated_at: string
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
