import { google } from 'googleapis'
import { decrypt } from '@/utils/encrypt'

const TYPE_LABELS: Record<string, string> = {
  day_off: 'Day Off',
  vacation: 'Férias',
  training: 'Treinamento',
  medical_leave: 'Licença Médica',
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  )
}

export function getAuthUrl(state: string) {
  const client = getOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
  })
}

export async function exchangeCode(code: string) {
  const client = getOAuthClient()
  const { tokens } = await client.getToken(code)
  return tokens
}

function getCalendarClient(encryptedRefreshToken: string) {
  const client = getOAuthClient()
  // HIGH-02: descriptografar token antes de usar
  const refreshToken = decrypt(encryptedRefreshToken)
  client.setCredentials({ refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth: client })
}

// Google all-day events use exclusive end date (day after last day)
function exclusiveEndDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export interface CalendarEventInput {
  type: string
  start_date: string
  end_date: string
  notes?: string
  employeeNames: string[]
  attendeeEmails?: string[]
}

// MED-05: timeout para chamadas externas ao Google Calendar
function withTimeout<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Google Calendar timeout após ${ms}ms`)), ms),
    ),
  ])
}

export async function createCalendarEvent(
  refreshToken: string,
  calendarId: string,
  event: CalendarEventInput,
): Promise<string | null> {
  try {
    const calendar = getCalendarClient(refreshToken)
    const summary = `${TYPE_LABELS[event.type] ?? event.type} — ${event.employeeNames.join(', ')}`
    const attendees = (event.attendeeEmails ?? []).map((email) => ({ email }))

    const res = await withTimeout(calendar.events.insert({
      calendarId,
      sendUpdates: attendees.length > 0 ? 'all' : 'none',
      requestBody: {
        summary,
        description: event.notes,
        start: { date: event.start_date },
        end: { date: exclusiveEndDate(event.end_date) },
        attendees,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'email', minutes: 1440 },
          ],
        },
      },
    }))
    return res.data.id ?? null
  } catch (err) {
    console.error('[google-calendar] createCalendarEvent error:', err)
    return null
  }
}

export async function deleteCalendarEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    const calendar = getCalendarClient(refreshToken)
    await withTimeout(calendar.events.delete({ calendarId, eventId }))
  } catch (err) {
    console.error('[google-calendar] deleteCalendarEvent error:', err)
  }
}

export async function cancelCalendarEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    const calendar = getCalendarClient(refreshToken)
    await withTimeout(calendar.events.patch({
      calendarId,
      eventId,
      requestBody: { summary: `[CANCELADO] ` },
    }))
    await withTimeout(calendar.events.patch({
      calendarId,
      eventId,
      requestBody: { colorId: '11' },
    }))
  } catch (err) {
    console.error('[google-calendar] cancelCalendarEvent error:', err)
  }
}
