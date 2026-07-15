import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useHistoryStore } from '../../store/historyStore'

type SliderProps = {
    label: string
    value: number
    min: number
    max: number
    step: number
    defaultValue: number
    coalesceKey: string
    onChange: (value: number) => void
    disabled?: boolean
    bigStep?: number
    format?: (value: number) => string
}

const clamp = (value: number, lo: number, hi: number) => (value < lo ? lo : value > hi ? hi : value)

const roundTo = (value: number, step: number) => {
    const snapped = Math.round(value / step) * step
    return Math.abs(snapped) < 1e-9 ? 0 : parseFloat(snapped.toFixed(6))
}

export const Slider: FC<SliderProps> = ({ label, value, min, max, step, defaultValue, coalesceKey, onChange, disabled, bigStep, format }) => {
    const { t } = useTranslation()
    const trackRef = useRef<HTMLDivElement>(null)
    const draggingRef = useRef(false)
    const [text, setText] = useState('')
    const [editing, setEditing] = useState(false)

    const display = format ? format(value) : String(roundTo(value, step))
    const ratio = clamp((value - min) / (max - min), 0, 1)

    const commit = (raw: number) => {
        const next = clamp(roundTo(raw, step), min, max)
        if (next !== value) onChange(next)
    }
    const valueFromClientX = (clientX: number) => {
        const element = trackRef.current
        if (!element) return value
        const rect = element.getBoundingClientRect()
        return min + clamp((clientX - rect.left) / rect.width, 0, 1) * (max - min)
    }
    const onPointerDown = (event: React.PointerEvent) => {
        if (disabled) return
        event.preventDefault()
        trackRef.current?.focus()
        draggingRef.current = true
        useHistoryStore.getState().beginCoalesce(coalesceKey)
        trackRef.current?.setPointerCapture(event.pointerId)
        commit(valueFromClientX(event.clientX))
    }
    const onPointerMove = (event: React.PointerEvent) => {
        if (!draggingRef.current) return
        commit(valueFromClientX(event.clientX))
    }
    const onPointerUp = (event: React.PointerEvent) => {
        if (!draggingRef.current) return
        draggingRef.current = false
        if (trackRef.current?.hasPointerCapture(event.pointerId)) trackRef.current.releasePointerCapture(event.pointerId)
        useHistoryStore.getState().endCoalesce()
    }
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (disabled) return
        const delta = event.shiftKey ? (bigStep ?? step * 10) : step
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            commit(value + delta)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            commit(value - delta)
        }
    }
    const reset = () => {
        if (!disabled && defaultValue !== value) onChange(defaultValue)
    }
    const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setText(event.target.value)
        const parsed = parseFloat(event.target.value)
        if (!Number.isNaN(parsed)) commit(parsed)
    }

    useEffect(() => {
        if (!editing) setText(display)
    }, [display, editing])

    return (
        <div className={`flex flex-col gap-1 ${disabled ? 'opacity-40' : ''}`}>
            <div className='flex items-center justify-between text-xs'>
                <span onDoubleClick={reset} className='cursor-default select-none text-neutral-300' title={t('panel.slider.resetHint')}>
                    {label}
                </span>
                <input
                    value={text}
                    disabled={disabled}
                    inputMode='decimal'
                    onFocus={() => setEditing(true)}
                    onBlur={() => setEditing(false)}
                    onChange={onInputChange}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                    aria-label={t('panel.slider.valueAria', { label })}
                    className='w-14 rounded bg-neutral-800 px-1.5 py-0.5 text-right text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
                />
            </div>
            <div
                ref={trackRef}
                role='slider'
                tabIndex={disabled ? -1 : 0}
                aria-label={label}
                aria-valuenow={value}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-disabled={disabled}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                onDoubleClick={reset}
                className='relative h-4 cursor-pointer touch-none select-none rounded outline-none focus:ring-1 focus:ring-neutral-500'>
                <div className='absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-neutral-700' />
                <div className='absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-neutral-400' style={{ width: `${ratio * 100}%` }} />
                <div
                    className='absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-400 bg-neutral-200'
                    style={{ left: `${ratio * 100}%` }}
                />
            </div>
        </div>
    )
}
