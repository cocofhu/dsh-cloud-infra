import * as React from 'react'
import TEA_CSS from 'virtual:tea-css'
import { CSS, STYLE_ID } from './styles.js'
import { SettingsCard } from './settings.js'
import { CallToolView, GENERIC_TOOLS, GenericToolView, VisualizeToolView } from './toolviews.js'
import { setLocaleRuntime, TeaLocale, type LocaleRuntime } from './i18n.js'
import { cardPlugin } from './chat-card.js'
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
  style.textContent = TEA_CSS + CSS
  return () => { style?.remove() }
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsService | undefined
  if (!slots) return
  ctx.effect(ensureCss, STYLE_ID)
  slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: 'cloud_call' }, CallToolView))
  slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: 'cloud_visualize' }, VisualizeToolView))
  for (const key of GENERIC_TOOLS) slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key }, GenericToolView))
  ctx.plugin?.(localePlugin)
  ctx.plugin?.(cardPlugin)
  slots.inject('plugins.bundle.config', () => slots.register({ name: 'plugins.bundle.config', id: 'cloud-infra-accounts', key: PACKAGE_NAME }, BundleConfig))
}

export const PACKAGE_NAME = '@cocofhu/dsh-cloud-infra'

/** Loads only where DSH provides its locale service; until then texts use the browser language. */
const localePlugin = {
  name: 'cloud-infra-locale',
  inject: ['locale'],
  apply(ctx: ClientContext): void {
    ctx.effect(() => {
      setLocaleRuntime(ctx.get('locale') as LocaleRuntime)
      return () => setLocaleRuntime(undefined)
    }, 'cloud-infra-locale')
  },
}

/** The Plugins page renders bundle config only with `view: 'page'`; other views get nothing. */
function BundleConfig(props: { view?: string }) {
  return props.view === 'page' ? <TeaLocale><SettingsCard /></TeaLocale> : null
}
