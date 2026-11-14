import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installErrorReporting } from './error-report'
import './theme/index.css'
import './styles.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('找不到 #root 挂载点')
}

installErrorReporting(window.spendTime)

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
