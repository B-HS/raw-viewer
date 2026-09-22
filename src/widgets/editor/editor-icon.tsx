import type { FC } from 'react'
import { EDITOR_TOOLS } from '../../shared/constants/editor'
import type { DrawerToolId } from '../../store/uiStore'

type EditorIconProps = { tool: DrawerToolId }

export const EditorIcon: FC<EditorIconProps> = ({ tool }) => (
    <svg
        viewBox='0 0 24 24'
        className='h-5 w-5 shrink-0'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'>
        <path d={EDITOR_TOOLS.find((item) => item.id === tool)?.path} />
    </svg>
)
