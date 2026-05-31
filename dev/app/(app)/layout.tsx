import type { ReactNode } from 'react'

import React from 'react'

export const metadata = {
  description: 'payload-reserve dev frontend',
  title: 'payload-reserve dev',
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          background: '#f6f7f9',
          color: '#111',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: 0,
        }}
      >
        {children}
      </body>
    </html>
  )
}
