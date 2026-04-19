import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  cancelCalendarEvent,
} from "@/services/google-calendar.service";

const scheduleEventBody = z
  .object({
    type: z.enum(["day_off", "vacation", "training", "medical_leave"]),
    employee_ids: z
      .array(z.string())
      .min(1, "Selecione ao menos um funcionário"),
    start_date: z.string().min(1, "Data de início é obrigatória"),
    end_date: z.string().min(1, "Data de término é obrigatória"),
    notes: z.string().optional(),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: "Data de término deve ser igual ou posterior à data de início",
    path: ["end_date"],
  });

async function buildEventResponse(db: any, event: any) {
  const { data: links } = await db
    .from("schedule_event_employees")
    .select("employee_id, employees(name)")
    .eq("schedule_event_id", event.id);

  const employee_ids: string[] = [];
  const employee_names: string[] = [];
  for (const link of links ?? []) {
    employee_ids.push(link.employee_id);
    employee_names.push(link.employees?.name ?? "");
  }

  return { ...event, employee_ids, employee_names };
}

const scheduleEventsRoute: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase;
  const guard = (fastify as any).authenticate;

  // GET /schedule-events?month=YYYY-MM&employeeId=uuid
  fastify.get<{ Querystring: { month?: string; employeeId?: string } }>(
    "/",
    { onRequest: [guard] },
    async (req, reply) => {
      const { month, employeeId } = req.query;

      let query = db.from("schedule_events").select("*");

      // Filtra eventos que se sobrepõem ao mês informado
      if (month) {
        const [year, mon] = month.split("-").map(Number);
        const firstDay = `${month}-01`;
        const lastDay = new Date(year, mon, 0).toISOString().slice(0, 10);
        query = query.lte("start_date", lastDay).gte("end_date", firstDay);
      }

      // Filtra por funcionário via junction table
      if (employeeId) {
        const { data: links, error: linkErr } = await db
          .from("schedule_event_employees")
          .select("schedule_event_id")
          .eq("employee_id", employeeId);
        if (linkErr) return reply.status(500).send({ error: linkErr.message });
        const ids = (links ?? []).map((l: any) => l.schedule_event_id);
        if (ids.length === 0) return [];
        query = query.in("id", ids);
      }

      const { data, error } = await query.order("start_date", {
        ascending: true,
      });
      if (error) return reply.status(500).send({ error: error.message });

      const results = await Promise.all(
        (data ?? []).map((e: any) => buildEventResponse(db, e)),
      );
      return results;
    },
  );

  // GET /schedule-events/:id
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { onRequest: [guard] },
    async (req, reply) => {
      const { data, error } = await db
        .from("schedule_events")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (error || !data) return reply.status(404).send({ error: "Not found" });
      return buildEventResponse(db, data);
    },
  );

  // POST /schedule-events (admin/manager only)
  fastify.post("/", { onRequest: [guard] }, async (req: any, reply) => {
    if (!["manager", "admin"].includes(req.user.role))
      return reply.status(403).send({ error: "Forbidden" });

    const parsed = scheduleEventBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: parsed.error.flatten() });

    const { employee_ids, ...eventFields } = parsed.data;

    const { data: event, error: insertError } = await db
      .from("schedule_events")
      .insert(eventFields)
      .select()
      .single();

    if (insertError)
      return reply.status(500).send({ error: insertError.message });

    const links = employee_ids.map((employee_id) => ({
      schedule_event_id: event.id,
      employee_id,
    }));

    const { error: linkError } = await db
      .from("schedule_event_employees")
      .insert(links);
    if (linkError) return reply.status(500).send({ error: linkError.message });

    const response = await buildEventResponse(db, event);

    // Sincroniza com Google Calendar (fire-and-forget, não falha a requisição)
    syncCreateToGoogleCalendar(db, event, response.employee_names, response.employee_ids).catch(
      (err) => fastify.log.error(err, "google-calendar sync error"),
    );

    return reply.status(201).send(response);
  });

  // PATCH /schedule-events/:id/cancel (admin/manager only)
  fastify.patch<{ Params: { id: string } }>(
    '/:id/cancel',
    { onRequest: [guard] },
    async (req: any, reply) => {
      if (!['manager', 'admin'].includes(req.user.role))
        return reply.status(403).send({ error: 'Forbidden' })

      const { data, error } = await db
        .from('schedule_events')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single()

      if (error || !data) return reply.status(404).send({ error: 'Not found' })

      syncCancelToGoogleCalendar(db, data).catch(
        (err) => fastify.log.error(err, 'google-calendar cancel sync error'),
      )

      return buildEventResponse(db, data)
    },
  )

  // DELETE /schedule-events/:id (admin/manager only)
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { onRequest: [guard] },
    async (req: any, reply) => {
      if (!["manager", "admin"].includes(req.user.role))
        return reply.status(403).send({ error: "Forbidden" });

      // Busca event_ids antes de deletar
      const { data: eventData } = await db
        .from("schedule_events")
        .select("google_event_id")
        .eq("id", req.params.id)
        .single();

      const { data: empLinks } = await db
        .from("schedule_event_employees")
        .select("employee_id, google_event_id")
        .eq("schedule_event_id", req.params.id);

      const { error } = await db
        .from("schedule_events")
        .delete()
        .eq("id", req.params.id);

      if (error) return reply.status(500).send({ error: error.message });

      syncDeleteToGoogleCalendar(db, eventData, empLinks ?? []).catch(
        (err) => fastify.log.error(err, "google-calendar delete sync error"),
      );

      return reply.status(204).send();
    },
  );
};

// ── Google Calendar sync helpers ────────────────────────────────────────────

async function syncCreateToGoogleCalendar(
  db: any,
  event: any,
  employeeNames: string[],
  employeeIds: string[],
) {
  const adminToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
  const adminCalendarId = process.env.GOOGLE_ADMIN_CALENDAR_ID ?? "primary";

  // Busca e-mails de todos os funcionários para enviar convites
  const { data: allEmployees } = await db
    .from("employees")
    .select("id, email, google_refresh_token")
    .in("id", employeeIds);

  const attendeeEmails = (allEmployees ?? []).map((e: any) => e.email);

  const calendarInput = {
    type: event.type,
    start_date: event.start_date,
    end_date: event.end_date,
    notes: event.notes,
    employeeNames,
    attendeeEmails,
  };

  // 1. Calendário central (admin)
  if (adminToken) {
    const googleEventId = await createCalendarEvent(adminToken, adminCalendarId, calendarInput);
    if (googleEventId) {
      await db
        .from("schedule_events")
        .update({ google_event_id: googleEventId })
        .eq("id", event.id);
    }
  }

  // 2. Calendário de cada funcionário (se conectado)
  for (const emp of allEmployees ?? []) {
    if (!emp.google_refresh_token) continue;
    const empInput = { ...calendarInput, employeeNames: [employeeNames[employeeIds.indexOf(emp.id)]] };
    const empEventId = await createCalendarEvent(emp.google_refresh_token, "primary", empInput);
    if (empEventId) {
      await db
        .from("schedule_event_employees")
        .update({ google_event_id: empEventId })
        .eq("schedule_event_id", event.id)
        .eq("employee_id", emp.id);
    }
  }
}

async function syncCancelToGoogleCalendar(db: any, event: any) {
  const adminToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
  const adminCalendarId = process.env.GOOGLE_ADMIN_CALENDAR_ID ?? "primary";

  if (adminToken && event.google_event_id) {
    await cancelCalendarEvent(adminToken, adminCalendarId, event.google_event_id);
  }

  const { data: links } = await db
    .from("schedule_event_employees")
    .select("employee_id, google_event_id, employees(google_refresh_token)")
    .eq("schedule_event_id", event.id)
    .not("google_event_id", "is", null);

  for (const link of links ?? []) {
    const token = link.employees?.google_refresh_token;
    if (token && link.google_event_id) {
      await cancelCalendarEvent(token, "primary", link.google_event_id);
    }
  }
}

async function syncDeleteToGoogleCalendar(db: any, eventData: any, empLinks: any[]) {
  const adminToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
  const adminCalendarId = process.env.GOOGLE_ADMIN_CALENDAR_ID ?? "primary";

  if (adminToken && eventData?.google_event_id) {
    await deleteCalendarEvent(adminToken, adminCalendarId, eventData.google_event_id);
  }

  for (const link of empLinks) {
    if (!link.google_event_id) continue;
    const { data: emp } = await db
      .from("employees")
      .select("google_refresh_token")
      .eq("id", link.employee_id)
      .single();
    if (emp?.google_refresh_token) {
      await deleteCalendarEvent(emp.google_refresh_token, "primary", link.google_event_id);
    }
  }
}

export default scheduleEventsRoute;
