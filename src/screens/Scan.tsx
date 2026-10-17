import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { AppBar, Cell, Footnote, Group, Tile } from '../components/ui'
import { Icon } from '../components/icons'
import { useQrScanner, type ScanStatus } from '../scanner/useQrScanner'

const PROBLEM: Record<string, string> = {
  matter_code: 'That is the Matter setup code. It connects a device to your home. Look for the privacy code instead.',
  unknown_code: 'We do not know that code yet. Try the device library instead.',
  not_a_code: 'That does not look like a privacy code.',
}

const CAMERA_TEXT: Partial<Record<ScanStatus, string>> = {
  idle: 'Camera preview',
  starting: 'Starting the camera…',
  denied: 'Camera access is blocked. Allow it for this site in your browser settings, then try again.',
  insecure: 'The camera only works on a secure page. Open the app from an https:// address.',
  unsupported: 'This browser cannot use the camera. Type the code below, or use the device library.',
  error: 'The camera could not start. Another app may be using it.',
}

export default function Scan() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const busy = useRef(false)
  const last = useRef({ text: '', at: 0 })

  const handle = useCallback(async (payload: string) => {
    const now = Date.now()
    if (busy.current || (last.current.text === payload && now - last.current.at < 3000)) return
    last.current = { text: payload, at: now }
    busy.current = true
    try {
      const r = await api.resolveCode(payload)
      if (r.ok) {
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(30) // only after a tap, or the browser logs an error
        nav(`/preview/${r.device_id}`)
      } else {
        setProblem(PROBLEM[r.reason])
      }
    } finally {
      busy.current = false
    }
  }, [nav])

  const { status, retry } = useQrScanner(video, handle)
  useEffect(() => {
    if (!problem) return
    const t = window.setTimeout(() => setProblem(null), 5000)
    return () => window.clearTimeout(t)
  }, [problem])

  const cameraText = CAMERA_TEXT[status]
  const retryable = status === 'denied' || status === 'error'

  return (
    <div className="screen">
      <AppBar title="Scan the box" />
      <div style={{ padding: '0 16px' }}>
        <div style={{ fontSize: 16, lineHeight: '22px', fontWeight: 500 }}>Point at the privacy code on the box</div>
        <div className="sub" style={{ paddingTop: 2 }}>Before you buy, see what this device says it does with your data, checked against your household rules.</div>
      </div>

      <div className="cam">
        <video ref={video} playsInline muted aria-label="Camera view" />
        <i className="corner c1" /><i className="corner c2" /><i className="corner c3" /><i className="corner c4" />
        {cameraText && (
          <div className="msg" role="status">
            {cameraText}
            {retryable && <button className="btn" onClick={retry}>Try again</button>}
          </div>
        )}
        {status === 'scanning' && <div className="hint">Looking for a privacy code…</div>}
      </div>
      {problem && <div className="note" role="alert">{problem}</div>}

      <div className="gap" />
      <Group>
        <Cell className="t" to="/library">
          <Tile tone="blue"><Icon name="search" size={18} /></Tile>
          <div className="cb"><span className="ttl">Search the device library instead</span></div>
        </Cell>
        <Cell className="t" onClick={() => setTyping(!typing)} aria-expanded={typing}>
          <Tile tone="blue"><Icon name="rules" size={18} /></Tile>
          <div className="cb"><span className="ttl">Type the code instead</span></div>
        </Cell>
        {typing && (
          <form className="cell" style={{ padding: '8px 16px', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void handle(text) }}>
            <label className="sr" htmlFor="code">Privacy code</label>
            <input id="code" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://… or the code under the square" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ flex: 1, minWidth: 0, height: 44, border: '1px solid #c4c7cc', borderRadius: 12, padding: '0 12px', background: '#fff' }} />
            <button className="btn" style={{ flex: 'none', minHeight: 44 }} type="submit">Check</button>
          </form>
        )}
      </Group>
      <Footnote><b>Not the Matter code.</b> The Matter setup code connects a device to your home. The privacy code carries the device’s declaration.</Footnote>
      <div className="spacer" />
    </div>
  )
}
