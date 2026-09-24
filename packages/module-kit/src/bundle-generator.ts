/**
 * Spec-driven device bundle generator (#189, ADR-047).
 *
 * Pure TypeScript: selected ModuleSpecs in, deterministic bundle text out.
 * Binary model staging and ZIP assembly stay in #41; this slice emits the
 * build/config/license/test contract consumed by that packaging flow.
 */

import type {
  DeviceProfile,
  DeviceQualityThresholds,
  ModuleDeviceRuntime,
  ModuleParam,
  ModuleSpec,
} from '@wake-studio/contracts'

export type BundleFileMap = Readonly<Record<string, string>>

export interface BundleGeneratorInput {
  profile: DeviceProfile
  /** Module id of the one selected KWS backend (for example `kws-openwakeword`). */
  kwsBackendId: string
  /** Optional selected AFE stage module ids. Registration is always AEC -> BSS -> NS. */
  afeStageIds?: readonly string[]
  labels: readonly string[]
  /** Product-owned acceptance limits; never inferred from a trigger threshold. */
  qualityThresholds: DeviceQualityThresholds
  specs: readonly ModuleSpec[]
}

export interface GeneratedBundleModule {
  id: string
  version: string
  license: string
}

export interface GeneratedBundle {
  profile: DeviceProfile
  kwsBackendId: string
  labels: readonly string[]
  qualityThresholds: DeviceQualityThresholds
  modules: readonly GeneratedBundleModule[]
  /** Bundle-relative UTF-8 files. #41 turns this map into the downloadable ZIP. */
  files: BundleFileMap
}

export type BundleGenerationErrorCode =
  | 'duplicate-module'
  | 'invalid-device-contract'
  | 'invalid-label'
  | 'invalid-selection'
  | 'invalid-thresholds'
  | 'profile-mismatch'
  | 'unknown-module'

export class BundleGenerationError extends Error {
  constructor(
    readonly code: BundleGenerationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BundleGenerationError'
  }
}

interface SelectedModule {
  spec: ModuleSpec
  device: ModuleDeviceRuntime
}

const AFE_PIPELINE_ORDER = ['aec', 'bss', 'ns'] as const
const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const BUNDLE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PARAM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEVICE_SOURCE_DIR = /^packages\/modules\/[a-z0-9-]+\/[a-z0-9-]+\/device$/

function fail(code: BundleGenerationErrorCode, message: string): never {
  throw new BundleGenerationError(code, message)
}

/** Generate the deterministic text portion of a target SDK bundle. */
export function generateDeviceBundle(input: BundleGeneratorInput): GeneratedBundle {
  const specsById = indexSpecs(input.specs)
  const kws = requireModule(input.kwsBackendId, specsById)
  assertSelection(kws, 'kws', 'kws-backend')

  const requestedAfeIds = input.afeStageIds ?? []
  if (new Set(requestedAfeIds).size !== requestedAfeIds.length) {
    fail('invalid-selection', 'AFE stage module ids must be unique')
  }
  const afe = requestedAfeIds.map((id) => {
    const selected = requireModule(id, specsById)
    assertSelection(selected, 'afe', 'afe-stage')
    return selected
  })

  const orderedAfe = [...afe].sort(
    (left, right) => afeOrder(left.device.registration.id) - afeOrder(right.device.registration.id),
  )
  const selected = [...orderedAfe, kws]

  assertProfile(selected, input.profile)
  assertUniqueDeviceMetadata(selected)

  const labels = normalizeLabels(input.labels)
  const qualityThresholds = validateQualityThresholds(input.qualityThresholds)
  const kwsDevice = kws.device
  if (!kwsDevice.modelFiles?.length) {
    fail(
      'invalid-device-contract',
      `${kws.spec.meta.id}: KWS runtime.device.modelFiles must declare at least one file`,
    )
  }

  const files: Record<string, string> = {
    'CMakeLists.txt': renderCMake(input.profile, selected),
    'composition_root.cxx': renderCompositionRoot(selected),
    'afe.conf': renderConfig(input.profile, kwsDevice.registration.id, selected),
    'labels.json': `${JSON.stringify({ labels }, null, 2)}\n`,
    'LICENSES.md': renderLicenses(selected),
    'README.md': renderReadme(input.profile, kwsDevice.registration.id, labels, selected),
    'models/README.md': renderModelReadme(kws),
    'test/composition_root_test.cxx': renderCompositionTest(orderedAfe, kws),
    'test/far_frr.sh': renderFarFrrScript(qualityThresholds),
    'test/README.md': renderTestReadme(kwsDevice.registration.id),
  }

  return {
    profile: input.profile,
    kwsBackendId: kws.spec.meta.id,
    labels,
    qualityThresholds,
    modules: selected
      .map(({ spec }) => ({ id: spec.meta.id, version: spec.meta.version, license: spec.meta.license }))
      .sort((left, right) => compareText(left.id, right.id)),
    files,
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function indexSpecs(specs: readonly ModuleSpec[]): Map<string, ModuleSpec> {
  const indexed = new Map<string, ModuleSpec>()
  for (const spec of specs) {
    if (!MODULE_ID.test(spec.meta.id)) {
      fail('invalid-device-contract', `Invalid module id: ${spec.meta.id}`)
    }
    if (typeof spec.meta.license !== 'string' || !spec.meta.license.trim()) {
      fail('invalid-device-contract', `${spec.meta.id}: meta.license is required`)
    }
    if (indexed.has(spec.meta.id)) {
      fail('duplicate-module', `Duplicate module spec: ${spec.meta.id}`)
    }
    indexed.set(spec.meta.id, spec)
  }
  return indexed
}

function requireModule(id: string, specs: ReadonlyMap<string, ModuleSpec>): SelectedModule {
  const spec = specs.get(id)
  if (!spec) fail('unknown-module', `Unknown module: ${id}`)
  const device = spec.runtime.device
  if (!device) {
    fail('invalid-device-contract', `${id}: runtime.device is required for bundle generation`)
  }
  validateDeviceContract(id, device)
  return { spec, device }
}

function validateDeviceContract(moduleId: string, device: ModuleDeviceRuntime): void {
  if (typeof device.sourceDir !== 'string' || !DEVICE_SOURCE_DIR.test(device.sourceDir)) {
    fail('invalid-device-contract', `${moduleId}: invalid runtime.device.sourceDir`)
  }
  if (typeof device.cmakeTarget !== 'string' || !C_IDENTIFIER.test(device.cmakeTarget)) {
    fail('invalid-device-contract', `${moduleId}: invalid runtime.device.cmakeTarget`)
  }
  if (!Array.isArray(device.supportedProfiles) || !device.supportedProfiles.length) {
    fail('invalid-device-contract', `${moduleId}: runtime.device.supportedProfiles is empty`)
  }
  for (const profile of device.supportedProfiles) {
    if (profile !== 'mcu' && profile !== 'app') {
      fail('invalid-device-contract', `${moduleId}: invalid SDK profile ${profile}`)
    }
  }

  const registration = device.registration
  if (!registration || typeof registration !== 'object') {
    fail('invalid-device-contract', `${moduleId}: runtime.device.registration is required`)
  }
  if (!['afe-stage', 'kws-backend'].includes(registration.kind)) {
    fail('invalid-device-contract', `${moduleId}: invalid registration kind`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(registration.id)) {
    fail('invalid-device-contract', `${moduleId}: invalid registration id`)
  }
  if (!C_IDENTIFIER.test(registration.symbol)) {
    fail('invalid-device-contract', `${moduleId}: invalid registration symbol`)
  }

  if (device.modelFiles != null && !Array.isArray(device.modelFiles)) {
    fail('invalid-device-contract', `${moduleId}: runtime.device.modelFiles must be an array`)
  }
  const modelFiles = device.modelFiles ?? []
  if (new Set(modelFiles).size !== modelFiles.length) {
    fail('invalid-device-contract', `${moduleId}: runtime.device.modelFiles must be unique`)
  }
  for (const modelFile of modelFiles) {
    if (typeof modelFile !== 'string' || !BUNDLE_FILENAME.test(modelFile) || modelFile.includes('..')) {
      fail('invalid-device-contract', `${moduleId}: invalid model filename ${modelFile}`)
    }
  }
  const thresholds = device.thresholds
  if (thresholds != null && (
    typeof thresholds !== 'object' ||
    !Number.isFinite(thresholds.farThreshold) || thresholds.farThreshold < 0 || thresholds.farThreshold > 1 ||
    !Number.isFinite(thresholds.frrThreshold) || thresholds.frrThreshold < 0 || thresholds.frrThreshold > 1
  )) {
    fail('invalid-device-contract', `${moduleId}: FAR/FRR thresholds must be within [0,1]`)
  }
}

function assertSelection(
  selected: SelectedModule,
  category: 'afe' | 'kws',
  registrationKind: 'afe-stage' | 'kws-backend',
): void {
  const { spec, device } = selected
  if (spec.meta.category !== category) {
    fail('invalid-selection', `${spec.meta.id}: expected a ${category} module`)
  }
  if (device.registration.kind !== registrationKind) {
    fail('invalid-selection', `${spec.meta.id}: expected ${registrationKind} registration`)
  }
}

function assertProfile(selected: readonly SelectedModule[], profile: DeviceProfile): void {
  for (const { spec, device } of selected) {
    if (!device.supportedProfiles.includes(profile)) {
      fail(
        'profile-mismatch',
        `${spec.meta.id}: module does not support the ${profile} profile`,
      )
    }
  }
}

function assertUniqueDeviceMetadata(selected: readonly SelectedModule[]): void {
  for (const [field, getValue] of [
    ['CMake target', ({ device }: SelectedModule) => device.cmakeTarget],
    ['registration id', ({ device }: SelectedModule) => device.registration.id],
    ['registration symbol', ({ device }: SelectedModule) => device.registration.symbol],
  ] as const) {
    const seen = new Set<string>()
    for (const module of selected) {
      const value = getValue(module)
      if (seen.has(value)) {
        fail('invalid-selection', `Duplicate device ${field}: ${value}`)
      }
      seen.add(value)
    }
  }
}

function afeOrder(id: string): number {
  const index = AFE_PIPELINE_ORDER.indexOf(id as (typeof AFE_PIPELINE_ORDER)[number])
  if (index < 0) fail('invalid-device-contract', `Unknown AFE pipeline stage: ${id}`)
  return index
}

function normalizeLabels(labels: readonly string[]): string[] {
  const normalized = labels.map((label) => label.trim()).filter(Boolean)
  if (!normalized.length) fail('invalid-label', 'At least one non-empty wake-word label is required')
  if (new Set(normalized).size !== normalized.length) fail('invalid-label', 'Wake-word labels must be unique')
  if (normalized.some((label) => label.length > 128 || /[\r\n`]/.test(label))) {
    fail('invalid-label', 'Wake-word labels must be <=128 characters without newlines or backticks')
  }
  return normalized
}

function validateQualityThresholds(
  thresholds: DeviceQualityThresholds,
): DeviceQualityThresholds {
  if (!thresholds || typeof thresholds !== 'object' ||
    !Number.isFinite(thresholds.farThreshold) || thresholds.farThreshold < 0 || thresholds.farThreshold > 1 ||
    !Number.isFinite(thresholds.frrThreshold) || thresholds.frrThreshold < 0 || thresholds.frrThreshold > 1
  ) {
    fail('invalid-thresholds', 'FAR/FRR thresholds must be finite values within [0,1]')
  }
  return { ...thresholds }
}

function renderCMake(profile: DeviceProfile, selected: readonly SelectedModule[]): string {
  const moduleAdds = selected.map(({ device }, index) => {
    const relativeDir = device.sourceDir.replace(/^packages\/modules\//, '')
    return [
      `add_subdirectory(`,
      `  "\${WAKE_BUNDLE_MODULE_ROOT}/${relativeDir}"`,
      `  "\${CMAKE_CURRENT_BINARY_DIR}/generated/module-${String(index).padStart(2, '0')}"`,
      `)`,
    ].join('\n')
  }).join('\n\n')
  const targetList = selected.map(({ device }) => `  ${device.cmakeTarget}`).join('\n')

  return `# Generated by WakeStudio bundle generator (#189). Do not edit by hand.
cmake_minimum_required(VERSION 3.20)
project(wake_studio_bundle LANGUAGES C CXX)

set(WAKE_SDK_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}/sdk" CACHE PATH
    "WakeStudio SDK root (contains core/ and cmake/)")
set(WAKE_BUNDLE_MODULE_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}/modules" CACHE PATH
    "Root containing selected packages/modules module trees")
set(WAKE_REPO_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}" CACHE PATH
    "Root used by module CMake files for pinned third_party sources")
set(WAKE_BUNDLE_PROFILE "${profile}" CACHE STRING "Bundle SDK profile" FORCE)
set(WAKE_SDK_PROFILE "\${WAKE_BUNDLE_PROFILE}" CACHE STRING "SDK profile" FORCE)

include("\${WAKE_SDK_ROOT}/cmake/sdk-options.cmake")
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_subdirectory("\${WAKE_SDK_ROOT}/core" "\${CMAKE_CURRENT_BINARY_DIR}/generated/sdk-core")

${moduleAdds}

add_library(wake_bundle_composition STATIC composition_root.cxx)
target_link_libraries(wake_bundle_composition PUBLIC
  wake_sdk_core
${targetList}
)

add_executable(wake_bundle_composition_test test/composition_root_test.cxx)
target_link_libraries(wake_bundle_composition_test PRIVATE wake_bundle_composition)

enable_testing()
add_test(NAME composition_root COMMAND wake_bundle_composition_test)
`
}

function renderCompositionRoot(selected: readonly SelectedModule[]): string {
  const includes = new Set<string>()
  for (const { device } of selected) {
    includes.add(device.registration.kind === 'afe-stage' ? 'wake/afe_graph.h' : 'wake/kws_backend.h')
  }
  const externs = selected.map(({ device }) =>
    `extern const wake_${device.registration.kind === 'afe-stage' ? 'afe_stage' : 'kws_backend'}_ops_t ${device.registration.symbol};`,
  )
  const registrations = selected.map(({ spec, device }) => {
    const functionName = device.registration.kind === 'afe-stage'
      ? 'wake_sdk_register_afe_stage'
      : 'wake_sdk_register_kws_backend'
    return `  ${functionName}(sdk, &${device.registration.symbol}); /* ${spec.meta.id} */`
  })

  return `/* Generated by WakeStudio bundle generator (#189). Do not edit by hand. */
${[...includes].map((include) => `#include "${include}"`).join('\n')}
#include "wake/sdk.h"

extern "C" {
${externs.join('\n')}

void wake_sdk_compose(wake_sdk_t *sdk) {
${registrations.join('\n')}
}
`
}

function renderConfig(
  profile: DeviceProfile,
  backendId: string,
  selected: readonly SelectedModule[],
): string {
  const lines = [
    '# Generated by WakeStudio bundle generator (#189). Values are module-spec defaults.',
    '[sdk]',
    `profile = ${JSON.stringify(profile)}`,
    `kwsBackend = ${JSON.stringify(backendId)}`,
    '',
  ]
  for (const { spec } of selected) {
    lines.push(`[${spec.meta.id}]`)
    for (const param of spec.params) {
      if (!PARAM_ID.test(param.id)) {
        fail('invalid-device-contract', `${spec.meta.id}: invalid config param id ${param.id}`)
      }
      const value = param.type === 'secret' ? '""' : formatConfigValue(param)
      lines.push(`${param.id} = ${value}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function formatConfigValue(param: ModuleParam): string {
  if (typeof param.default === 'string') return JSON.stringify(param.default)
  if (typeof param.default === 'number') {
    if (!Number.isFinite(param.default)) {
      fail('invalid-device-contract', `${param.id}: config default must be finite`)
    }
    return String(param.default)
  }
  if (typeof param.default === 'boolean') return String(param.default)
  return JSON.stringify(param.default)
}

function renderLicenses(selected: readonly SelectedModule[]): string {
  const sections = [...selected]
    .sort((left, right) => compareText(left.spec.meta.id, right.spec.meta.id))
    .map(({ spec }) => `## ${spec.meta.id} ${spec.meta.version}\n\n- Module: ${spec.meta.name}\n- License: ${spec.meta.license}`)
  return `# Bundle Licenses

Generated from the selected module specs by WakeStudio (#189). These declarations
must be reviewed with the staged model and runtime artifacts before distribution.
The commercial-use gate is owned by issue #42.

${sections.join('\n\n')}\n`
}

function renderReadme(
  profile: DeviceProfile,
  backendId: string,
  labels: readonly string[],
  selected: readonly SelectedModule[],
): string {
  const modules = selected
    .slice()
    .sort((left, right) => compareText(left.spec.meta.id, right.spec.meta.id))
    .map(({ spec, device }) => `| \`${spec.meta.id}\` | ${spec.meta.version} | \`${device.cmakeTarget}\` | \`${device.registration.symbol}\` |`)
    .join('\n')
  const modelFiles = selected.find(({ spec }) => spec.meta.category === 'kws')?.device.modelFiles ?? []

  return `# WakeStudio device bundle

Generated by WakeStudio from module specs (#189). Do not edit the generated
composition root or CMake target list by hand.

## Configuration

- SDK profile: \`${profile}\`
- KWS module: \`${backendId}\`
- Runtime backend id: \`${selected.find(({ spec }) => spec.meta.category === 'kws')?.device.registration.id ?? 'unknown'}\`
- Wake-word labels: ${labels.map((label) => `\`${label}\``).join(', ')}

\`afe.conf\` contains the selected modules' spec defaults. \`labels.json\` is the
portable label manifest. Stage the required model files under \`models/\`:

${modelFiles.map((file) => `- \`models/${file}\``).join('\n')}

## Build

A packaged bundle stages the SDK at \`sdk/\` and selected module trees at
\`modules/\`. During repository validation those roots can be overridden:

\`\`\`sh
cmake -S . -B build \\
  -DWAKE_SDK_ROOT=/path/to/wake-studio/device \\
  -DWAKE_BUNDLE_MODULE_ROOT=/path/to/wake-studio/packages/modules \\
  -DWAKE_REPO_ROOT=/path/to/wake-studio
cmake --build build
ctest --test-dir build --output-on-failure
\`\`\`

Runtime-heavy KWS targets keep their module-owned CMake options at their default
compile-only setting in this generator slice. The packaging flow must stage the
pinned runtime and enable the selected driver option before inference.

## Modules

| Module | Spec version | CMake target | Registration |
|---|---|---|---|
${modules}

See \`LICENSES.md\` before distribution and \`test/README.md\` for the FAR/FRR
runner contract.
`
}

function renderModelReadme(kws: SelectedModule): string {
  return `# Required model files

The selected KWS driver (\`${kws.spec.meta.id}\`) declares these filenames:

${kws.device.modelFiles?.map((file) => `- \`${file}\``).join('\n') ?? ''}

The #41 packaging flow stages the selected model bytes and any pinned runtime
under this directory. This generator slice emits metadata and build wiring only.
`
}

function renderCompositionTest(afe: readonly SelectedModule[], kws: SelectedModule): string {
  const stageChecks = afe.map(({ device }) =>
    `  if (wake_sdk_stage_by_id(sdk, "${device.registration.id}") == nullptr) return __LINE__;`,
  )
  return `/* Generated by WakeStudio bundle generator (#189). */
#include <cstdio>

#include "wake/afe_graph.h"
#include "wake/kws_backend.h"
#include "wake/sdk.h"

extern "C" void wake_sdk_compose(wake_sdk_t *sdk);

int main() {
  wake_sdk_config_t config{};
  wake_sdk_t *sdk = wake_sdk_create(&config);
  if (sdk == nullptr) return 10;
  wake_sdk_compose(sdk);

  if (wake_sdk_stage_count(sdk) != ${afe.length}u) return 11;
${stageChecks.join('\n')}

  if (wake_sdk_backend_count(sdk) != 1u) return 12;
  if (wake_sdk_backend_by_id(sdk, "${kws.device.registration.id}") == nullptr) return 13;

  std::printf("composition root registered ${afe.length} AFE stage(s) and ${kws.device.registration.id}\\n");
  wake_sdk_destroy(sdk);
  return 0;
}
`
}

function renderFarFrrScript(thresholds: DeviceQualityThresholds): string {
  return `#!/bin/sh
# Generated by WakeStudio bundle generator (#189). Do not edit by hand.
set -eu

FAR_LIMIT=${thresholds.farThreshold}
FRR_LIMIT=${thresholds.frrThreshold}
POSITIVES=""
NEGATIVES=""
CONFIG="afe.conf"

usage() {
  echo "usage: $0 --positives <dir> --negatives <dir> [--config <afe.conf>]" >&2
  echo "set WAKE_FAR_FRR_RUNNER to an executable that accepts <wav> --config <path>" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --positives) [ "$#" -ge 2 ] || { usage; exit 2; }; POSITIVES="$2"; shift 2 ;;
    --negatives) [ "$#" -ge 2 ] || { usage; exit 2; }; NEGATIVES="$2"; shift 2 ;;
    --config) [ "$#" -ge 2 ] || { usage; exit 2; }; CONFIG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[ -n "$POSITIVES" ] && [ -d "$POSITIVES" ] || { echo "positive audio directory not found" >&2; exit 2; }
[ -n "$NEGATIVES" ] && [ -d "$NEGATIVES" ] || { echo "negative audio directory not found" >&2; exit 2; }
[ -f "$CONFIG" ] || { echo "config file not found: $CONFIG" >&2; exit 2; }
[ -n "\${WAKE_FAR_FRR_RUNNER:-}" ] || { echo "WAKE_FAR_FRR_RUNNER is required" >&2; exit 2; }

positive_list=$(mktemp)
negative_list=$(mktemp)
results=$(mktemp)
cleanup() {
  rm -f "$positive_list" "$negative_list" "$results"
}
trap cleanup EXIT HUP INT TERM

find "$POSITIVES" -type f -name '*.wav' | LC_ALL=C sort > "$positive_list"
find "$NEGATIVES" -type f -name '*.wav' | LC_ALL=C sort > "$negative_list"
[ -s "$positive_list" ] || { echo "no positive .wav files" >&2; exit 2; }
[ -s "$negative_list" ] || { echo "no negative .wav files" >&2; exit 2; }

run_one() {
  run_kind="$1"
  run_file="$2"
  set +e
  "$WAKE_FAR_FRR_RUNNER" "$run_file" --config "$CONFIG" >/dev/null
  run_status=$?
  set -e
  case "$run_status" in
    0) run_triggered=1 ;;
    1) run_triggered=0 ;;
    *) echo "runner error ($run_status): $run_file" >&2; exit 2 ;;
  esac
  printf '%s\t%s\t%s\n' "$run_kind" "$run_file" "$run_triggered"
}

while IFS= read -r audio_file; do
  run_one POS "$audio_file"
done < "$positive_list" > "$results"
while IFS= read -r audio_file; do
  run_one NEG "$audio_file"
done < "$negative_list" >> "$results"

cat "$results"
awk -F '\t' -v max_far="$FAR_LIMIT" -v max_frr="$FRR_LIMIT" '
  $1 == "POS" { n_pos++; if ($3 == 0) false_rejects++ }
  $1 == "NEG" { n_neg++; if ($3 == 1) false_accepts++ }
  END {
    if (n_pos == 0 || n_neg == 0) exit 2
    far = false_accepts / n_pos
    frr = false_rejects / n_neg
    printf "FAR=%.6f FRR=%.6f N_POS=%d N_NEG=%d", far, frr, n_pos, n_neg
    print ""
    if (far > max_far || frr > max_frr) exit 1
  }
' "$results"
`
}

function renderTestReadme(backendId: string): string {
  return `# Bundle tests

## Composition root

The generated CMake project builds and runs \`wake_bundle_composition_test\`.
It verifies that every selected AFE stage and the \`${backendId}\` backend register
through the emitted composition root.

## FAR/FRR

Set \`WAKE_FAR_FRR_RUNNER\` to a target-appropriate executable or wrapper. For
each clip, the runner receives:

\`\`\`text
<runner> <wav-path> --config <afe.conf>
\`\`\`

Exit code \`0\` means a trigger and \`1\` means no trigger; any other code is an
error. Then run:

\`\`\`sh
WAKE_FAR_FRR_RUNNER=./build/my-target-demo \\
  ./test/far_frr.sh --positives positives/ --negatives negatives/ --config afe.conf
\`\`\`

The script prints one result per clip and a final
\`FAR=<x> FRR=<y> N_POS=<n> N_NEG=<m>\` line. It exits \`1\` when either declared
threshold is exceeded.
`
}
