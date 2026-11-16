import { getPath } from '../core/json-path.js'
import { compileView } from '../view/compile.js'
import type { CompiledView, ViewRoot } from '../view/spec.js'
import { validateView } from '../view/validate.js'
import { RESULTS, type DesignSample } from './samples.js'

/** Run a design sample through the same validate + compile steps as cloud_visualize. */
export function compileSample(sample: DesignSample): CompiledView {
  const spec = { v: 1, ...sample.view } as ViewRoot
  const errors = validateView(spec)
  if (errors.length) throw new Error(errors.join('\n'))
  return compileView(spec, {
    resolve: (b) => {
      if (!(b.ref in RESULTS)) throw new Error(`unknown ref ${b.ref}`)
      return getPath(RESULTS[b.ref], b.path ?? '')
    },
  }).view
}
