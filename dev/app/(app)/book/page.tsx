'use client'

import React, { useEffect, useMemo, useState } from 'react'

type Service = { allowGuestBooking?: string; duration?: number; id: string; name: string }
type Resource = { id: string; name: string; services?: ({ id: string } | string)[] }

const card: React.CSSProperties = {
  background: '#fff',
  borderColor: '#e3e6ea',
  borderRadius: 10,
  borderStyle: 'solid',
  borderWidth: 1,
  marginBottom: 20,
  padding: 24,
}
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }
const input: React.CSSProperties = {
  border: '1px solid #cbd2d9',
  borderRadius: 6,
  boxSizing: 'border-box',
  fontSize: 14,
  marginBottom: 14,
  padding: '8px 10px',
  width: '100%',
}
const button: React.CSSProperties = {
  background: '#2563eb',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 600,
  padding: '10px 16px',
}

function defaultStart(): string {
  // two days out at 10:00 (clears the 24h cancellation-notice window),
  // formatted for <input type="datetime-local">
  const d = new Date(Date.now() + 48 * 3600_000)
  d.setHours(10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const resourceServiceIds = (r: Resource): string[] =>
  (r.services ?? []).map((s) => (typeof s === 'object' ? s.id : s))

export default function BookPage() {
  const [services, setServices] = useState<Service[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [serviceId, setServiceId] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [startTime, setStartTime] = useState(() => defaultStart())
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<null | string>(null)
  // OTP cancellation (shown after booking with a phone)
  const [otpPhase, setOtpPhase] = useState<
    'cancelled' | 'confirming' | 'error' | 'idle' | 'requesting' | 'sent'
  >('idle')
  const [otpCode, setOtpCode] = useState('')
  const [otpMsg, setOtpMsg] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [svcRes, resRes] = await Promise.all([
          fetch('/api/services?limit=100&depth=0&where[active][equals]=true'),
          fetch('/api/resources?limit=100&depth=0'),
        ])
        const svc = await svcRes.json()
        const res = await resRes.json()
        setServices(svc.docs ?? [])
        setResources(res.docs ?? [])
      } catch {
        setError('Failed to load services/resources. Is the dev server running?')
      }
    })()
  }, [])

  // Resources that can perform the selected service.
  const eligibleResources = useMemo(
    () => (serviceId ? resources.filter((r) => resourceServiceIds(r).includes(serviceId)) : resources),
    [resources, serviceId],
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!serviceId || !resourceId || !startTime || !name || (!email && !phone)) {
      setError('Pick a service + resource + time, and enter a name and an email or phone.')
      return
    }
    setSubmitting(true)
    try {
      const guest: Record<string, string> = { name }
      if (email) {
        guest.email = email
      }
      if (phone) {
        guest.phone = phone
      }
      const resp = await fetch('/api/reserve/book', {
        body: JSON.stringify({
          guest,
          resource: resourceId,
          service: serviceId,
          startTime: new Date(startTime).toISOString(),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.errors?.[0]?.message ?? json?.message ?? 'Booking failed')
      } else {
        setResult(json)
        setOtpPhase('idle')
        setOtpCode('')
        setOtpMsg('')
      }
    } catch {
      setError('Network error submitting the booking.')
    } finally {
      setSubmitting(false)
    }
  }

  const requestOtp = async () => {
    setOtpPhase('requesting')
    setOtpMsg('')
    try {
      const resp = await fetch('/api/dev/request-cancel-otp', {
        body: JSON.stringify({ reservationId: result.id }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const json = await resp.json()
      if (resp.ok) {
        setOtpPhase('sent')
        setOtpMsg('Code sent — check the dev console for the "[sms-mock]" line.')
      } else {
        setOtpPhase('error')
        setOtpMsg(json?.message ?? 'Failed to send code')
      }
    } catch {
      setOtpPhase('error')
      setOtpMsg('Network error requesting the code.')
    }
  }

  const confirmOtp = async () => {
    setOtpPhase('confirming')
    try {
      const resp = await fetch('/api/dev/confirm-cancel-otp', {
        body: JSON.stringify({ code: otpCode, reservationId: result.id }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const json = await resp.json()
      if (resp.ok) {
        setOtpPhase('cancelled')
        setOtpMsg(`Booking is now "${json.status ?? 'cancelled'}".`)
      } else {
        setOtpPhase('sent')
        setOtpMsg(json?.message ?? 'Invalid or expired code — try again.')
      }
    } catch {
      setOtpPhase('sent')
      setOtpMsg('Network error confirming the code.')
    }
  }

  return (
    <main style={{ margin: '0 auto', maxWidth: 560, padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Book a reservation</h1>
      <p style={{ color: '#52606d', marginTop: 0 }}>
        Guest booking — no account required.
      </p>

      <form onSubmit={submit} style={card}>
        <label htmlFor="service" style={label}>Service</label>
        <select
          id="service"
          onChange={(e) => {
            setServiceId(e.target.value)
            setResourceId('')
          }}
          style={input}
          value={serviceId}
        >
          <option value="">Select a service…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.duration ? ` (${s.duration} min)` : ''}
            </option>
          ))}
        </select>

        <label htmlFor="resource" style={label}>Resource</label>
        <select
          id="resource"
          onChange={(e) => setResourceId(e.target.value)}
          style={input}
          value={resourceId}
        >
          <option value="">Select a resource…</option>
          {eligibleResources.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <label htmlFor="start" style={label}>Date &amp; time</label>
        <input
          aria-label="Date and time"
          id="start"
          onChange={(e) => setStartTime(e.target.value)}
          style={input}
          type="datetime-local"
          value={startTime}
        />

        <label htmlFor="name" style={label}>Your name</label>
        <input
          aria-label="Your name"
          id="name"
          onChange={(e) => setName(e.target.value)}
          style={input}
          value={name}
        />

        <label htmlFor="email" style={label}>Email (for a cancel link)</label>
        <input
          aria-label="Email"
          id="email"
          onChange={(e) => setEmail(e.target.value)}
          style={input}
          type="email"
          value={email}
        />

        <label htmlFor="phone" style={label}>Phone (for SMS/OTP cancel)</label>
        <input
          aria-label="Phone"
          id="phone"
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+15551230000"
          style={input}
          value={phone}
        />

        <button disabled={submitting} style={{ ...button, opacity: submitting ? 0.6 : 1 }} type="submit">
          {submitting ? 'Booking…' : 'Book now'}
        </button>
      </form>

      {error ? (
        <div style={{ ...card, borderColor: '#f0b4b4', color: '#a61b1b' }}>{error}</div>
      ) : null}

      {result ? (
        <div style={{ ...card, borderColor: '#a7d8b0' }}>
          <strong>Booked!</strong> Reservation <code>{result.id}</code> — status{' '}
          <code>{result.status}</code>.

          {email ? (
            <p style={{ color: '#52606d', fontSize: 13, marginBottom: 0 }}>
              A cancel link was logged to the dev console (and the email).
            </p>
          ) : null}

          {phone ? (
            <div style={{ borderTop: '1px solid #e3e6ea', marginTop: 14, paddingTop: 14 }}>
              <strong style={{ fontSize: 14 }}>Cancel via SMS code</strong>
              {otpPhase === 'cancelled' ? (
                <p style={{ color: '#117a37', marginBottom: 0 }}>{otpMsg}</p>
              ) : otpPhase === 'idle' ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={requestOtp}
                    style={{ ...button, background: '#0f766e' }}
                    type="button"
                  >
                    Send SMS code
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <input
                    aria-label="SMS code"
                    inputMode="numeric"
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit code from the console"
                    style={input}
                    value={otpCode}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      disabled={otpCode.length < 6 || otpPhase === 'confirming'}
                      onClick={confirmOtp}
                      style={{ ...button, background: '#dc2626', opacity: otpPhase === 'confirming' ? 0.6 : 1 }}
                      type="button"
                    >
                      {otpPhase === 'confirming' ? 'Cancelling…' : 'Confirm cancellation'}
                    </button>
                    <button
                      disabled={otpPhase === 'requesting'}
                      onClick={requestOtp}
                      style={{ ...button, background: '#e5e7eb', color: '#111', opacity: otpPhase === 'requesting' ? 0.6 : 1 }}
                      type="button"
                    >
                      {otpPhase === 'requesting' ? 'Sending…' : 'Resend code'}
                    </button>
                  </div>
                  {otpMsg ? (
                    <p style={{ color: '#52606d', fontSize: 13, marginBottom: 0 }}>{otpMsg}</p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
