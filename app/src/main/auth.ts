import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * `claude` CLI 가 «무엇으로» 인증하는지 — 돈이 나가는지 아닌지가 여기서 갈린다.
 *
 * 🔴 왜 필요한가 (2026-09-12, 사람이 놀라서 물었다):
 *    stream-json 의 `total_cost_usd` 는 **토큰을 API 정가로 환산한 값**이라, 구독으로 쓰는 중에도 «$1.413» 이 찍힌다.
 *    화면이 그 숫자만 보여주면 **「돈이 나갔다」로 읽힌다** — 실제로 그렇게 읽혔다.
 *    그래서 인증 방식을 같이 표시한다. 「그럴듯하게 채워진 틀린 값은 빈 칸보다 비싸다」의 실제 사례다.
 *
 * 판단 순서는 CLI·SDK 의 자격 증명 해석 순서와 같다: 환경변수 키가 있으면 그게 이긴다.
 * ⚠️ **여기서 토큰 값을 읽지 않는다.** 있는지 여부와 `subscriptionType` 만 본다.
 */
export interface AuthInfo {
  /** api = API 키로 간다(실제 청구) · subscription = 구독 OAuth(구독 한도에서 차감) · unknown = 못 알아냄 */
  mode: 'api' | 'subscription' | 'unknown'
  /** 구독일 때 'max' | 'pro' 등 */
  plan?: string
  /** 사람에게 보여줄 한 줄 */
  note: string
}

export function authInfo(): AuthInfo {
  if (process.env.ANTHROPIC_API_KEY) return { mode: 'api', note: 'ANTHROPIC_API_KEY 로 간다 — API 크레딧에서 실제로 청구된다' }
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { mode: 'api', note: 'ANTHROPIC_AUTH_TOKEN 으로 간다 — 그 토큰의 청구 주체를 확인하라' }
  try {
    const f = join(homedir(), '.claude', '.credentials.json')
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, 'utf-8').replace(/^﻿/, ''))
      const oauth = j?.claudeAiOauth
      if (oauth) {
        const plan = typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : undefined
        return { mode: 'subscription', plan, note: `구독(${plan ?? '?'})으로 간다 — 아래 금액은 토큰을 API 정가로 «환산»한 값이지 청구가 아니다` }
      }
    }
  } catch { /* 못 읽으면 unknown */ }
  return { mode: 'unknown', note: '인증 방식을 못 알아냈다 — 금액이 청구인지 환산인지 확인 못 함' }
}
