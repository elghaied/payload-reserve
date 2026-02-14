'use client'
import type { RelationshipFieldClientComponent } from 'payload'

import { FieldLabel, useConfig, useDocumentDrawer, useField, useTranslation } from '@payloadcms/ui'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import type { PluginT } from '../../translations/index.js'

import styles from './CustomerField.module.css'

type CustomerDoc = {
  email: string
  id: string
  name: string
  phone: string
}

export const CustomerField: RelationshipFieldClientComponent = ({ field, path: pathProp }) => {
  const fieldPath = pathProp ?? field?.name ?? 'customer'
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const { setValue, value } = useField<string>({ path: fieldPath })

  const slugs = config.admin?.custom?.reservationSlugs
  const userCollection: string = slugs?.userCollection ?? 'users'

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<CustomerDoc[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDoc | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: userCollection,
  })

  // Fetch selected customer details when value changes
  useEffect(() => {
    if (!value) {
      setSelectedCustomer(null)
      return
    }

    // If we already have the selected customer data, skip fetch
    if (selectedCustomer?.id === value) {return}

    const fetchCustomer = async () => {
      try {
        const res = await fetch(`/api/${userCollection}/${value}`)
        if (res.ok) {
          const doc = await res.json()
          setSelectedCustomer({
            id: doc.id,
            name: doc.name ?? '',
            email: doc.email ?? '',
            phone: doc.phone ?? '',
          })
        }
      } catch {
        // Silently fail — the field will still show the ID
      }
    }
    void fetchCustomer()
  }, [value, userCollection, selectedCustomer?.id])

  // Debounced search
  const doSearch = useCallback(
    async (query: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '10', search: query })
        const res = await fetch(`/api/reservation-customer-search?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.docs)
        }
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setSearch(val)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        void doSearch(val)
      }, 300)
    },
    [doSearch],
  )

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = useCallback(
    (customer: CustomerDoc) => {
      setValue(customer.id)
      setSelectedCustomer(customer)
      setIsOpen(false)
      setSearch('')
    },
    [setValue],
  )

  const handleClear = useCallback(() => {
    setValue(null as unknown as string)
    setSelectedCustomer(null)
    setSearch('')
  }, [setValue])

  const handleFocus = useCallback(() => {
    setIsOpen(true)
    if (results.length === 0) {
      void doSearch('')
    }
  }, [doSearch, results.length])

  const handleCreate = useCallback(() => {
    setIsOpen(false)
    openDrawer()
  }, [openDrawer])

  const handleDrawerSave = useCallback(
    ({ doc }: { doc: Record<string, unknown> }) => {
      const customer: CustomerDoc = {
        id: doc.id as string,
        name: (doc.name as string) ?? '',
        email: (doc.email as string) ?? '',
        phone: (doc.phone as string) ?? '',
      }
      setValue(customer.id)
      setSelectedCustomer(customer)
    },
    [setValue],
  )

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <FieldLabel label={field?.label ?? t('reservation:fieldCustomer')} path={fieldPath} required={field?.required} />

      {selectedCustomer ? (
        <div className={styles.selected}>
          <div className={styles.selectedInfo}>
            <span className={styles.selectedName}>{selectedCustomer.name || selectedCustomer.email}</span>
            <span className={styles.selectedMeta}>
              {[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(' · ')}
            </span>
          </div>
          <button
            className={styles.clearButton}
            onClick={handleClear}
            type="button"
          >
            {t('reservation:fieldCustomerClear')}
          </button>
        </div>
      ) : (
        <input
          aria-label={t('reservation:fieldCustomerSearch')}
          className={styles.searchInput}
          onChange={handleSearchChange}
          onFocus={handleFocus}
          placeholder={t('reservation:fieldCustomerSearch')}
          type="text"
          value={search}
        />
      )}

      {isOpen && !selectedCustomer && (
        <div className={styles.dropdown}>
          {loading && results.length === 0 ? (
            <div className={styles.noResults}>...</div>
          ) : results.length === 0 && search ? (
            <div className={styles.noResults}>{t('reservation:fieldCustomerNoResults')}</div>
          ) : (
            results.map((customer) => (
              <div
                aria-selected={false}
                className={styles.option}
                key={customer.id}
                onClick={() => handleSelect(customer)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleSelect(customer)
                  }
                }}
                role="option"
                tabIndex={0}
              >
                <span className={styles.optionName}>{customer.name || customer.email}</span>
                <span className={styles.optionMeta}>
                  {[customer.phone, customer.email].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))
          )}
          <button
            className={styles.createButton}
            onClick={handleCreate}
            type="button"
          >
            + {t('reservation:fieldCustomerCreateNew')}
          </button>
        </div>
      )}

      <DocumentDrawer onSave={handleDrawerSave} />
    </div>
  )
}
