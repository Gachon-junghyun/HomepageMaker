import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../shared/types'

/**
 * 앱 설정 한 파일. userData 아래 settings.json.
 * 🔴 BOM 없는 UTF-8 로만 쓴다 — PowerShell 로 이 파일을 건드리지 마라 (DeGaJa 헌법과 같은 지뢰).
 */
export interface Settings {
  recent: Project[]
  sitesDir: string
  claude: { allowBash: boolean; model?: string }
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

const defaults = (): Settings => ({
  recent: [],
  sitesDir: join(app.getPath('home'), 'HOMEPAGE_MAKER', 'sites'),
  claude: { allowBash: false },
})

export function readSettings(): Settings {
  try {
    if (!existsSync(file())) return defaults()
    const raw = readFileSync(file(), 'utf-8').replace(/^﻿/, '')
    return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    return defaults()
  }
}

export function writeSettings(s: Settings): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify(s, null, 2), { encoding: 'utf-8' })
}

export function touchRecent(p: Project): Project[] {
  const s = readSettings()
  s.recent = [p, ...s.recent.filter((r) => r.dir.toLowerCase() !== p.dir.toLowerCase())].slice(0, 12)
  writeSettings(s)
  return s.recent
}

export function forgetRecent(dir: string): Project[] {
  const s = readSettings()
  s.recent = s.recent.filter((r) => r.dir.toLowerCase() !== dir.toLowerCase())
  writeSettings(s)
  return s.recent
}
