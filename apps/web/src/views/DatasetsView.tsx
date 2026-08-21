/**
 * Datasets view (ADR-044 §8, issue #208).
 *
 * Hosts the Datasets console: a list-detail layout (left rail = dataset list,
 * right pane = details + actions) plus a full-panel generation wizard, on the
 * shared ConsolePanel — mirroring the Training console. The console is built
 * out in #208 (list-detail -> wizard -> actions); this wrapper stays stable.
 */

import { DatasetsConsole } from '../datasets/console/DatasetsConsole'

export function DatasetsView() {
  return <DatasetsConsole />
}

export default DatasetsView
