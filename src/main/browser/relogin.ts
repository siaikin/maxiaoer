import type { Account } from '../../shared/types'
import type { AccountProfile } from '../platforms/types'

export class IdentityMismatchError extends Error {
  constructor() {
    super('登录身份与原账号不一致，请使用原来的账号重新登录')
    this.name = 'IdentityMismatchError'
  }
}

export class IdentityUnconfirmedError extends Error {
  constructor() {
    super('无法确认登录身份')
    this.name = 'IdentityUnconfirmedError'
  }
}

/** 重新登录沿用原来的账号 id。身份对不上时不改记录。 */
export function mergeRelogin(account: Account, profile: AccountProfile): Account {
  if (account.uid && profile.uid && account.uid !== profile.uid) throw new IdentityMismatchError()
  if (account.uid && !profile.uid) throw new IdentityUnconfirmedError()
  return {
    ...account,
    nickname: profile.nickname,
    avatar: profile.avatar,
    uid: profile.uid ?? account.uid,
    status: 'active',
    checkedAt: Date.now(),
  }
}
