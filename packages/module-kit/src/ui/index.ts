/**
 * module-kit ui - public surface (ADR-025).
 *
 * Spec-driven controls + canvas visualizations + the param->control mapper.
 * The panel generator builds panels from ModuleSpec using these; the web app
 * imports them from this entry.
 */

export {
  UiSlider,
  UiNumber,
  UiSelect,
  UiToggle,
  UiButton,
  UiProgress,
  UiCollapsible,
  UiParamRow,
} from './controls'
export type {
  UiSliderProps,
  UiNumberProps,
  UiSelectProps,
  UiSelectOption,
  UiToggleProps,
  UiButtonProps,
  UiButtonVariant,
  UiProgressProps,
  UiCollapsibleProps,
  UiParamRowProps,
} from './controls'

export { UiBar, UiWaveform, UiCurve } from './canvas'
export type { UiBarProps, UiWaveformProps, UiCurveProps } from './canvas'

export { renderParamControl, renderParamRow, actionVariant, normalizeSelectOptions } from './mapper'
export type { ParamControlProps } from './mapper'

export { cn, LABEL_CLS, BTN_BASE, BTN_VARIANTS } from './styles'
