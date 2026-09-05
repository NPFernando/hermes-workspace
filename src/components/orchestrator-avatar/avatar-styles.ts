import type { OrchestratorState } from '@/hooks/use-orchestrator-state'

const STYLE_ID = 'oa-styles-v2'

export function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes oa-breathe { 0%,100% { transform:scale(1); } 50% { transform:scale(1.05); } }
    @keyframes oa-think-ring { 0% { stroke-dashoffset:0; } 100% { stroke-dashoffset:-60; } }
    @keyframes oa-dot1 { 0%,80%,100% { opacity:.15; } 40% { opacity:1; } }
    @keyframes oa-dot2 { 0%,80%,100% { opacity:.15; } 50% { opacity:1; } }
    @keyframes oa-dot3 { 0%,80%,100% { opacity:.15; } 60% { opacity:1; } }
    @keyframes oa-bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-1.5px); } }
    @keyframes oa-ear-twitch { 0%,90%,100% { transform:rotate(0deg); } 93% { transform:rotate(-4deg); } 96% { transform:rotate(4deg); } }
    @keyframes oa-tail-wag { 0%,100% { transform:rotate(0deg); } 25% { transform:rotate(8deg); } 75% { transform:rotate(-8deg); } }
    @keyframes oa-type { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-1px); } }
  `
  document.head.appendChild(style)
}

export function stateAnim(state: OrchestratorState): string {
  if (state === 'idle') return 'oa-breathe 3s ease-in-out infinite'
  if (state === 'responding') return 'oa-bob 0.8s ease-in-out infinite'
  return 'none'
}
