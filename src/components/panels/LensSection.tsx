import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { listLensProfiles, setLensOverride } from '../../ipc/lens'
import { useEditStore } from '../../store/editStore'
import { useLens } from '../../store/lens'
import { useMeta } from '../../store/meta'
import { useToast } from '../../store/toast'
import type { LensProfileSummary } from '../../types/LensProfileSummary'
import { Section } from './Section'
import { Slider } from './Slider'

const LENS_SEARCH_DEBOUNCE_MS = 250

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)
const percent = (value: number) => `${value}%`

const lensKeyOf = (make: string | null, model: string | null) => {
    const trimmedModel = model?.trim()
    if (!trimmedModel) return null
    return `${(make ?? '').trim().toLowerCase()}|${trimmedModel.toLowerCase()}`
}

type StrengthKey = 'distortion' | 'tca' | 'vignette'
type ManualKey = 'manualDistortion' | 'manualVignette'

export const LensSection: FC = () => {
    const { t } = useTranslation()
    const lens = useEditStore((state) => state.state?.lens)
    const edit = useEditStore((state) => state.edit)
    const match = useLens((state) => state.match)
    const loading = useLens((state) => state.loading)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<{ query: string; list: LensProfileSummary[] }>({ query: '', list: [] })

    const trimmedQuery = query.trim()
    const visibleResults = trimmedQuery.length > 0 && results.query === trimmedQuery ? results.list : []

    useEffect(() => {
        if (trimmedQuery.length === 0) return
        let alive = true
        const timer = setTimeout(() => {
            listLensProfiles(trimmedQuery)
                .then((list) => alive && setResults({ query: trimmedQuery, list }))
                .catch(() => alive && setResults({ query: trimmedQuery, list: [] }))
        }, LENS_SEARCH_DEBOUNCE_MS)
        return () => {
            alive = false
            clearTimeout(timer)
        }
    }, [trimmedQuery])

    if (!lens) return null

    const setStrength = (key: StrengthKey, value: number, label: string) =>
        edit((draft) => void (draft.lens[key] = value), { coalesceKey: `lens.${key}`, label })

    const setManual = (key: ManualKey, value: number, label: string) =>
        edit((draft) => void (draft.lens[key] = value), { coalesceKey: `lens.${key}`, label })

    const applyProfile = async (profile: LensProfileSummary) => {
        const lensMeta = useMeta.getState().metadata?.lens
        const key = lensKeyOf(lensMeta?.make ?? null, lensMeta?.model ?? null)
        if (!key) {
            useToast.getState().show(t('toast.lensNoInfo'))
            return
        }
        try {
            await setLensOverride(key, profile.id)
            edit((draft) => void (draft.lens.profileId = profile.id), { label: t('history.lensProfile') })
            await useLens.getState().refreshCurrent()
            setQuery('')
            setResults({ query: '', list: [] })
            useToast.getState().show(t('toast.lensRemembered', { name: profile.name }))
        } catch {
            useToast.getState().show(t('toast.lensNoInfo'))
        }
    }

    const strengthItem = (key: StrengthKey, label: string) => (
        <div className='flex flex-col gap-1'>
            <label className='flex items-center gap-1.5 text-xs text-neutral-300'>
                <input
                    type='checkbox'
                    checked={lens[key] > 0}
                    onChange={(event) => setStrength(key, event.target.checked ? 100 : 0, label)}
                    className='accent-neutral-400'
                />
                {label}
            </label>
            <Slider
                label={t('panel.lens.strength')}
                value={lens[key]}
                min={0}
                max={200}
                step={1}
                defaultValue={100}
                coalesceKey={`lens.${key}`}
                disabled={lens[key] === 0}
                format={percent}
                onChange={(value) => setStrength(key, value, label)}
            />
        </div>
    )

    const hasProfile = lens.autoProfile && match !== null

    return (
        <Section id='lens' title={t('panel.lens.title')}>
            <label className='flex items-center gap-1.5 text-xs text-neutral-300'>
                <input
                    type='checkbox'
                    checked={lens.autoProfile}
                    onChange={(event) => edit((draft) => void (draft.lens.autoProfile = event.target.checked), { label: t('panel.lens.auto') })}
                    className='accent-neutral-400'
                />
                {t('panel.lens.auto')}
            </label>

            {lens.autoProfile &&
                (loading ? (
                    <p className='text-[11px] text-neutral-500'>{t('panel.lens.searching')}</p>
                ) : match ? (
                    <p className='truncate text-[11px] text-emerald-400' title={match.lensName}>
                        ✓ {match.lensName}
                    </p>
                ) : (
                    <p className='text-[11px] text-amber-400'>{t('panel.lens.noMatch')}</p>
                ))}

            {hasProfile && (
                <>
                    {strengthItem('distortion', t('panel.lens.distortion'))}
                    {strengthItem('tca', t('panel.lens.tca'))}
                    {strengthItem('vignette', t('panel.lens.vignette'))}
                </>
            )}

            {lens.autoProfile && !match && !loading && (
                <div className='flex flex-col gap-1'>
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('panel.lens.searchPlaceholder')}
                        className='w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
                    />
                    {visibleResults.length > 0 && (
                        <div className='max-h-40 overflow-y-auto rounded border border-neutral-800 bg-neutral-950/60'>
                            {visibleResults.map((profile) => (
                                <button
                                    key={profile.id}
                                    type='button'
                                    onClick={() => applyProfile(profile)}
                                    className='block w-full truncate px-2 py-1 text-left text-[11px] text-neutral-300 hover:bg-neutral-800'>
                                    {profile.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!hasProfile && (
                <>
                    <Slider
                        label={t('panel.lens.manualDistortion')}
                        value={lens.manualDistortion}
                        min={-100}
                        max={100}
                        step={1}
                        defaultValue={0}
                        coalesceKey='lens.manualDistortion'
                        format={signed}
                        onChange={(value) => setManual('manualDistortion', value, t('panel.lens.manualDistortion'))}
                    />
                    <Slider
                        label={t('panel.lens.manualVignette')}
                        value={lens.manualVignette}
                        min={-100}
                        max={100}
                        step={1}
                        defaultValue={0}
                        coalesceKey='lens.manualVignette'
                        format={signed}
                        onChange={(value) => setManual('manualVignette', value, t('panel.lens.manualVignette'))}
                    />
                </>
            )}
        </Section>
    )
}
