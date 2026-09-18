import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { insertNotification } from '@/services/notification.service'
import { requireRoles } from '@/plugins/authorize'
import { getSignedUrl } from '@/services/storage.service'
import { record as recordAuditEvent } from '@/services/audit-log.service'

// Sub-plano 01 (épico ajustes-cliente-2026-09), item 1: 10 tipos de serviço
// novos (slugs), substituindo os 2 antigos ('maintenance'/'implementation' —
// dados legados viram NULL na migration, ver
// supabase/migrations/030_pc_os_vinculo_direto.sql). Mantido em sincronia
// manual com `JobType` em src/types/index.ts (mesmo padrão de acoplamento
// solto já usado por `JobStatus`, que também não é validado via zod aqui).
const jobTypeEnum = z.enum([
  'pre_commissioning', 'commissioning', 'pre_taf', 'taf', 'technical_visit',
  'field_survey', 'studies', 'bench_tests', 'energization_support', 'development',
])

// Sub-plano 01, item 4: separa create de update (antes o PUT reusava o mesmo
// schema completo do POST, exigindo reenviar TODOS os campos até pra editar
// um só — bloqueava completar a OS "esqueleto" nascida do aceite de PC aos
// poucos). `jobUpdateBody` é um `.partial()` puro de `jobCreateBody` — sem
// `.refine()` em nenhum dos dois, então o gap zod v4 .partial()+.refine() não
// se aplica aqui (ver supabase/migrations/027_fix_proposal_recurring_null.sql
// pro caso que motivou o cuidado). `description` fica opcional em ambos (a UI
// deixou de exigi-la, e a OS esqueleto nasce sem ela).
const jobCreateBody = z.object({
  employee_id: z.string().min(1),
  machine_id: z.string().min(1),
  job_type: jobTypeEnum,
  description: z.string().optional(),
  scheduled_date: z.string().min(1),
  // Sub-plano: migration 023_job_date_range.sql. Data de fim opcional — ausente
  // significa serviço de um dia só (comportamento atual, sem mudança). O CHECK
  // constraint do banco garante scheduled_end_date >= scheduled_date quando ambos
  // preenchidos; não duplicamos essa validação aqui no Zod.
  scheduled_end_date: z.string().optional(),
  city: z.string().min(1),
  state: z.string().length(2),
  accommodation: z.boolean(),
  car: z.boolean(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  notes: z.string().optional(),
  address: z.string().optional(),
  car_pickup_time: z.string().optional(),
  car_return_time: z.string().optional(),
  car_pickup_address: z.string().optional(),
  os_code: z.string().optional(),
  // Sub-plano 04 (fluxo PC-OS), item 4: campos estendidos de OS (ver
  // supabase/migrations/017_jobs_pc_os_extension.sql). Todos opcionais porque
  // uma OS nasce "esqueleto" ao aceitar uma PC (só número/contrato/status) e é
  // completada depois pelo gestor.
  scope_detail: z.string().optional(),
  bag_id: z.string().optional(),
  service_address: z.string().optional(),
  client_contact_name: z.string().optional(),
  client_contact_phone: z.string().optional(),
  // Múltiplos colaboradores por OS (job_employees) — administrativo, só
  // admin/manager atribuem quem trabalha na OS.
  employee_ids: z.array(z.string().min(1)).optional(),
  // Sub-plano 01: vínculos com PC/cliente/contrato grande — normalmente já
  // vêm preenchidos pelo `accept_proposal` (RPC direto, não passa por este
  // schema), mas o gestor pode setar/corrigir manualmente numa OS existente
  // (ex.: vincular uma OS avulsa a um contrato grande depois).
  proposal_id: z.string().optional(),
  client_id: z.string().optional(),
  contract_id: z.string().optional(),
})

const jobUpdateBody = jobCreateBody.partial()

// CRITICAL-01: employee não pode alterar campos administrativos (quem faz o job,
// em qual máquina, quando está agendado, a quê PC/cliente/contrato pertence) —
// só admin/manager, via jobUpdateBody completo. Sub-plano 04: employee_ids
// também é administrativo (define quem está na OS).
const employeeJobUpdateBody = jobUpdateBody.omit({
  employee_id: true,
  machine_id: true,
  scheduled_date: true,
  scheduled_end_date: true,
  employee_ids: true,
  proposal_id: true,
  client_id: true,
  contract_id: true,
})

// Sub-plano 04 (fluxo PC-OS), item 4: `employee_id` deixa de ser a única fonte de
// vínculo colaborador↔OS (agora many-to-many via `job_employees`, ver
// supabase/migrations/017_jobs_pc_os_extension.sql). `employee_id` continua existindo
// como assignee legado usado pelo fluxo de provisionamento de ferramentas
// (create_job_with_provisioning), então checamos as DUAS fontes: um funcionário tem
// acesso ao job se aparece em `jobs.employee_id` (legado) OU em `job_employees`
// (novo, múltiplos colaboradores). Isso preserva o achado de IDOR do sub-plano 01
// (ninguém ganha acesso a job alheio) enquanto adiciona suporte a múltiplos
// colaboradores por OS.
export async function isJobAssignedToEmployee(db: any, jobId: string, employeeId: string, legacyEmployeeId?: string | null): Promise<boolean> {
  if (legacyEmployeeId === employeeId) return true
  const { data } = await db.from('job_employees').select('job_id').eq('job_id', jobId).eq('employee_id', employeeId).maybeSingle()
  return !!data
}

// Sub-plano 02 (épico ajustes-cliente-2026-09), item 6: wrapper de conveniência
// pra callers que só têm jobId+employeeId à mão (ex.: reports.ts) e não
// querem reimplementar a checagem de dupla fonte (employee_id legado OU
// job_employees) — delega pra `isJobAssignedToEmployee`, única fonte de
// verdade da regra. Usado por `PATCH /jobs/:id/start` e por
// `assertJobOwnership` (reports.ts), que hoje só olhava `jobs.employee_id` e
// ignorava `job_employees` (achado da exploração do sub-plano 02).
export async function isJobMember(db: any, jobId: string, employeeId: string): Promise<boolean> {
  const { data: job } = await db.from('jobs').select('employee_id').eq('id', jobId).single()
  if (!job) return false
  return isJobAssignedToEmployee(db, jobId, employeeId, job.employee_id)
}

// CRITICAL-01/07 (IDOR): busca o employee.id do usuário logado e confere se o job
// pertence a ele (via employee_id legado OU job_employees). admin/manager sempre
// passam. Retorna null se acesso deve ser negado (já responde 404 nesse caso — não
// vazamos 403 para não confirmar a existência do job de outro colaborador).
async function loadOwnedJob(db: any, req: any, reply: any): Promise<{ id: string; employee_id: string | null } | null> {
  if (req.user.role === 'admin' || req.user.role === 'manager') {
    const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', req.params.id).single()
    if (error || !job) {
      reply.status(404).send({ error: 'Not found' })
      return null
    }
    return job
  }

  const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
  if (!emp) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', req.params.id).single()
  if (error || !job) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  const owned = await isJobAssignedToEmployee(db, job.id, emp.id, job.employee_id)
  if (!owned) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  return job
}

const jobs: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /jobs — suporta ?contractId= (sub-plano 01: front pagina a aba "OS"
  // da tela do contrato).
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    // `clients(razao_social)`: embed direto via `jobs.client_id` (sub-plano
    // 01 — fonte de verdade nova). `contracts(number, clients(razao_social))`
    // continua servindo de fallback pra OS legadas/sem `client_id` próprio,
    // que só tinham o cliente resolvido através do contrato. `jobs.client_id`
    // e `jobs.contract_id` têm cada um uma única FK possível (pra `clients` e
    // `contracts` respectivamente) — sem ambiguidade, não precisa do sufixo
    // `!fkey` usado em employees.
    const { contractId } = req.query as { contractId?: string }
    let query = db.from('jobs')
      .select(`*, employees!jobs_employee_id_fkey(name), machines(name), clients(razao_social), contracts(number, clients(razao_social))`)
    if (contractId) {
      query = (query as any).eq('contract_id', contractId)
    }
    if (req.user.role === 'employee') {
      // Busca employee_id pelo user_id do JWT
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp) return []
      // Vínculo colaborador↔OS agora vem de duas fontes: employee_id legado (fluxo de
      // provisionamento de ferramentas) e job_employees (múltiplos colaboradores,
      // sub-plano 04). Um funcionário vê a união das duas.
      const { data: linked } = await db.from('job_employees').select('job_id').eq('employee_id', emp.id)
      const linkedIds: string[] = (linked ?? []).map((r: any) => r.job_id)
      query = (query as any).or(
        linkedIds.length > 0
          ? `employee_id.eq.${emp.id},id.in.(${linkedIds.join(',')})`
          : `employee_id.eq.${emp.id}`,
      )
    }
    const { data, error } = await (query as any).order('scheduled_date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return (data ?? []).map((j: any) => ({
      ...j,
      employee_name: j.employees?.name,
      machine_name: j.machines?.name,
      client_name: j.clients?.razao_social ?? j.contracts?.clients?.razao_social ?? null,
      employees: undefined,
      machines: undefined,
      clients: undefined,
      contracts: undefined,
    }))
  })

  // GET /jobs/calendar?from=&to= — sub-plano 02, item 3: agenda somente leitura,
  // qualquer role autenticada (sem checagem de ownership — é intencional, o
  // calendário mostra a OS de TODOS os funcionários, pra dar visão de equipe).
  // Só campos mínimos (sem valores/dados de contato do cliente) e exclui OS
  // canceladas. Precisa vir ANTES de `/:id` (mesmo cuidado do padrão já usado
  // em contracts.ts `/expiring`), senão "calendar" seria capturado como :id.
  const calendarQuery = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  const CALENDAR_MAX_RANGE_DAYS = 62

  fastify.get<{ Querystring: { from?: string; to?: string } }>('/calendar', { onRequest: [guard] }, async (req, reply) => {
    const parsed = calendarQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { from, to } = parsed.data

    const fromDate = new Date(from)
    const toDate = new Date(to)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return reply.status(400).send({ error: 'Datas inválidas' })
    }
    if (toDate < fromDate) {
      return reply.status(400).send({ error: '"to" deve ser maior ou igual a "from"' })
    }
    const rangeDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000)
    if (rangeDays > CALENDAR_MAX_RANGE_DAYS) {
      return reply.status(400).send({ error: `Intervalo máximo de ${CALENDAR_MAX_RANGE_DAYS} dias` })
    }

    // employees!jobs_employee_id_fkey: assignee legado. job_employees(employees(...)):
    // múltiplos colaboradores (sub-plano 04). Nenhum campo financeiro/de contato
    // (contract_value, client_contact_name/phone, address) entra no select.
    const { data, error } = await db.from('jobs')
      .select(`id, number, status, job_type, scheduled_date, scheduled_end_date, start_time, end_time, city, state,
        clients(razao_social), contracts(clients(razao_social)),
        employees!jobs_employee_id_fkey(id, name, color, photo_path),
        job_employees(employees(id, name, color, photo_path))`)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .neq('status', 'cancelled')
      .order('scheduled_date')
    if (error) return reply.status(500).send({ error: error.message })

    return Promise.all((data ?? []).map((j: any) => buildCalendarEntry(db, j)))
  })

  // GET /jobs/:id — CRITICAL-07 (IDOR): employee só vê job próprio (employee_id legado
  // OU job_employees); 404 (não 403) para não confirmar a existência do job de outro
  // colaborador.
  //
  // Sub-plano 01: `proposal_id` agora é FK direta em `jobs` (antes era resolvido
  // via query reversa em `proposals.job_id`) — vira embed normal, no mesmo
  // select, junto do cliente (mesma fonte direta + fallback via contrato do
  // GET /jobs acima). `proposals` precisa do hint `!jobs_proposal_id_fkey`
  // porque a migration 030 deixou DUAS FKs possíveis entre jobs e proposals
  // (a nova `jobs.proposal_id` e a legada `proposals.job_id`) — sem o hint, o
  // PostgREST não desambigua e a rota inteira cai com 500 (achado ao validar
  // contra Postgres real; os testes Jest usam mock e não pegam isso).
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req: any, reply) => {
    const { data, error } = await db.from('jobs')
      .select(
        `*, employees!jobs_employee_id_fkey(name), machines(name, manual_url), job_employees(employee_id), clients(razao_social), contracts(clients(razao_social)), proposals!jobs_proposal_id_fkey(id, number, status)`,
      )
      .eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    if (req.user.role === 'employee') {
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp) return reply.status(404).send({ error: 'Not found' })
      const owned = await isJobAssignedToEmployee(db, data.id, emp.id, data.employee_id)
      if (!owned) return reply.status(404).send({ error: 'Not found' })
    }
    const employeeIds = ((data as any).job_employees ?? []).map((r: any) => r.employee_id)
    const clientName = (data as any).clients?.razao_social ?? (data as any).contracts?.clients?.razao_social ?? null

    return {
      ...data,
      employee_name: data.employees?.name,
      machine: data.machines,
      employee_ids: employeeIds,
      client_name: clientName,
      proposal: (data as any).proposals ?? null,
      job_employees: undefined,
      clients: undefined,
      contracts: undefined,
      proposals: undefined,
    }
  })

  // POST /jobs
  // CRITICAL-02: insert do job, ajuste de estoque das ferramentas da máquina e
  // criação do checklist pre_work rodam dentro da RPC `create_job_with_provisioning`
  // (transação Postgres única). Se qualquer etapa falhar (ex.: checklist com FK
  // inválida), o Postgres desfaz tudo — nunca fica job sem checklist, ou estoque
  // debitado sem job. Ver supabase/migrations/015_atomic_operations.sql.
  fastify.post('/', { onRequest: [guard, requireRoles('manager', 'admin')] }, async (req, reply) => {
    const parsed = jobCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { data: result, error } = await db.rpc('create_job_with_provisioning', { p_job: parsed.data })
    if (error) return reply.status(500).send({ error: error.message })

    const job = (result as any).job
    const insufficientTools: string[] = (result as any).insufficient_tools ?? []

    // Notificar funcionário — best-effort, não deve derrubar a resposta 201 nem
    // desfazer a criação do job caso a notificação falhe (já é logado dentro de
    // insertNotification).
    const { data: emp } = await db.from('employees').select('user_id').eq('id', parsed.data.employee_id).single()
    if (emp?.user_id) {
      await insertNotification(db, emp.user_id,
        'Novo trabalho agendado',
        `Você tem um trabalho agendado para ${parsed.data.scheduled_date} em ${parsed.data.city}/${parsed.data.state}.`)
    }

    return reply.status(201).send({ ...job, insufficient_tools: insufficientTools })
  })

  // PUT /jobs/:id — CRITICAL-01 (IDOR): employee só edita job próprio, e só campos não
  // administrativos (employee_id, machine_id, scheduled_date ficam restritos a admin/manager).
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req: any, reply) => {
    const isAdminOrManager = ['admin', 'manager'].includes(req.user.role)
    const schema = isAdminOrManager ? jobUpdateBody : employeeJobUpdateBody
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const owned = await loadOwnedJob(db, req, reply)
    if (!owned) return

    const { employee_ids, ...jobFields } = parsed.data as typeof parsed.data & { employee_ids?: string[] }
    // Campos opcionais tipados (uuid/date) chegam como '' do frontend quando
    // vazios — o Postgres rejeita '' pra esses tipos (22P02/22007: invalid
    // input syntax). '' significa "sem valor", equivalente a null.
    for (const field of ['bag_id', 'scheduled_end_date', 'proposal_id', 'client_id', 'contract_id'] as const) {
      if ((jobFields as any)[field] === '') (jobFields as any)[field] = null
    }

    const { data, error } = await db.from('jobs').update({ ...jobFields, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })

    // Sub-plano 04, item 4/12: substitui os colaboradores atribuídos à OS
    // quando o gestor envia employee_ids. Só é enviado por admin/manager
    // (employeeJobUpdateBody, usado pelo employee, omite o campo inteiro).
    if (employee_ids) {
      await db.from('job_employees').delete().eq('job_id', req.params.id)
      if (employee_ids.length > 0) {
        const { error: linkError } = await db.from('job_employees')
          .insert(employee_ids.map((employeeId) => ({ job_id: req.params.id, employee_id: employeeId })))
        if (linkError) return reply.status(500).send({ error: linkError.message })
      }
    }

    return data
  })

  // PATCH /jobs/:id/start — sub-plano 02, item 4: transição scheduled|pending
  // -> in_progress. Permitido a admin/manager e a qualquer colaborador
  // vinculado à OS (employee_id legado OU job_employees — já temos
  // `job.employee_id` deste select, então chama `isJobAssignedToEmployee`
  // direto, mesmo padrão de `loadOwnedJob` acima; `isJobMember` — que faz
  // essa mesma checagem sem exigir o employee_id em mãos — existe pra quem
  // não tem o job pré-carregado, ex. reports.ts). 404 (não 403) pro employee
  // sem vínculo, mesmo padrão IDOR do resto do arquivo. 409 fora de
  // scheduled/pending.
  fastify.patch<{ Params: { id: string } }>('/:id/start', { onRequest: [guard] }, async (req: any, reply) => {
    const { data: job, error } = await db.from('jobs').select('id, status, employee_id').eq('id', req.params.id).single()
    if (error || !job) return reply.status(404).send({ error: 'Not found' })

    if (req.user.role === 'employee') {
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp) return reply.status(404).send({ error: 'Not found' })
      const member = await isJobAssignedToEmployee(db, job.id, emp.id, job.employee_id)
      if (!member) return reply.status(404).send({ error: 'Not found' })
    } else if (!['admin', 'manager'].includes(req.user.role)) {
      return reply.status(403).send({ error: 'Acesso negado' })
    }

    if (!['scheduled', 'pending'].includes(job.status)) {
      return reply.status(409).send({ error: `OS não pode ser iniciada no status atual (${job.status})` })
    }

    const { data: updated, error: updateError } = await db.from('jobs')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (updateError || !updated) return reply.status(500).send({ error: updateError?.message ?? 'Falha ao iniciar OS' })

    await recordAuditEvent(db, {
      entityType: 'job', entityId: req.params.id, actorId: req.user.id,
      action: 'job.started', metadata: { from: job.status, to: 'in_progress' },
    })
    return updated
  })

  // PATCH /jobs/:id/cancel — CRITICAL-01 (IDOR): employee só cancela job próprio.
  fastify.patch<{ Params: { id: string } }>('/:id/cancel', { onRequest: [guard] }, async (req: any, reply) => {
    const owned = await loadOwnedJob(db, req, reply)
    if (!owned) return

    const { data, error } = await db.from('jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    await restoreToolStock(db, req.params.id)
    return data
  })

  // GET /jobs/:id/checklist — CRITICAL-07 (IDOR): mesma checagem de loadOwnedJob usada
  // em GET/PUT/:id, faltava aqui (achado da auditoria 2026-09-15).
  fastify.get<{ Params: { id: string }; Querystring: { phase?: string } }>('/:id/checklist', { onRequest: [guard] }, async (req: any, reply) => {
    if (!(await loadOwnedJob(db, req, reply))) return
    let query = db
      .from('job_checklists')
      .select('*, tools(id, name, description)')
      .eq('job_id', req.params.id)
    if (req.query.phase) query = (query as any).eq('phase', req.query.phase)
    const { data, error } = await (query as any).order('created_at')
    if (error) return reply.status(500).send({ error: error.message })
    return data ?? []
  })

  // PATCH /jobs/:id/checklist/:itemId — CRITICAL-07 (IDOR)
  fastify.patch<{ Params: { id: string; itemId: string } }>('/:id/checklist/:itemId', { onRequest: [guard] }, async (req: any, reply) => {
    if (!(await loadOwnedJob(db, req, reply))) return
    const parsed = z.object({ checked: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const update: any = {
      checked: parsed.data.checked,
      checked_at: parsed.data.checked ? new Date().toISOString() : null,
    }
    const { data, error } = await db
      .from('job_checklists')
      .update(update)
      .eq('id', req.params.itemId)
      .eq('job_id', req.params.id)
      .select()
      .single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // POST /jobs/:id/checklist/duplicate — duplica pre_work para pre_report. CRITICAL-07 (IDOR)
  fastify.post<{ Params: { id: string } }>('/:id/checklist/duplicate', { onRequest: [guard] }, async (req: any, reply) => {
    if (!(await loadOwnedJob(db, req, reply))) return
    // Verifica se já existe pre_report
    const { data: existing } = await db
      .from('job_checklists')
      .select('id')
      .eq('job_id', req.params.id)
      .eq('phase', 'pre_report')
      .limit(1)
    if (existing && existing.length > 0) {
      const { data } = await db
        .from('job_checklists')
        .select('*, tools(id, name, description)')
        .eq('job_id', req.params.id)
        .eq('phase', 'pre_report')
        .order('created_at' as any)
      return data ?? []
    }

    const { data: preWork } = await db
      .from('job_checklists')
      .select('*')
      .eq('job_id', req.params.id)
      .eq('phase', 'pre_work')

    if (!preWork || preWork.length === 0)
      return reply.status(404).send({ error: 'No pre_work checklist found' })

    const newItems = preWork.map((item: any) => ({
      job_id: item.job_id,
      employee_id: item.employee_id,
      tool_id: item.tool_id,
      phase: 'pre_report',
      checked: false,
    }))

    const { data, error } = await db
      .from('job_checklists')
      .insert(newItems)
      .select('*, tools(id, name, description)')
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })
}

// Sub-plano 02, item 3: monta uma entrada do calendário a partir da linha crua
// do select de GET /jobs/calendar — junta o assignee legado (employees!fkey)
// com os colaboradores de job_employees (deduplicados por id, um funcionário
// pode em teoria aparecer nas duas fontes) e resolve `photo_url` assinada
// (TTL curto) pra cada um. Falha ao assinar a foto de um funcionário não
// derruba a linha inteira — cai pra null.
async function buildCalendarEntry(db: any, j: any) {
  const clientName = j.clients?.razao_social ?? j.contracts?.clients?.razao_social ?? null

  const byId = new Map<string, any>()
  if (j.employees) byId.set(j.employees.id, j.employees)
  for (const link of j.job_employees ?? []) {
    if (link.employees) byId.set(link.employees.id, link.employees)
  }

  const employees = await Promise.all(
    Array.from(byId.values()).map(async (e: any) => ({
      id: e.id,
      name: e.name,
      color: e.color ?? null,
      photo_url: e.photo_path
        ? await getSignedUrl(db, 'employee-photos', e.photo_path).catch(() => null)
        : null,
    })),
  )

  return {
    id: j.id,
    number: j.number ?? null,
    status: j.status,
    job_type: j.job_type,
    scheduled_date: j.scheduled_date,
    scheduled_end_date: j.scheduled_end_date ?? null,
    start_time: j.start_time,
    end_time: j.end_time,
    city: j.city,
    state: j.state,
    client_name: clientName,
    employees,
  }
}

// CRITICAL-01/9: ajuste atômico de estoque via RPC `adjust_tool_stock` — um único
// UPDATE (row-level lock do Postgres) em vez de ler quantity, calcular em memória e
// escrever de volta. Elimina a corrupção de estoque sob concorrência (duas criações/
// cancelamentos de job para a mesma ferramenta ao mesmo tempo). Usado tanto para
// consumir estoque (delta negativo) quanto para restaurar (delta positivo).
async function adjustToolStock(db: any, toolId: string, delta: number): Promise<void> {
  const { error } = await db.rpc('adjust_tool_stock', { p_tool_id: toolId, p_delta: delta })
  if (error) throw new Error(`Falha ao ajustar estoque da ferramenta ${toolId}: ${error.message}`)
}

async function restoreToolStock(db: any, jobId: string) {
  const { data: items } = await db
    .from('job_checklists')
    .select('tool_id, jobs!inner(machine_id)')
    .eq('job_id', jobId)
    .eq('phase', 'pre_work')

  if (!items || items.length === 0) return

  const machineId = (items[0] as any).jobs?.machine_id
  if (!machineId) return

  const { data: machineTools } = await db
    .from('machine_tools')
    .select('tool_id, quantity_required, tools(id)')
    .eq('machine_id', machineId)

  if (!machineTools) return

  for (const mt of machineTools) {
    const tool = (mt as any).tools
    if (tool) {
      await adjustToolStock(db, tool.id, mt.quantity_required)
    }
  }
}

export default jobs
