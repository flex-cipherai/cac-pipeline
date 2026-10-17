import { useState, useEffect } from 'react'

// The toast every Settings page shows after saving. `toast` is the element to render once at the bottom of
// the page; `showToast(type, text)` ('success' | 'error') raises it for four seconds.
export default function useToast() {
  const [state, setState] = useState({ show: false, type: '', text: '' })

  useEffect(() => {
    if (!state.show) return
    const timer = setTimeout(() => setState({ show: false, type: '', text: '' }), 4000)
    return () => clearTimeout(timer)
  }, [state.show, state.text])

  function showToast(type, text) { setState({ show: true, type, text }) }

  const toast = state.show ? (
    <div className={`toast toast-${state.type}`} role="status">
      {state.type === 'success' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 8.5l3 3 5-6" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.5v.5" /></svg>
      )}
      {state.text}
    </div>
  ) : null

  return { showToast, toast }
}
