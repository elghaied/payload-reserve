import type { Endpoint } from 'payload'

/**
 * Dev-only demonstration of SMS/OTP guest cancellation.
 *
 * The reservation plugin generates a `cancellationToken` for guest bookings and
 * exposes it server-side (never over HTTP). Here the dev app keeps that token
 * server-side, hands the guest a short OTP over SMS (via the SMS plugin's mock
 * adapter), and only after the OTP is verified does it redeem the real token
 * against the plugin's public `/api/reserve/cancel` endpoint.
 *
 * Two endpoints:
 *   POST /api/dev/request-cancel-otp  { reservationId }          → sends a code
 *   POST /api/dev/confirm-cancel-otp  { reservationId, code }    → cancels
 */

const OTP_TTL_MS = 10 * 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readBody(req: any): Promise<Record<string, unknown>> {
  const body = await req.json?.()
  return (body ?? {}) as Record<string, unknown>
}

const requestCancelOtp: Endpoint = {
  handler: async (req) => {
    const { reservationId } = await readBody(req)
    if (!reservationId) {
      return Response.json({ message: 'reservationId is required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reservation = await (req.payload.findByID as any)({
      id: reservationId,
      collection: 'reservations',
      depth: 0,
      overrideAccess: true,
      req,
    })

    const phone = (reservation?.guest as { phone?: string } | undefined)?.phone
    if (!phone) {
      return Response.json(
        { message: 'This reservation has no guest phone number' },
        { status: 400 },
      )
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (req.payload.find as any)({
      collection: 'cancel-otps',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { reservation: { equals: reservationId } },
    })

    if (existing.docs?.[0]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (req.payload.update as any)({
        id: existing.docs[0].id,
        collection: 'cancel-otps',
        data: { code, expiresAt },
        overrideAccess: true,
        req,
      })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (req.payload.create as any)({
        collection: 'cancel-otps',
        data: { code, expiresAt, reservation: reservationId as string },
        overrideAccess: true,
        req,
      })
    }

    // Deliver via the SMS plugin. In dev this is the mock adapter, which the
    // plugin's onSend logs to the console — copy the code from there.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (req.payload as any).sendSMS({
      body: `Your cancellation code is ${code}. It expires in 10 minutes.`,
      to: phone,
    })

    return Response.json({ message: 'OTP sent — check the dev console for the code' })
  },
  method: 'post',
  path: '/dev/request-cancel-otp',
}

const confirmCancelOtp: Endpoint = {
  handler: async (req) => {
    const { code, reservationId } = await readBody(req)
    if (!reservationId || !code) {
      return Response.json({ message: 'reservationId and code are required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = await (req.payload.find as any)({
      collection: 'cancel-otps',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { reservation: { equals: reservationId } },
    })
    const record = found.docs?.[0]

    if (!record || record.code !== code || new Date(record.expiresAt as string) < new Date()) {
      return Response.json({ message: 'Invalid or expired code' }, { status: 400 })
    }

    // OTP verified → the server has authenticated the guest, so cancel directly.
    // (The email cancel-link flow instead redeems the cancellationToken against
    // the public POST /api/reserve/cancel endpoint, since there the unauthenticated
    // browser holds the token. Either path runs the cancellation-notice hook.)
    let result: Record<string, unknown>
    let status = 200
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cancelled = await (req.payload.update as any)({
        id: reservationId,
        collection: 'reservations',
        data: { cancellationReason: 'Cancelled by guest via SMS OTP', status: 'cancelled' },
        overrideAccess: true,
        req,
      })
      result = { id: cancelled.id, message: 'Cancelled', status: cancelled.status }
    } catch (err) {
      status = 400
      result = { message: err instanceof Error ? err.message : 'Cancellation failed' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (req.payload.delete as any)({
      id: record.id,
      collection: 'cancel-otps',
      overrideAccess: true,
      req,
    }).catch(() => undefined)

    return Response.json(result, { status })
  },
  method: 'post',
  path: '/dev/confirm-cancel-otp',
}

export const guestCancelOtpEndpoints: Endpoint[] = [requestCancelOtp, confirmCancelOtp]
