import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'

export type AppLanguage = 'system' | 'ko' | 'en' | 'ja'

export type UiLanguage = 'ko' | 'en' | 'ja'

export const resolveLanguage = (language: AppLanguage): UiLanguage => {
    if (language === 'ko' || language === 'en' || language === 'ja') return language
    if (typeof navigator === 'undefined') return 'en'
    const system = navigator.language.toLowerCase()
    if (system.startsWith('ko')) return 'ko'
    if (system.startsWith('ja')) return 'ja'
    return 'en'
}

i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko }, en: { translation: en }, ja: { translation: ja } },
    lng: resolveLanguage('system'),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
})

export const applyLanguage = (language: AppLanguage) => {
    const resolved = resolveLanguage(language)
    if (i18n.language !== resolved) i18n.changeLanguage(resolved)
}

export { i18n }
