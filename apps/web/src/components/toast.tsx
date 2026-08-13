/**
 * App-wide toast notifications (Radix Toast).
 *
 * `AppToastProvider` wraps the app and renders the viewport; `useToast()`
 * returns `{ toast }` to push notifications from anywhere in the shell.
 */

import * as React from 'react'
import { IconButton } from '@radix-ui/themes'
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './ui'

interface ToastItem {
  id: number
  title: string
  description?: string
  variant?: 'default' | 'success' | 'error'
}

interface ToastContextValue {
  toast: (opts: {
    title: string
    description?: string
    variant?: ToastItem['variant']
  }) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within AppToastProvider')
  return ctx
}

let nextId = 1

export function AppToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])

  const toast = React.useCallback(
    ({ title, description, variant = 'default' }: Omit<ToastItem, 'id'>) => {
      const id = nextId++
      setItems((prev) => [...prev, { id, title, description, variant }])
      // Auto-dismiss after 5 s.
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id))
      }, 5000)
    },
    [],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastProvider swipeDirection="right">
        {children}
        <ToastViewport>
          {items.map((t) => (
            <Toast
              key={t.id}
              className={
                t.variant === 'error'
                  ? 'border-danger/40'
                  : t.variant === 'success'
                    ? 'border-success/40'
                    : undefined
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <ToastTitle>{t.title}</ToastTitle>
                  {t.description && (
                    <ToastDescription>{t.description}</ToastDescription>
                  )}
                </div>
                <IconButton
                  onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
                  variant="ghost"
                  size="1"
                  className="text-ink-3"
                  aria-label="Dismiss notification"
                >
                  ✕
                </IconButton>
              </div>
            </Toast>
          ))}
        </ToastViewport>
      </ToastProvider>
    </ToastContext.Provider>
  )
}
