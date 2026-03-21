# SR Energy API — Plano de Implementação do Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma REST API em Node.js + Fastify + TypeScript que serve o frontend SR Energy com operações CRUD de funcionários, máquinas, contratos, trabalhos, transações e notificações, além de um chat RAG sobre manuais de máquinas usando Supabase pgvector + Anthropic Claude.

**Architecture:** Servidor Fastify único organizado em plugins de domínio (routes) e serviços compartilhados (RAG, storage, notificações). Supabase gerencia persistência (PostgreSQL + pgvector), armazenamento de arquivos, autenticação (JWT) e realtime. Auth é verificada num plugin Fastify usando o JWT secret do Supabase.

**Tech Stack:** Node.js 20 LTS, Fastify 5, TypeScript 5, @supabase/supabase-js v2, @anthropic-ai/sdk, voyageai, pdf-parse, Zod, Jest + ts-jest, Railway (deploy).

**Frontend API contract:** `VITE_API_BASE_URL=http://localhost:3000` → todos os endpoints no prefixo `/`.

---

## Estrutura de Pastas

```
sr-energy-api/
├── src/
│   ├── index.ts                      # Inicia o servidor HTTP
│   ├── app.ts                        # Factory Fastify + registro de plugins/routes
│   ├── plugins/
│   │   ├── supabase.ts               # Cliente Supabase (service role) decorado no Fastify
│   │   └── auth.ts                   # Hook onRequest: verifica JWT Supabase
│   ├── routes/
│   │   ├── employees.ts              # CRUD + salary-adjustments
│   │   ├── machines.ts               # CRUD + upload manual + job history
│   │   ├── contracts.ts              # CRUD + upload PDF + /expiring
│   │   ├── jobs.ts                   # CRUD + cancel
│   │   ├── reports.ts                # GET/POST report + upload evidences
│   │   ├── transactions.ts           # CRUD
│   │   ├── notifications.ts          # List + mark read
│   │   └── chat.ts                   # POST /chat (RAG + Claude)
│   ├── services/
│   │   ├── rag.service.ts            # chunk → embed → upsert / query → Claude
│   │   ├── storage.service.ts        # Upload para Supabase Storage
│   │   └── notification.service.ts   # Inserir linha na tabela notifications
│   └── types/
│       └── index.ts                  # Interfaces TS espelhando os models do frontend
├── supabase/
│   └── migrations/
│       ├── 001_enable_pgvector.sql
│       ├── 002_create_tables.sql
│       └── 003_create_indexes.sql
├── tests/
│   ├── helpers/
│   │   └── build-app.ts              # Cria instância Fastify com mocks para testes
│   ├── routes/
│   │   ├── employees.test.ts
│   │   ├── machines.test.ts
│   │   ├── contracts.test.ts
│   │   ├── jobs.test.ts
│   │   ├── reports.test.ts
│   │   ├── transactions.test.ts
│   │   ├── notifications.test.ts
│   │   └── chat.test.ts
│   └── services/
│       └── rag.service.test.ts
├── .env.example
├── .gitignore
├── jest.config.ts
├── package.json
├── railway.toml
└── tsconfig.json
```

---

## Sessão 1 — Scaffolding do Projeto

### Task 1: Inicializar projeto Node.js + TypeScript

**Files:**
- Create: `sr-energy-api/package.json`
- Create: `sr-energy-api/tsconfig.json`
- Create: `sr-energy-api/.gitignore`
- Create: `sr-energy-api/.env.example`
- Create: `sr-energy-api/jest.config.ts`

- [ ] **Criar o diretório e inicializar o projeto**

```bash
mkdir sr-energy-api && cd sr-energy-api
npm init -y
```

- [ ] **Instalar dependências de produção**

```bash
npm install fastify @fastify/jwt @fastify/multipart @fastify/cors @supabase/supabase-js @anthropic-ai/sdk voyageai pdf-parse zod
```

- [ ] **Instalar dependências de desenvolvimento**

```bash
npm install -D typescript ts-node @types/node @types/pdf-parse jest ts-jest @types/jest
```

- [ ] **Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Criar `jest.config.ts`**

```typescript
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  clearMocks: true,
}

export default config
```

- [ ] **Criar `.env.example`**

```
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
ANTHROPIC_API_KEY=your-anthropic-key
VOYAGE_API_KEY=your-voyage-key
FRONTEND_URL=http://localhost:5173
```

- [ ] **Adicionar scripts em `package.json`**

```json
{
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch"
  }
}
```

- [ ] **Criar `.gitignore`**

```
node_modules/
dist/
.env
*.env.local
```

- [ ] **Commit inicial**

```bash
git init
git add .
git commit -m "chore: project scaffolding"
```

---

## Sessão 2 — Migrations do Banco de Dados

### Task 2: Migrations SQL (Supabase)

**Files:**
- Create: `supabase/migrations/001_enable_pgvector.sql`
- Create: `supabase/migrations/002_create_tables.sql`
- Create: `supabase/migrations/003_create_indexes.sql`

- [ ] **Criar `001_enable_pgvector.sql`**

```sql
create extension if not exists vector;
```

- [ ] **Criar `002_create_tables.sql`**

```sql
-- Employees
create table employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text not null,
  role text not null check (role in ('employee', 'manager')),
  cnpj text,
  salary numeric(12, 2) not null check (salary > 0),
  hired_at date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Salary adjustments
create table salary_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  previous_salary numeric(12, 2) not null,
  new_salary numeric(12, 2) not null check (new_salary > 0),
  reason text not null,
  adjusted_at timestamptz default now()
);

-- Machines
create table machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  model text not null,
  serial_number text not null unique,
  year int not null,
  manual_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Machine manual chunks (RAG)
create table machine_chunks (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  content text not null,
  embedding vector(1024),
  chunk_index int not null
);

-- Contracts
create table contracts (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_cnpj text not null,
  description text not null,
  start_date date not null,
  end_date date not null,
  file_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Jobs
create table jobs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  machine_id uuid not null references machines(id),
  job_type text not null check (job_type in ('maintenance', 'implementation')),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  description text not null,
  scheduled_date date not null,
  city text not null,
  state char(2) not null,
  accommodation boolean not null default false,
  car boolean not null default false,
  start_time text not null,
  end_time text not null,
  notes text,
  report_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Job reports
create table job_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  content text not null,
  submitted_at timestamptz default now(),
  employee_id uuid not null references employees(id)
);

-- Evidences
create table evidences (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references job_reports(id) on delete cascade,
  url text not null,
  mime_type text not null,
  file_name text not null,
  type text not null check (type in ('image', 'pdf', 'video', 'audio'))
);

-- Transactions
create table transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('credit', 'debit')),
  amount numeric(12, 2) not null check (amount > 0),
  description text not null,
  category text not null,
  destination text,
  date date not null,
  created_at timestamptz default now()
);

-- Notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz default now()
);

-- FK: jobs → job_reports (after both tables exist)
alter table jobs add constraint jobs_report_id_fkey
  foreign key (report_id) references job_reports(id) on delete set null;
```

- [ ] **Criar `003_create_indexes.sql`**

```sql
-- Fast vector similarity search por máquina
create index on machine_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Listagens comuns
create index on jobs (employee_id);
create index on jobs (status);
create index on jobs (scheduled_date);
create index on notifications (user_id, read);
create index on salary_adjustments (employee_id);
create index on evidences (report_id);
```

- [ ] **Executar migrations no Supabase**

No dashboard do Supabase → SQL Editor → executar cada arquivo em ordem. Ou via Supabase CLI:

```bash
npx supabase db push
```

- [ ] **Commit**

```bash
git add supabase/
git commit -m "feat: database migrations"
```

---

## Sessão 3 — App Factory + Plugins Core

### Task 3: Types compartilhados

**Files:**
- Create: `src/types/index.ts`

- [ ] **Criar `src/types/index.ts`**

```typescript
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
```

### Task 4: Plugin Supabase

**Files:**
- Create: `src/plugins/supabase.ts`

- [ ] **Escrever o teste**

```typescript
// tests/helpers/build-app.ts
import Fastify from 'fastify'

// Mock Supabase client injetado nos testes
export const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  order: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  storage: { from: jest.fn() },
  rpc: jest.fn(),
}

export function buildApp() {
  const app = Fastify({ logger: false })
  app.decorate('supabase', mockSupabase)
  app.decorateRequest('user', null)
  // Bypass auth in tests: set user from header x-test-user
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-test-user']
    if (raw) req.user = JSON.parse(raw as string)
  })
  return app
}
```

- [ ] **Criar `src/plugins/supabase.ts`**

```typescript
import fp from 'fastify-plugin'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseClient
  }
}

const supabasePlugin: FastifyPluginAsync = async (fastify) => {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  fastify.decorate('supabase', client)
}

export default fp(supabasePlugin)
```

> Install `fastify-plugin`: `npm install fastify-plugin`

### Task 5: Plugin Auth (JWT)

**Files:**
- Create: `src/plugins/auth.ts`

- [ ] **Criar `src/plugins/auth.ts`**

```typescript
import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { JwtPayload, Role } from '@/types'

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email: string; role: Role; name: string }
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(import('@fastify/jwt'), {
    secret: process.env.SUPABASE_JWT_SECRET!,
  })

  fastify.decorate('authenticate', async (req: FastifyRequest) => {
    await req.jwtVerify()
    const payload = req.user as unknown as JwtPayload
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: (payload.user_metadata?.role ?? 'employee') as Role,
      name: payload.user_metadata?.name ?? payload.email,
    }
  })
}

export default fp(authPlugin)
```

> `npm install @fastify/jwt`

### Task 6: App Factory e Index

**Files:**
- Create: `src/app.ts`
- Create: `src/index.ts`

- [ ] **Criar `src/app.ts`**

```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import supabasePlugin from '@/plugins/supabase'
import authPlugin from '@/plugins/auth'
import employeesRoute from '@/routes/employees'
import machinesRoute from '@/routes/machines'
import contractsRoute from '@/routes/contracts'
import jobsRoute from '@/routes/jobs'
import reportsRoute from '@/routes/reports'
import transactionsRoute from '@/routes/transactions'
import notificationsRoute from '@/routes/notifications'
import chatRoute from '@/routes/chat'

export function buildApp() {
  const app = Fastify({ logger: { level: 'info' } })

  app.register(cors, { origin: process.env.FRONTEND_URL ?? '*' })
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }) // 50MB
  app.register(supabasePlugin)
  app.register(authPlugin)

  // Routes
  app.register(employeesRoute, { prefix: '/employees' })
  app.register(machinesRoute, { prefix: '/machines' })
  app.register(contractsRoute, { prefix: '/contracts' })
  app.register(jobsRoute, { prefix: '/jobs' })
  app.register(reportsRoute)
  app.register(transactionsRoute, { prefix: '/transactions' })
  app.register(notificationsRoute, { prefix: '/notifications' })
  app.register(chatRoute, { prefix: '/chat' })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
```

- [ ] **Criar `src/index.ts`**

```typescript
import 'dotenv/config'
import { buildApp } from './app'

const app = buildApp()

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1) }
})
```

> `npm install @fastify/cors @fastify/multipart dotenv`

- [ ] **Commit**

```bash
git add src/ && git commit -m "feat: app factory, supabase plugin, auth plugin"
```

---

## Sessão 4 — CRUD Funcionários

### Task 7: Employees route

**Files:**
- Create: `src/routes/employees.ts`
- Create: `tests/routes/employees.test.ts`

- [ ] **Escrever `tests/routes/employees.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import employeesRoute from '@/routes/employees'

const managerUser = JSON.stringify({ id: 'mgr-1', email: 'mgr@sr.com', role: 'manager', name: 'Mgr' })

describe('GET /employees', () => {
  it('retorna lista de funcionários', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    const rows = [{ id: 'emp-1', name: 'João', email: 'joao@sr.com' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })

    const res = await app.inject({
      method: 'GET', url: '/employees',
      headers: { 'x-test-user': managerUser },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(rows)
  })
})

describe('POST /employees', () => {
  it('cria funcionário e retorna 201', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    const body = { name: 'Maria', email: 'maria@sr.com', phone: '11999990001',
      role: 'employee', salary: 5000, hired_at: '2024-01-01' }
    const created = { id: 'emp-new', ...body }

    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: created, error: null }),
        }),
      }),
    })

    const res = await app.inject({
      method: 'POST', url: '/employees',
      headers: { 'x-test-user': managerUser, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('emp-new')
  })
})
```

- [ ] **Rodar o teste para confirmar que falha**

```bash
npm test -- employees
```

Esperado: FAIL — módulo `@/routes/employees` não existe.

- [ ] **Criar `src/routes/employees.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const employeeBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(8),
  role: z.enum(['employee', 'manager']),
  cnpj: z.string().optional(),
  salary: z.coerce.number().positive(),
  hired_at: z.string().min(1),
})

const salaryAdjBody = z.object({
  new_salary: z.coerce.number().positive(),
  reason: z.string().min(5),
})

const employees: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /employees
  fastify.get('/', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('employees').select('*').order('name')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /employees/:id
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('employees').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // POST /employees
  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    if (!['manager', 'admin'].includes((req as any).user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = employeeBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('employees').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // PUT /employees/:id
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = employeeBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('employees').update({
      ...parsed.data, updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // DELETE /employees/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('employees').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // GET /employees/:id/salary-adjustments
  fastify.get<{ Params: { id: string } }>('/:id/salary-adjustments', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('salary_adjustments')
      .select('*').eq('employee_id', req.params.id).order('adjusted_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // POST /employees/:id/salary-adjustments
  fastify.post<{ Params: { id: string } }>('/:id/salary-adjustments', { onRequest: [guard] }, async (req, reply) => {
    const parsed = salaryAdjBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    // busca salário atual
    const { data: emp } = await db.from('employees').select('salary').eq('id', req.params.id).single()
    if (!emp) return reply.status(404).send({ error: 'Employee not found' })
    const adj = { employee_id: req.params.id, previous_salary: emp.salary, new_salary: parsed.data.new_salary, reason: parsed.data.reason }
    const [{ data }, _] = await Promise.all([
      db.from('salary_adjustments').insert(adj).select().single(),
      db.from('employees').update({ salary: parsed.data.new_salary, updated_at: new Date().toISOString() }).eq('id', req.params.id),
    ])
    return reply.status(201).send(data)
  })
}

export default employees
```

- [ ] **Rodar os testes e confirmar que passam**

```bash
npm test -- employees
```

Esperado: PASS

- [ ] **Commit**

```bash
git add src/routes/employees.ts tests/routes/employees.test.ts
git commit -m "feat: employees CRUD + salary adjustments"
```

---

## Sessão 5 — CRUD Máquinas

### Task 8: Machines route

**Files:**
- Create: `src/routes/machines.ts`
- Create: `tests/routes/machines.test.ts`

- [ ] **Escrever `tests/routes/machines.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import machinesRoute from '@/routes/machines'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })

describe('GET /machines', () => {
  it('retorna lista', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const rows = [{ id: 'm-1', name: 'TR-500' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /machines/:id/jobs', () => {
  it('retorna histórico de trabalhos da máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const jobs = [{ id: 'j-1', employee_name: 'João', scheduled_date: '2026-03-10' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: jobs, error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-1/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(jobs)
  })
})
```

- [ ] **Rodar para confirmar falha**

```bash
npm test -- machines
```

- [ ] **Criar `src/routes/machines.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { indexMachineManual } from '@/services/rag.service'
import { uploadFile } from '@/services/storage.service'

const machineBody = z.object({
  name: z.string().min(2),
  brand: z.string().min(1),
  model: z.string().min(1),
  serial_number: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1),
  manual_url: z.string().optional(),
})

const machines: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('machines').select('*').order('name')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('machines').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = machineBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('machines').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = machineBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('machines').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('machines').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // GET /machines/:id/jobs
  fastify.get<{ Params: { id: string } }>('/:id/jobs', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db
      .from('jobs')
      .select(`id, scheduled_date, city, state, job_type, status, employees(name)`)
      .eq('machine_id', req.params.id)
      .order('scheduled_date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return (data ?? []).map((j: any) => ({ ...j, employee_name: j.employees?.name }))
  })

  // POST /machines/:id/manual
  fastify.post<{ Params: { id: string } }>('/:id/manual', { onRequest: [guard] }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    const buffer = await file.toBuffer()
    const url = await uploadFile(fastify.supabase, 'machine-manuals', `${req.params.id}.pdf`, buffer, 'application/pdf')
    await db.from('machines').update({ manual_url: url, updated_at: new Date().toISOString() }).eq('id', req.params.id)
    // Indexa async (não bloqueia a resposta)
    indexMachineManual(fastify.supabase, req.params.id, buffer).catch(console.error)
    return { url }
  })
}

export default machines
```

- [ ] **Rodar testes**

```bash
npm test -- machines
```

- [ ] **Commit**

```bash
git add src/routes/machines.ts tests/routes/machines.test.ts
git commit -m "feat: machines CRUD + manual upload"
```

---

## Sessão 6 — CRUD Contratos

### Task 9: Contracts route

**Files:**
- Create: `src/routes/contracts.ts`
- Create: `tests/routes/contracts.test.ts`

- [ ] **Escrever `tests/routes/contracts.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import contractsRoute from '@/routes/contracts'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })

describe('GET /contracts/expiring', () => {
  it('retorna contratos que vencem nos próximos 30 dias', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const today = new Date().toISOString().slice(0, 10)
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const rows = [{ id: 'c-1', client_name: 'ABC', end_date: in30 }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    })

    const res = await app.inject({ method: 'GET', url: '/contracts/expiring', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})
```

- [ ] **Criar `src/routes/contracts.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'

const contractBody = z.object({
  client_name: z.string().min(2),
  client_cnpj: z.string().min(14),
  description: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
}).refine(d => new Date(d.end_date) >= new Date(d.start_date), {
  message: 'end_date must be after start_date', path: ['end_date'],
})

const contracts: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /contracts/expiring — deve vir ANTES de /:id
  fastify.get('/expiring', { onRequest: [guard] }, async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const { data, error } = await db.from('contracts').select('*')
      .gte('end_date', today).lte('end_date', in30).order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('contracts').select('*').order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('contracts').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = contractBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('contracts').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = contractBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('contracts').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('contracts').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  fastify.post<{ Params: { id: string } }>('/:id/file', { onRequest: [guard] }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    const buffer = await file.toBuffer()
    const url = await uploadFile(fastify.supabase, 'contract-files', `${req.params.id}.pdf`, buffer, 'application/pdf')
    await db.from('contracts').update({ file_url: url, updated_at: new Date().toISOString() }).eq('id', req.params.id)
    return { url }
  })
}

export default contracts
```

- [ ] **Rodar testes**

```bash
npm test -- contracts
```

- [ ] **Commit**

```bash
git add src/routes/contracts.ts tests/routes/contracts.test.ts
git commit -m "feat: contracts CRUD + file upload + expiring endpoint"
```

---

## Sessão 7 — CRUD Trabalhos

### Task 10: Jobs route

**Files:**
- Create: `src/routes/jobs.ts`
- Create: `tests/routes/jobs.test.ts`

- [ ] **Escrever `tests/routes/jobs.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import jobsRoute from '@/routes/jobs'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('GET /jobs — manager vê todos', () => {
  it('retorna todos os jobs', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{ id: 'j-1', status: 'scheduled' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('GET /jobs — employee vê apenas os próprios', () => {
  it('filtra por employee_id', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{ id: 'j-2', employee_id: 'emp-1' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })
})

describe('PATCH /jobs/:id/cancel', () => {
  it('muda status para cancelled', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const updated = { id: 'j-1', status: 'cancelled' }
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      }),
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('cancelled')
  })
})
```

- [ ] **Criar `src/routes/jobs.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { insertNotification } from '@/services/notification.service'

const jobBody = z.object({
  employee_id: z.string().min(1),
  machine_id: z.string().min(1),
  job_type: z.enum(['maintenance', 'implementation']),
  description: z.string().min(1),
  scheduled_date: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  accommodation: z.boolean(),
  car: z.boolean(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  notes: z.string().optional(),
})

const jobs: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /jobs
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    let query = db.from('jobs')
      .select(`*, employees(name), machines(name)`)
    if (req.user.role === 'employee') {
      // Busca employee_id pelo user_id do JWT
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp) return []
      query = (query as any).eq('employee_id', emp.id)
    }
    const { data, error } = await (query as any).order('scheduled_date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return (data ?? []).map((j: any) => ({
      ...j,
      employee_name: j.employees?.name,
      machine_name: j.machines?.name,
      employees: undefined,
      machines: undefined,
    }))
  })

  // GET /jobs/:id
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('jobs')
      .select(`*, employees(name), machines(name, manual_url)`)
      .eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return { ...data, employee_name: data.employees?.name, machine: data.machines }
  })

  // POST /jobs
  fastify.post('/', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = jobBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('jobs').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    // Notificar funcionário
    const { data: emp } = await db.from('employees').select('user_id').eq('id', parsed.data.employee_id).single()
    if (emp?.user_id) {
      await insertNotification(db, emp.user_id,
        'Novo trabalho agendado',
        `Você tem um trabalho agendado para ${parsed.data.scheduled_date} em ${parsed.data.city}/${parsed.data.state}.`)
    }
    return reply.status(201).send(data)
  })

  // PUT /jobs/:id
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = jobBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('jobs').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // PATCH /jobs/:id/cancel
  fastify.patch<{ Params: { id: string } }>('/:id/cancel', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })
}

export default jobs
```

- [ ] **Rodar testes**

```bash
npm test -- jobs
```

- [ ] **Commit**

```bash
git add src/routes/jobs.ts tests/routes/jobs.test.ts
git commit -m "feat: jobs CRUD + cancel + notification on create"
```

---

## Sessão 8 — Relatórios e Evidências

### Task 11: Reports route

**Files:**
- Create: `src/routes/reports.ts`
- Create: `tests/routes/reports.test.ts`

- [ ] **Escrever `tests/routes/reports.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import reportsRoute from '@/routes/reports'

const emp = JSON.stringify({ id: 'emp-user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('POST /jobs/:id/report', () => {
  it('cria relatório e muda status do job para completed', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    // Mock: buscar employee pelo user_id
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'job_reports') return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'rpt-1', job_id: 'j-1', content: '<p>ok</p>' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST', url: '/jobs/j-1/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>Relatório ok</p>' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('rpt-1')
  })
})
```

- [ ] **Criar `src/routes/reports.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'

const reportBody = z.object({
  content: z.string().min(1, 'Relatório não pode estar vazio'),
})

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'audio/mpeg']
function mimeToType(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  return 'audio'
}

const reports: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /jobs/:id/report
  fastify.get<{ Params: { id: string } }>('/jobs/:id/report', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('job_reports')
      .select(`*, evidences(*)`)
      .eq('job_id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Report not found' })
    return data
  })

  // POST /jobs/:id/report
  fastify.post<{ Params: { id: string } }>('/jobs/:id/report', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = reportBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
    if (!emp) return reply.status(403).send({ error: 'Employee not found' })
    const { data, error } = await db.from('job_reports')
      .insert({ job_id: req.params.id, content: parsed.data.content, employee_id: emp.id })
      .select().single()
    if (error) return reply.status(500).send({ error: error.message })
    // Atualiza job: status=completed, report_id
    await db.from('jobs').update({ status: 'completed', report_id: data.id, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
    return reply.status(201).send(data)
  })

  // POST /reports/:id/evidences
  fastify.post<{ Params: { id: string } }>('/reports/:id/evidences', { onRequest: [guard] }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    if (!ALLOWED_MIME.includes(file.mimetype))
      return reply.status(400).send({ error: `Tipo ${file.mimetype} não permitido` })
    const buffer = await file.toBuffer()
    const key = `${req.params.id}/${Date.now()}-${file.filename}`
    const url = await uploadFile(fastify.supabase, 'evidences', key, buffer, file.mimetype)
    const { data, error } = await db.from('evidences').insert({
      report_id: req.params.id, url, mime_type: file.mimetype,
      file_name: file.filename, type: mimeToType(file.mimetype),
    }).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })
}

export default reports
```

- [ ] **Rodar testes**

```bash
npm test -- reports
```

- [ ] **Commit**

```bash
git add src/routes/reports.ts tests/routes/reports.test.ts
git commit -m "feat: reports submit + evidence upload"
```

---

## Sessão 9 — Transações e Notificações

### Task 12: Transactions route

**Files:**
- Create: `src/routes/transactions.ts`
- Create: `tests/routes/transactions.test.ts`

- [ ] **Escrever `tests/routes/transactions.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import transactionsRoute from '@/routes/transactions'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })

describe('POST /transactions', () => {
  it('rejeita amount <= 0', async () => {
    const app = buildApp()
    app.register(transactionsRoute, { prefix: '/transactions' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/transactions',
      headers: { 'x-test-user': mgr, 'content-type': 'application/json' },
      payload: { type: 'credit', amount: -100, description: 'test', category: 'cat', date: '2026-03-01' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('cria transação e retorna 201', async () => {
    const app = buildApp()
    app.register(transactionsRoute, { prefix: '/transactions' })
    await app.ready()
    const tx = { id: 'tx-1', type: 'credit', amount: 1000 }
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: tx, error: null }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST', url: '/transactions',
      headers: { 'x-test-user': mgr, 'content-type': 'application/json' },
      payload: { type: 'credit', amount: 1000, description: 'Pagamento', category: 'Serviços', date: '2026-03-01' },
    })
    expect(res.statusCode).toBe(201)
  })
})
```

- [ ] **Criar `src/routes/transactions.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const txBody = z.object({
  type: z.enum(['credit', 'debit']),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().min(1),
  category: z.string().min(1),
  destination: z.string().optional(),
  date: z.string().min(1),
})

const transactions: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('transactions').select('*').order('date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = txBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('transactions').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('transactions').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })
}

export default transactions
```

### Task 13: Notifications route

**Files:**
- Create: `src/routes/notifications.ts`
- Create: `tests/routes/notifications.test.ts`

- [ ] **Escrever `tests/routes/notifications.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import notificationsRoute from '@/routes/notifications'

const emp = JSON.stringify({ id: 'user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('PATCH /notifications/read-all', () => {
  it('marca todas como lidas', async () => {
    const app = buildApp()
    app.register(notificationsRoute, { prefix: '/notifications' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })
    const res = await app.inject({ method: 'PATCH', url: '/notifications/read-all', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(204)
  })
})
```

- [ ] **Criar `src/routes/notifications.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'

const notifications: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    const { data, error } = await db.from('notifications')
      .select('*').eq('user_id', req.user.id).order('created_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // PATCH /notifications/read-all — deve vir ANTES de /:id
  fastify.patch('/read-all', { onRequest: [guard] }, async (req: any, reply) => {
    const { error } = await db.from('notifications').update({ read: true }).eq('user_id', req.user.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  fastify.patch<{ Params: { id: string } }>('/:id/read', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('notifications').update({ read: true })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })
}

export default notifications
```

- [ ] **Rodar todos os testes até aqui**

```bash
npm test
```

Esperado: todos PASS.

- [ ] **Commit**

```bash
git add src/routes/transactions.ts src/routes/notifications.ts tests/
git commit -m "feat: transactions CRUD + notifications routes"
```

---

## Sessão 10 — Serviços Compartilhados

### Task 14: Storage service

**Files:**
- Create: `src/services/storage.service.ts`

- [ ] **Criar `src/services/storage.service.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export async function uploadFile(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType, upsert: true,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
```

### Task 15: Notification service

**Files:**
- Create: `src/services/notification.service.ts`

- [ ] **Criar `src/services/notification.service.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export async function insertNotification(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  message: string
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({ user_id: userId, title, message })
  if (error) console.error('Failed to insert notification:', error.message)
}
```

- [ ] **Commit**

```bash
git add src/services/storage.service.ts src/services/notification.service.ts
git commit -m "feat: storage and notification services"
```

---

## Sessão 11 — Pipeline RAG

### Task 16: RAG service (indexing + querying)

**Files:**
- Create: `src/services/rag.service.ts`
- Create: `tests/services/rag.service.test.ts`

- [ ] **Escrever `tests/services/rag.service.test.ts`**

```typescript
import { chunkText } from '@/services/rag.service'

describe('chunkText', () => {
  it('divide texto em chunks de ~500 chars com sobreposição de ~50', () => {
    const text = 'A'.repeat(1200)
    const chunks = chunkText(text, 500, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].length).toBeLessThanOrEqual(510)
    // sobreposição: início do chunk[1] repete final do chunk[0]
    const overlap = chunks[0].slice(-50)
    expect(chunks[1].startsWith(overlap)).toBe(true)
  })

  it('retorna um único chunk se texto for curto', () => {
    const chunks = chunkText('texto curto', 500, 50)
    expect(chunks).toHaveLength(1)
  })
})
```

- [ ] **Rodar para confirmar falha**

```bash
npm test -- rag
```

- [ ] **Criar `src/services/rag.service.ts`**

```typescript
import pdfParse from 'pdf-parse'
import Anthropic from '@anthropic-ai/sdk'
import { VoyageAI } from 'voyageai'
import type { SupabaseClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const voyage = new VoyageAI({ apiKey: process.env.VOYAGE_API_KEY })

const EMBEDDING_MODEL = 'voyage-3'
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50

/** Divide texto em chunks sobrepostos */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + size))
    start += size - overlap
  }
  return chunks
}

/** Extrai texto de um buffer PDF */
async function extractText(pdfBuffer: Buffer): Promise<string> {
  const result = await pdfParse(pdfBuffer)
  if (!result.text.trim()) throw new Error('PDF não contém texto extraível')
  return result.text
}

/** Embeda um array de strings via Voyage AI */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const result = await voyage.embed({ input: texts, model: EMBEDDING_MODEL })
  return result.data!.map((d) => d.embedding!)
}

/** Indexa o manual de uma máquina (chamado após upload) */
export async function indexMachineManual(
  supabase: SupabaseClient,
  machineId: string,
  pdfBuffer: Buffer
): Promise<void> {
  const text = await extractText(pdfBuffer)
  const chunks = chunkText(text)
  const embeddings = await embedTexts(chunks)

  // Remove chunks antigos da máquina
  await supabase.from('machine_chunks').delete().eq('machine_id', machineId)

  // Upsert novos chunks
  const rows = chunks.map((content, i) => ({
    machine_id: machineId,
    content,
    embedding: embeddings[i],
    chunk_index: i,
  }))
  const { error } = await supabase.from('machine_chunks').insert(rows)
  if (error) throw new Error(`Failed to index chunks: ${error.message}`)
}

/** Responde uma pergunta sobre uma máquina usando RAG + Claude */
export async function answerQuestion(
  supabase: SupabaseClient,
  machineId: string,
  question: string
): Promise<string> {
  // 1. Embed a pergunta
  const [queryEmbedding] = await embedTexts([question])

  // 2. Buscar top-5 chunks via pgvector
  const { data: chunks, error } = await supabase.rpc('match_machine_chunks', {
    p_machine_id: machineId,
    p_embedding: queryEmbedding,
    p_limit: 5,
  })
  if (error) throw new Error(`Vector search failed: ${error.message}`)
  if (!chunks || chunks.length === 0)
    throw new Error('Manual não indexado para esta máquina')

  const context = (chunks as { content: string }[]).map((c) => c.content).join('\n\n---\n\n')

  // 3. Chamar Claude
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: `Você é um assistente técnico especializado. Responda APENAS com base no contexto do manual fornecido. Se a resposta não estiver no contexto, diga "Não encontrei essa informação no manual."`,
    messages: [
      { role: 'user', content: `Contexto do manual:\n${context}\n\nPergunta: ${question}` },
    ],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}
```

- [ ] **Adicionar SQL function para busca vetorial**

Execute no Supabase SQL Editor:

```sql
create or replace function match_machine_chunks(
  p_machine_id uuid,
  p_embedding vector(1024),
  p_limit int default 5
)
returns table (id uuid, content text, chunk_index int, similarity float)
language sql stable
as $$
  select id, content, chunk_index,
         1 - (embedding <=> p_embedding) as similarity
  from machine_chunks
  where machine_id = p_machine_id
  order by embedding <=> p_embedding
  limit p_limit;
$$;
```

- [ ] **Rodar testes**

```bash
npm test -- rag
```

- [ ] **Commit**

```bash
git add src/services/rag.service.ts tests/services/rag.service.test.ts
git commit -m "feat: RAG service — chunk, embed, index, query"
```

---

## Sessão 12 — Endpoint Chat

### Task 17: Chat route

**Files:**
- Create: `src/routes/chat.ts`
- Create: `tests/routes/chat.test.ts`

- [ ] **Escrever `tests/routes/chat.test.ts`**

```typescript
import { buildApp, mockSupabase } from '../helpers/build-app'
import chatRoute from '@/routes/chat'
import * as ragService from '@/services/rag.service'

jest.mock('@/services/rag.service')

const emp = JSON.stringify({ id: 'user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('POST /chat', () => {
  it('retorna resposta da IA', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()

    jest.mocked(ragService.answerQuestion).mockResolvedValue('O óleo deve ser trocado a cada 500h.')

    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineId: 'machine-1', message: 'Qual a frequência de troca de óleo?' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answer).toBe('O óleo deve ser trocado a cada 500h.')
  })

  it('retorna 400 para payload inválido', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineId: '', message: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Criar `src/routes/chat.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { answerQuestion } from '@/services/rag.service'

const chatBody = z.object({
  machineId: z.string().min(1, 'Selecione uma máquina'),
  message: z.string().min(1, 'Mensagem não pode estar vazia'),
})

const chat: FastifyPluginAsync = async (fastify) => {
  const guard = (fastify as any).authenticate

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    try {
      const answer = await answerQuestion(fastify.supabase, parsed.data.machineId, parsed.data.message)
      return { answer }
    } catch (err: any) {
      if (err.message?.includes('não indexado')) return reply.status(404).send({ error: err.message })
      return reply.status(502).send({ error: 'Erro ao consultar a IA. Tente novamente.' })
    }
  })
}

export default chat
```

- [ ] **Rodar todos os testes**

```bash
npm test
```

Esperado: PASS em todos.

- [ ] **Commit**

```bash
git add src/routes/chat.ts tests/routes/chat.test.ts
git commit -m "feat: chat RAG endpoint"
```

---

## Sessão 13 — Deploy no Railway

### Task 18: Configuração Railway

**Files:**
- Create: `railway.toml`
- Create: `Dockerfile` (opcional — Railway detecta Node.js automaticamente)

- [ ] **Criar `railway.toml`**

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

- [ ] **Garantir que o build TypeScript funciona**

```bash
npm run build
```

Esperado: diretório `dist/` gerado sem erros.

- [ ] **Publicar no Railway**

1. Crie um projeto no [railway.app](https://railway.app)
2. Conecte o repositório GitHub do `sr-energy-api`
3. Em **Variables**, adicione:
   - `PORT=3000`
   - `SUPABASE_URL=<url>`
   - `SUPABASE_SERVICE_ROLE_KEY=<key>`
   - `SUPABASE_JWT_SECRET=<secret>`
   - `ANTHROPIC_API_KEY=<key>`
   - `VOYAGE_API_KEY=<key>`
   - `FRONTEND_URL=<vercel-url>`
4. Railway fará o deploy automático ao push na branch `main`

- [ ] **Atualizar o frontend**

No projeto `sr-energy-front`, atualize `.env.production`:

```
VITE_API_BASE_URL=https://sr-energy-api.up.railway.app
```

- [ ] **Smoke test do deploy**

```bash
curl https://sr-energy-api.up.railway.app/health
# esperado: {"status":"ok"}
```

- [ ] **Commit final**

```bash
git add railway.toml
git commit -m "chore: railway deployment config"
```

---

## Checklist Final

- [ ] Migrations rodando no Supabase (pgvector + todas as tabelas)
- [ ] `npm test` — todos os testes passando
- [ ] `npm run build` — sem erros TypeScript
- [ ] `/health` endpoint respondendo no Railway
- [ ] Frontend conectado à URL do Railway
- [ ] Upload de manual PDF → chunks indexados no pgvector
- [ ] Chat retornando respostas baseadas no manual
- [ ] Notificações criadas no Supabase → Realtime entrega ao frontend
