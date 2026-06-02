'use client'
import type { DateFieldClientComponent } from 'payload'

import { FieldLabel, useConfig, useField, useFormFields, useTranslation } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import type { PluginT } from '../../translations/index.js'

import styles from './AvailabilityTimeField.module.css'

type Slot = { end: string; start: string }

const extractId = (v: unknown): string =>
  typeof v === 'object' && v !== null ? String((v as { id?: unknown }).id ?? '') : String(v ?? '')

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  })

const pad = (n: number) => String(n).padStart(2, '0')
/** Local YYYY-MM-DD for the date picker (not UTC). */
const toLocalDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Local YYYY-MM-DDTHH:mm for a `datetime-local` input (browsers treat it as local). */
const toLocalInput = (d: Date) => `${toLocalDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export const AvailabilityTimeField: DateFieldClientComponent = ({ field, path: pathProp }) => {
  const fieldPath = pathProp ?? field?.name ?? 'startTime'
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT
  const { setValue, value } = useField<string>({ path: fieldPath })

  const service = useFormFields(([fields]) => fields?.service?.value)
  const resource = useFormFields(([fields]) => fields?.resource?.value)

  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(false)
  const [day, setDay] = useState<string>(() =>
    value ? toLocalDay(new Date(value)) : toLocalDay(new Date()),
  )

  const serviceId = extractId(service)
  const resourceId = extractId(resource)
  const apiBase = `${config.serverURL ?? ''}${config.routes.api}`

  useEffect(() => {
    if (!serviceId || !resourceId || !day) {
      setSlots([])
      return
    }
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `${apiBase}/reserve/slots?resource=${resourceId}&service=${serviceId}&date=${day}`,
        )
        const json = await res.json()
        setSlots((json.slots ?? []) as Slot[])
      } catch {
        setSlots([])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [serviceId, resourceId, day, apiBase])

  if (!serviceId || !resourceId) {
    return (
      <div className={styles.wrapper}>
        <FieldLabel label={field?.label} path={fieldPath} />
        <input
          className={styles.fallback}
          onChange={(e) => setValue(e.target.value ? new Date(e.target.value).toISOString() : '')}
          type="datetime-local"
          value={value ? toLocalInput(new Date(value)) : ''}
        />
        <p className={styles.hint}>{t('reservation:pickPrompt')}</p>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <FieldLabel label={field?.label} path={fieldPath} />
      <input className={styles.day} onChange={(e) => setDay(e.target.value)} type="date" value={day} />
      {loading ? (
        <p className={styles.hint}>{t('reservation:pickLoading')}</p>
      ) : slots.length === 0 ? (
        <p className={styles.hint}>{t('reservation:pickNone')}</p>
      ) : (
        <div className={styles.slots}>
          {slots.map((s) => (
            <button
              className={value === s.start ? `${styles.slot} ${styles.selected}` : styles.slot}
              key={s.start}
              onClick={() => setValue(s.start)}
              type="button"
            >
              {fmt(s.start)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
