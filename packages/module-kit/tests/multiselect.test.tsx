/**
 * module-kit - multiselect control (param type: multiselect, ADR-039 §4.6).
 *
 * The training wizard's "Output format(s)" selector lets the user pick several
 * target formats to zip. The value stays a comma-joined string so the
 * job-params contract is string-valued end-to-end.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UiMultiselect } from '../src/ui/controls'

const OPTIONS = [
  { value: 'onnx', label: 'onnx' },
  { value: 'tflite', label: 'tflite' },
  { value: 'tflite-int8', label: 'tflite-int8' },
]

function html(value: string) {
  return renderToStaticMarkup(
    <UiMultiselect value={value} options={OPTIONS} onChange={() => {}} />,
  )
}

describe('UiMultiselect', () => {
  it('marks the selected options as pressed (aria-pressed)', () => {
    const markup = html('onnx,tflite-int8')
    expect(markup).toContain('aria-pressed="true"')
    // two selected -> exactly two pressed chips
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(2)
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(1)
  })

  it('renders nothing selected for an empty value', () => {
    const markup = html('')
    expect(markup.match(/aria-pressed="true"/g)).toBeNull()
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(3)
  })

  it('labels the chips from the option labels', () => {
    const markup = html('onnx')
    expect(markup).toContain('onnx')
    expect(markup).toContain('tflite-int8')
  })
})
