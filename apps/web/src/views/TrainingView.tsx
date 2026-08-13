/**
 * Training view (issues #97 + #105).
 *
 * Hosts the training console: a stepper (Configure → Connect backend →
 * Run/monitor → Review) around the training module's spec-driven panel
 * (ADR-025), a persistent history rail (IndexedDB), and a collapsible help
 * drawer — plus the Colab import half of the loop (#97). Client-side only
 * (ADR-013/023/035).
 */

import { TrainingConsole } from '../training/console/TrainingConsole'

export function TrainingView() {
  return <TrainingConsole />
}

export default TrainingView