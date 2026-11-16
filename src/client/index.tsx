import * as React from 'react'
import { CSS, STYLE_ID } from './styles.js'
import { SettingsCard } from './settings.js'
import { CallToolView, VisualizeToolView } from './toolviews.js'
import type { ClientContext, SlotsService } from './types.js'

export { registerViewComponent, ViewRenderer } from './renderer/index.js'

function ensureCss(): () => void {
  if (typeof document === 'undefined') return () => undefined
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = CSS
  return () => { style?.remove() }
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsService | undefined
  if (!slots) return
  ctx.effect(ensureCss, STYLE_ID)
  slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: 'cloud_call' }, CallToolView))
  slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: 'cloud_visualize' }, VisualizeToolView))
  slots.inject('plugins.bundle.config', () => slots.register({ name: 'plugins.bundle.config', id: 'cloud-infra-accounts', key: PACKAGE_NAME }, BundleConfig))
}

export const PACKAGE_NAME = '@cocofhu/dsh-cloud-infra'

/** The Plugins page renders bundle config only with `view: 'page'`; other views get nothing. */
function BundleConfig(props: { view?: string }) {
  return props.view === 'page' ? <SettingsCard /> : null
}
