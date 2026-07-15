import { create } from 'zustand'

export type SamplerUnit = 'percent' | 'byte' | 'hex'

export type SamplerPin = { id: number; u: number; v: number; unit: SamplerUnit }

export const MAX_PINS = 5

const UNIT_ORDER: SamplerUnit[] = ['percent', 'byte', 'hex']

type SamplerPinsState = {
    pins: Record<string, SamplerPin[]>
    seq: number
    add: (imageId: string, u: number, v: number) => void
    remove: (imageId: string, id: number) => void
    cycleUnit: (imageId: string, id: number) => void
    clear: (imageId: string) => void
}

export const useSamplerPins = create<SamplerPinsState>((set) => ({
    pins: {},
    seq: 0,
    add: (imageId, u, v) =>
        set((state) => {
            const existing = state.pins[imageId] ?? []
            if (existing.length >= MAX_PINS) return state
            const id = state.seq + 1
            return { seq: id, pins: { ...state.pins, [imageId]: [...existing, { id, u, v, unit: 'percent' }] } }
        }),
    remove: (imageId, id) =>
        set((state) => {
            const existing = state.pins[imageId]
            if (!existing) return state
            return { pins: { ...state.pins, [imageId]: existing.filter((pin) => pin.id !== id) } }
        }),
    cycleUnit: (imageId, id) =>
        set((state) => {
            const existing = state.pins[imageId]
            if (!existing) return state
            return {
                pins: {
                    ...state.pins,
                    [imageId]: existing.map((pin) =>
                        pin.id === id ? { ...pin, unit: UNIT_ORDER[(UNIT_ORDER.indexOf(pin.unit) + 1) % UNIT_ORDER.length] } : pin,
                    ),
                },
            }
        }),
    clear: (imageId) =>
        set((state) => {
            if (!state.pins[imageId]) return state
            const next = { ...state.pins }
            delete next[imageId]
            return { pins: next }
        }),
}))
