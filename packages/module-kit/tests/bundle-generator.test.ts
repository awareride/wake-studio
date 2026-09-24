import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModuleDeviceRuntime, ModuleSpec } from '@wake-studio/contracts'
import { generateDeviceBundle } from '../src/bundle-generator'
import { validateModuleSpec } from '../src/validator'

function device(
  modulePath: string,
  target: string,
  registration: ModuleDeviceRuntime['registration'],
  profile: 'mcu' | 'app',
  extra: Partial<ModuleDeviceRuntime> = {},
): ModuleDeviceRuntime {
  return {
    sdkModule: '@wake-studio/sdk-test',
    targets: ['test-host'],
    sourceDir: modulePath,
    cmakeTarget: target,
    supportedProfiles: [profile],
    registration,
    ...extra,
  }
}

function spec(input: {
  id: string
  category: 'afe' | 'kws'
  device: ModuleDeviceRuntime
  params?: ModuleSpec['params']
}): ModuleSpec {
  return {
    meta: {
      id: input.id,
      name: input.id,
      category: input.category,
      version: '1.2.3',
      maturity: 'pilot',
      owner: 'WakeStudio team',
      license: 'MIT (test fixture)',
      status: 'accepted',
    },
    params: input.params ?? [],
    actions: [],
    status: [],
    runtime: { device: input.device },
    tests: { l1: 'test.ts', required: ['l1'] },
    playground: { route: `/playground/${input.id}`, entry: 'test.ts' },
    interfaces: { provides: [], consumes: [] },
  }
}

const AEC = spec({
  id: 'afe-aec',
  category: 'afe',
  device: device(
    'packages/modules/afe/aec/device',
    'wake_afe_aec',
    { kind: 'afe-stage', id: 'aec', symbol: 'wake_afe_aec_ops' },
    'app',
  ),
  params: [{
    id: 'bypass',
    label: 'Bypass',
    group: 'primary',
    type: 'boolean',
    default: true,
    description: 'Bypass AEC.',
  }],
})

const NS = spec({
  id: 'rnnoise',
  category: 'afe',
  device: device(
    'packages/modules/afe/rnnoise/device',
    'wake_afe_rnnoise',
    { kind: 'afe-stage', id: 'ns', symbol: 'wake_afe_ns_ops' },
    'app',
  ),
  params: [{
    id: 'strength',
    label: 'Strength',
    group: 'primary',
    type: 'slider',
    default: 0.8,
    description: 'Denoising strength.',
  }, {
    id: 'token',
    label: 'Token',
    group: 'advanced',
    type: 'secret',
    default: 'must-not-leak',
    description: 'A secret fixture value.',
  }],
})

const KWS = spec({
  id: 'kws-openwakeword',
  category: 'kws',
  device: device(
    'packages/modules/kws/openwakeword/device',
    'wake_kws_openwakeword',
    { kind: 'kws-backend', id: 'openwakeword', symbol: 'wake_kws_openwakeword_ops' },
    'app',
    {
      modelFiles: ['melspectrogram.onnx', 'classifier.onnx'],
    },
  ),
  params: [{
    id: 'threshold',
    label: 'Threshold',
    group: 'primary',
    type: 'slider',
    default: 0.5,
    description: 'Trigger threshold.',
  }],
})

const QUALITY_THRESHOLDS = { farThreshold: 0.02, frrThreshold: 0.08 }

function generate() {
  return generateDeviceBundle({
    profile: 'app',
    kwsBackendId: KWS.meta.id,
    afeStageIds: [NS.meta.id, AEC.meta.id],
    qualityThresholds: QUALITY_THRESHOLDS,
    labels: ['hey studio'],
    specs: [KWS, NS, AEC],
  })
}

function execute(
  command: string,
  args: string[],
  env?: Record<string, string>,
): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    env: env ? { ...process.env, ...env } : process.env,
  })
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed (${result.status ?? result.signal})`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}

function run(command: string, args: string[]): void {
  execute(command, args)
}

const hasCmake = spawnSync('cmake', ['--version'], { encoding: 'utf8' }).status === 0
const hasSh = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

function realHostSpecs(): ModuleSpec[] {
  const modulesRoot = join(repoRoot, 'packages/modules')
  const specPaths: string[] = []
  for (const category of readdirSync(modulesRoot, { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    const categoryRoot = join(modulesRoot, category.name)
    const directSpec = join(categoryRoot, 'spec/module.spec.json')
    if (existsSync(directSpec)) specPaths.push(directSpec)
    for (const module of readdirSync(categoryRoot, { withFileTypes: true })) {
      if (!module.isDirectory()) continue
      const moduleSpec = join(categoryRoot, module.name, 'spec/module.spec.json')
      if (existsSync(moduleSpec)) specPaths.push(moduleSpec)
    }
  }
  return specPaths
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as ModuleSpec)
    .filter((spec) => spec.runtime.device)
}

describe('generateDeviceBundle (#189)', () => {
  it('emits deterministic build, composition, config, license, model, and test files', () => {
    const first = generate()
    const second = generate()

    expect(first.files).toEqual(second.files)
    expect(first.qualityThresholds).toEqual(QUALITY_THRESHOLDS)
    expect(first.modules.map((module) => module.id)).toEqual([
      'afe-aec',
      'kws-openwakeword',
      'rnnoise',
    ])

    const cmake = first.files['CMakeLists.txt']
    expect(cmake).toContain('set(WAKE_BUNDLE_PROFILE "app"')
    expect(cmake).toContain('wake_afe_aec')
    expect(cmake).toContain('wake_afe_rnnoise')
    expect(cmake).toContain('wake_kws_openwakeword')
    expect(cmake).toContain('wake_bundle_composition_test')

    // AEC must be registered before NS regardless of caller order.
    const composition = first.files['composition_root.cxx']
    expect(composition.indexOf('&wake_afe_aec_ops')).toBeLessThan(
      composition.indexOf('&wake_afe_ns_ops'),
    )
    expect(composition).toContain('wake_sdk_register_kws_backend(sdk, &wake_kws_openwakeword_ops)')
    expect(composition.endsWith('}\n}\n')).toBe(true)

    expect(first.files['afe.conf']).toContain('bypass = true')
    expect(first.files['afe.conf']).toContain('threshold = 0.5')
    expect(first.files['afe.conf']).toContain('token = ""')
    expect(first.files['afe.conf']).not.toContain('must-not-leak')
    expect(first.files['afe.conf'].indexOf('[afe-aec]')).toBeLessThan(
      first.files['afe.conf'].indexOf('[rnnoise]'),
    )
    expect(first.files['labels.json']).toContain('"hey studio"')
    expect(first.files['LICENSES.md']).toContain('MIT (test fixture)')
    expect(first.files['models/README.md']).toContain('melspectrogram.onnx')
    expect(first.files['test/far_frr.sh']).toContain('FAR_LIMIT=0.02')
    expect(first.files['test/far_frr.sh']).toContain('FRR_LIMIT=0.08')
  })

  it.skipIf(!hasSh)('keeps the generated FAR/FRR harness valid POSIX shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wake-frr-shell-'))
    try {
      const script = join(dir, 'far_frr.sh')
      writeFileSync(script, generate().files['test/far_frr.sh'])
      run('sh', ['-n', script])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!hasSh)('runs the FAR/FRR harness against a target runner contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wake-frr-behavior-'))
    try {
      const positives = join(dir, 'positives')
      const negatives = join(dir, 'negatives')
      mkdirSync(positives)
      mkdirSync(negatives)
      writeFileSync(join(positives, 'positive-a.wav'), '')
      writeFileSync(join(positives, 'positive-b.wav'), '')
      writeFileSync(join(negatives, 'negative-a.wav'), '')
      writeFileSync(join(negatives, 'negative-b.wav'), '')

      const config = join(dir, 'afe.conf')
      writeFileSync(config, generate().files['afe.conf'])
      const runner = join(dir, 'runner.sh')
      writeFileSync(runner, `#!/bin/sh
case "$1" in
  *positive-a.wav|*positive-b.wav) exit 0 ;;
  *negative-a.wav|*negative-b.wav) exit 1 ;;
  *) exit 2 ;;
esac
`)
      chmodSync(runner, 0o755)
      const script = join(dir, 'far_frr.sh')
      writeFileSync(script, generate().files['test/far_frr.sh'])

      const output = execute('sh', [
        script,
        '--positives', positives,
        '--negatives', negatives,
        '--config', config,
      ], { WAKE_FAR_FRR_RUNNER: runner })
      expect(output).toContain('POS\t')
      expect(output).toContain('NEG\t')
      expect(output).toContain('FAR=0.000000 FRR=0.000000 N_POS=2 N_NEG=2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects unknown, duplicate, malformed, and profile-incompatible selections', () => {
    expect(() => generateDeviceBundle({
      profile: 'app',
      kwsBackendId: 'missing',
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['wake'],
      specs: [KWS],
    })).toThrowError(expect.objectContaining({ code: 'unknown-module' }))

    expect(() => generateDeviceBundle({
      profile: 'app',
      kwsBackendId: KWS.meta.id,
      afeStageIds: [AEC.meta.id, AEC.meta.id],
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['wake'],
      specs: [KWS, AEC],
    })).toThrowError(expect.objectContaining({ code: 'invalid-selection' }))

    const malformed = structuredClone(KWS)
    malformed.runtime.device!.cmakeTarget = 'bad target; inject()'
    expect(() => generateDeviceBundle({
      profile: 'app',
      kwsBackendId: malformed.meta.id,
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['wake'],
      specs: [malformed],
    })).toThrowError(expect.objectContaining({ code: 'invalid-device-contract' }))

    expect(() => generateDeviceBundle({
      profile: 'mcu',
      kwsBackendId: KWS.meta.id,
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['wake'],
      specs: [KWS],
    })).toThrowError(expect.objectContaining({ code: 'profile-mismatch' }))

    expect(() => generateDeviceBundle({
      profile: 'app',
      kwsBackendId: KWS.meta.id,
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['wake', 'wake'],
      specs: [KWS],
    })).toThrowError(expect.objectContaining({ code: 'invalid-label' }))

    expect(() => generateDeviceBundle({
      profile: 'app',
      kwsBackendId: KWS.meta.id,
      qualityThresholds: { farThreshold: -0.1, frrThreshold: 0.1 },
      labels: ['wake'],
      specs: [KWS],
    })).toThrowError(expect.objectContaining({ code: 'invalid-thresholds' }))
  })

  it('validates generated device metadata with the shared spec validator', () => {
    for (const moduleSpec of [AEC, NS, KWS]) {
      expect(validateModuleSpec(moduleSpec)).toEqual({ ok: true, errors: [], warnings: [] })
    }

    const bad = structuredClone(KWS)
    bad.runtime.device!.sourceDir = '../outside/device'
    const result = validateModuleSpec(bad)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'runtime.device.sourceDir must be a repo-relative packages/modules/*/*/device path',
    )
  })
})

describe('real module specs (#189)', () => {
  it('validates and generates host bundles from the checked-in specs', () => {
    const specs = realHostSpecs()
    for (const spec of specs) {
      const deviceErrors = validateModuleSpec(spec).errors.filter((error) =>
        error.includes('runtime.device'),
      )
      expect(deviceErrors).toEqual([])
    }

    for (const kws of specs.filter((spec) => spec.meta.category === 'kws')) {
      const bundle = generateDeviceBundle({
        profile: 'app',
        kwsBackendId: kws.meta.id,
        qualityThresholds: QUALITY_THRESHOLDS,
        labels: ['hey studio'],
        specs,
      })
      expect(bundle.files['composition_root.cxx']).toContain(
        kws.runtime.device?.registration.symbol,
      )
    }

    const bundle = generateDeviceBundle({
      profile: 'app',
      kwsBackendId: 'kws-openwakeword',
      afeStageIds: ['rnnoise', 'afe-bss', 'afe-aec'],
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['hey studio'],
      specs,
    })
    expect(bundle.files['CMakeLists.txt']).toContain('wake_kws_openwakeword')
    expect(bundle.files['composition_root.cxx']).toContain('wake_kws_openwakeword_ops')
  })
})

describe.skipIf(!hasCmake)('real module specs (#189 emitted-project build)', () => {
  it('generates a host project from real specs, builds it, and passes composition-root ctest', () => {
    const specs = realHostSpecs()
    const openwakeword = specs.find((spec) => spec.meta.id === 'kws-openwakeword')!
    const bundle = generateDeviceBundle({
      profile: 'app',
      kwsBackendId: openwakeword.meta.id,
      afeStageIds: ['rnnoise', 'afe-bss', 'afe-aec'],
      qualityThresholds: QUALITY_THRESHOLDS,
      labels: ['hey studio'],
      specs,
    })

    const projectDir = mkdtempSync(join(tmpdir(), 'wake-studio-bundle-'))
    try {
      for (const [relative, contents] of Object.entries(bundle.files)) {
        const output = join(projectDir, relative)
        mkdirSync(dirname(output), { recursive: true })
        writeFileSync(output, contents)
      }
      const buildDir = join(projectDir, 'build')
      run('cmake', [
        '-S', projectDir,
        '-B', buildDir,
        `-DWAKE_SDK_ROOT=${join(repoRoot, 'device')}`,
        `-DWAKE_BUNDLE_MODULE_ROOT=${join(repoRoot, 'packages/modules')}`,
        `-DWAKE_REPO_ROOT=${repoRoot}`,
      ])
      run('cmake', ['--build', buildDir])
      run('ctest', ['--test-dir', buildDir, '--output-on-failure'])
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
