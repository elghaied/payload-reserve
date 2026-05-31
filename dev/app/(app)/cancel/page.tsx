'use client'

import React, { useEffect, useState } from 'react'

const card: React.CSSProperties = {
  background: '#fff',
  borderColor: '#e3e6ea',
  borderRadius: 10,
  borderStyle: 'solid',
  borderWidth: 1,
  padding: 24,
}
const button: React.CSSProperties = {
  background: '#dc2626',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 600,
  padding: '10px 16px',
}

type Phase = 'cancelling' | 'done' | 'error' | 'idle'

export default function CancelPage() {
  const [reservationId, setReservationId] = useState('')
  const [token, setToken] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    setReservationId(sp.get('reservationId') ?? '')
    setToken(sp.get('token') ?? '')
  }, [])

  const cancel = async () => {
    setPhase('cancelling')
    setMessage('')
    try {
      const resp = await fetch('/api/reserve/cancel', {
        body: JSON.stringify({ reservationId, token }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const json = await resp.json()
      if (resp.ok) {
        setPhase('done')
        setMessage(`Booking ${json.id ?? reservationId} is now "${json.status ?? 'cancelled'}".`)
      } else {
        setPhase('error')
        setMessage(json?.errors?.[0]?.message ?? json?.message ?? 'Cancellation failed.')
      }
    } catch {
      setPhase('error')
      setMessage('Network error cancelling the booking.')
    }
  }

  return (
    <main style={{ margin: '0 auto', maxWidth: 480, padding: '40px 20px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Cancel booking</h1>

      {!reservationId || !token ? (
        <div style={{ ...card, borderColor: '#f0b4b4', color: '#a61b1b' }}>
          This link is missing its reservation id or token.
        </div>
      ) : phase === 'done' ? (
        <div style={{ ...card, borderColor: '#a7d8b0' }}>{message}</div>
      ) : (
        <div style={card}>
          <p style={{ marginTop: 0 }}>
            Cancel reservation <code>{reservationId}</code>?
          </p>
          <button
            disabled={phase === 'cancelling'}
            onClick={cancel}
            style={{ ...button, opacity: phase === 'cancelling' ? 0.6 : 1 }}
            type="button"
          >
            {phase === 'cancelling' ? 'Cancelling…' : 'Cancel my booking'}
          </button>
          {phase === 'error' ? (
            <p style={{ color: '#a61b1b', marginBottom: 0 }}>{message}</p>
          ) : null}
        </div>
      )}
    </main>
  )
}
