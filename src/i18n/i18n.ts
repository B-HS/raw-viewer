import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { ko } from './ko'

export type AppLanguage = 'system' | 'ko' | 'en'

export type UiLanguage = 'ko' | 'en'

export const resolveLanguage = (language: AppLanguage) => {
    if (language === 'ko' || language === 'en') return language
    return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: resolveLanguage('system'),
    fallbackLng: 'ko',
    interpolation: { escapeValue: false },
    returnNull: false,
})

export const applyLanguage = (language: AppLanguage) => {
    const resolved = resolveLanguage(language)
    if (i18n.language !== resolved) i18n.changeLanguage(resolved)
}

export { i18n }
