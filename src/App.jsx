import { useState } from 'react'
import WidgetShell from './components/WidgetShell.jsx'
import './App.css'

export default function App() {
  const [dark, setDark] = useState(false)
  return (
    <div className={`widget-wrapper${dark ? ' dark' : ''}`}>
      <div style={{ textAlign: 'right', marginBottom: '1rem' }}>
        <button onClick={() => setDark(!dark)}>Toggle {dark ? 'Light' : 'Dark'} Mode</button>
      </div>
      <WidgetShell />
    </div>
  )
}
