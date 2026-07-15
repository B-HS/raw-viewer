import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBaseCurveLut } from '../src/gl/baseCurveLut'
import { REC2020_LUMA, REC2020_TO_P3, REC2020_TO_SRGB, SRGB_TO_P3 } from '../src/gl/colorSpaces'
import { buildToneCurveLut } from '../src/gl/toneCurveLut'
import { gainsFromTempTint } from '../src/gl/wbModel'
import type { BaseCurveMode } from '../src/types/BaseCurveMode'
import type { CurvePoint } from '../src/types/CurvePoint'
import type { CurvesState } from '../src/types/CurvesState'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'src-tauri', 'tests', 'fixtures-parity')
mkdirSync(outDir, { recursive: true })

const dump = (name: string, value: unknown) => {
    writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`)
    console.log(`wrote ${name}`)
}

const baseModes: BaseCurveMode[] = ['linear', 'standard', 'filmic', 'camera-match']
const baseModesOut: Record<string, number[]> = {}
for (const mode of baseModes) baseModesOut[mode] = Array.from(buildBaseCurveLut(256, mode))
dump('basecurve.json', { samples: 256, modes: baseModesOut })

const applyMatrix = (m: readonly number[], v: readonly number[]) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]

const colorVectors = [
    [1, 1, 1],
    [0.5, 0.5, 0.5],
    [0.18, 0.18, 0.18],
    [0.9, 0.2, 0.1],
    [0.05, 0.6, 0.85],
    [0.0, 0.0, 0.0],
    [1.4, 0.3, 0.7],
]
dump('colorspace.json', {
    rec2020ToSrgb: REC2020_TO_SRGB,
    rec2020ToP3: REC2020_TO_P3,
    srgbToP3: SRGB_TO_P3,
    luma: REC2020_LUMA,
    applyRec2020ToSrgb: colorVectors.map((v) => ({ in: v, out: applyMatrix(REC2020_TO_SRGB, v) })),
    applyRec2020ToP3: colorVectors.map((v) => ({ in: v, out: applyMatrix(REC2020_TO_P3, v) })),
})

const wbCases: { temp: number; tint: number; tempShift: number | null }[] = [
    { temp: 6500, tint: 0, tempShift: null },
    { temp: 3200, tint: 0, tempShift: null },
    { temp: 8000, tint: 0, tempShift: null },
    { temp: 5500, tint: 50, tempShift: null },
    { temp: 5500, tint: -80, tempShift: null },
    { temp: 2000, tint: 150, tempShift: null },
    { temp: 50000, tint: -150, tempShift: null },
    { temp: 6500, tint: 0, tempShift: 50 },
    { temp: 6500, tint: 20, tempShift: -30 },
    { temp: 4000, tint: -40, tempShift: 100 },
]
dump('wb.json', {
    cases: wbCases.map((c) => ({ ...c, gains: gainsFromTempTint(c.temp, c.tint, c.tempShift) })),
})

const identity = (): CurvePoint[] => [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
]
const curves = (rgb: CurvePoint[], red = identity(), green = identity(), blue = identity()): CurvesState => ({
    rgb,
    red,
    green,
    blue,
})
const toneCases: { label: string; curves: CurvesState }[] = [
    { label: 'identity', curves: curves(identity()) },
    {
        label: 'rgb-scurve',
        curves: curves([
            { x: 0, y: 0 },
            { x: 0.25, y: 0.18 },
            { x: 0.75, y: 0.82 },
            { x: 1, y: 1 },
        ]),
    },
    {
        label: 'red-lift',
        curves: curves(
            identity(),
            [
                { x: 0, y: 0.05 },
                { x: 0.5, y: 0.6 },
                { x: 1, y: 1 },
            ],
            identity(),
            identity(),
        ),
    },
    {
        label: 'three-point',
        curves: curves([
            { x: 0, y: 0 },
            { x: 0.5, y: 0.4 },
            { x: 1, y: 1 },
        ]),
    },
]
dump('tonecurve.json', {
    size: 1024,
    stride: 4,
    cases: toneCases.map((c) => ({ label: c.label, curves: c.curves, lut: Array.from(buildToneCurveLut(c.curves)) })),
})

console.log('parity vectors generated')
