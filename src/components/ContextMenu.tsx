import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useEffect, useRef, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { confirmAndTrash } from '../lib/trash'
import { useContextMenu } from '../store/contextMenu'
import { useEditClipboard } from '../store/editClipboard'
import { useEditStore } from '../store/editStore'
import { LABELS, useOrganize } from '../store/organize'
import { usePlaylist } from '../store/playlist'
import { useToast } from '../store/toast'

const RATINGS = [0, 1, 2, 3, 4, 5]

type MenuItemProps = { onClick: () => void; shortcut?: string; danger?: boolean; disabled?: boolean; children: ReactNode }

const MenuItem: FC<MenuItemProps> = ({ onClick, shortcut, danger, disabled, children }) => (
    <button
        type='button'
        disabled={disabled}
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-6 px-3 py-1 text-left ${disabled ? 'cursor-default text-neutral-600' : danger ? 'text-red-400 hover:bg-red-500/15' : 'hover:bg-neutral-800'}`}>
        <span>{children}</span>
        {shortcut && <span className='text-[10px] text-neutral-500'>{shortcut}</span>}
    </button>
)

export const ContextMenu: FC = () => {
    const menuRef = useRef<HTMLDivElement | null>(null)

    const open = useContextMenu((state) => state.open)
    const x = useContextMenu((state) => state.x)
    const y = useContextMenu((state) => state.y)
    const imageIds = useContextMenu((state) => state.imageIds)
    const hasClip = useEditClipboard((state) => state.clip !== null)

    const [pos, setPos] = useState({ x, y })
    const [sub, setSub] = useState<'rating' | 'label' | null>(null)

    const close = () => useContextMenu.getState().close()
    const primary = imageIds[0]
    const entry = usePlaylist.getState().entries.find((item) => item.imageId === primary)

    const run = (action: () => void) => {
        action()
        close()
    }

    const copyPath = () => {
        if (entry)
            navigator.clipboard
                .writeText(entry.path)
                .then(() => useToast.getState().show('경로 복사됨'))
                .catch(() => undefined)
    }
    const reveal = () => {
        if (entry) revealItemInDir(entry.path).catch(() => undefined)
    }
    const copyEdit = () => {
        const state = useEditStore.getState().state
        if (state) {
            useEditClipboard.getState().copy(state)
            useToast.getState().show('편집 설정 복사됨')
        }
    }
    const pasteEdit = () => useEditClipboard.getState().paste()
    const trash = () => {
        close()
        confirmAndTrash(imageIds)
    }

    useEffect(() => {
        if (!open) return
        const element = menuRef.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        const nextX = x + rect.width > window.innerWidth ? Math.max(4, window.innerWidth - rect.width - 4) : x
        const nextY = y + rect.height > window.innerHeight ? Math.max(4, window.innerHeight - rect.height - 4) : y
        setPos({ x: nextX, y: nextY })
    }, [open, x, y])

    useEffect(() => {
        if (!open) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close()
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [open])

    if (!open || imageIds.length === 0) return null

    return (
        <div className='fixed inset-0 z-50' onPointerDown={close} onContextMenu={(event) => (event.preventDefault(), close())}>
            <div
                ref={menuRef}
                style={{ position: 'fixed', left: pos.x, top: pos.y }}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
                className='min-w-[220px] rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-xl'>
                {imageIds.length > 1 && (
                    <div className='px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{imageIds.length}개 선택 적용</div>
                )}
                <MenuItem onClick={() => run(copyPath)} shortcut='⌘⇧⌥C'>
                    경로 복사
                </MenuItem>
                <MenuItem onClick={() => run(reveal)} shortcut='⌘⇧R'>
                    Finder에서 보기
                </MenuItem>
                <div className='my-1 border-t border-neutral-800' />
                <MenuItem onClick={() => run(copyEdit)} shortcut='⌘⇧C'>
                    편집 설정 복사
                </MenuItem>
                <MenuItem onClick={() => run(pasteEdit)} shortcut='⌘⇧V' disabled={!hasClip}>
                    편집 설정 붙여넣기
                </MenuItem>
                <MenuItem onClick={() => run(() => useEditStore.getState().resetAll())} shortcut='⌘R'>
                    편집 초기화
                </MenuItem>
                <div className='my-1 border-t border-neutral-800' />
                <div className='relative' onMouseEnter={() => setSub('rating')} onMouseLeave={() => setSub(null)}>
                    <div className='flex items-center justify-between px-3 py-1 hover:bg-neutral-800'>
                        <span>별점</span>
                        <span className='text-[10px] text-neutral-500'>▸</span>
                    </div>
                    {sub === 'rating' && (
                        <div className='absolute left-full top-0 -ml-1 min-w-[120px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl'>
                            {RATINGS.map((value) => (
                                <MenuItem key={value} onClick={() => run(() => useOrganize.getState().setRating(imageIds, value))}>
                                    {value === 0 ? '없음' : '★'.repeat(value)}
                                </MenuItem>
                            ))}
                        </div>
                    )}
                </div>
                <div className='relative' onMouseEnter={() => setSub('label')} onMouseLeave={() => setSub(null)}>
                    <div className='flex items-center justify-between px-3 py-1 hover:bg-neutral-800'>
                        <span>컬러 라벨</span>
                        <span className='text-[10px] text-neutral-500'>▸</span>
                    </div>
                    {sub === 'label' && (
                        <div className='absolute left-full top-0 -ml-1 min-w-[140px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl'>
                            <MenuItem onClick={() => run(() => useOrganize.getState().setLabel(imageIds, null))}>없음</MenuItem>
                            {LABELS.map((entry) => (
                                <button
                                    key={entry.name}
                                    type='button'
                                    onClick={() => run(() => useOrganize.getState().setLabel(imageIds, entry.name))}
                                    className='flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-neutral-800'>
                                    <span className='h-3 w-3 rounded-full' style={{ backgroundColor: entry.color }} />
                                    {entry.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <MenuItem onClick={() => run(() => useOrganize.getState().setFlag(imageIds, 'pick'))} shortcut='P'>
                    ⚑ 플래그 지정
                </MenuItem>
                <MenuItem onClick={() => run(() => useOrganize.getState().setFlag(imageIds, 'reject'))} shortcut='X'>
                    ⚐ 제외 표시
                </MenuItem>
                <MenuItem onClick={() => run(() => useOrganize.getState().setFlag(imageIds, null))} shortcut='U'>
                    플래그 해제
                </MenuItem>
                <div className='my-1 border-t border-neutral-800' />
                <MenuItem onClick={trash} shortcut='⌫' danger>
                    휴지통으로 이동
                </MenuItem>
            </div>
        </div>
    )
}
