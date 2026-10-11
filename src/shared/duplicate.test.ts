import { describe, expect, it } from 'vitest'
import { findPublishedDuplicate } from './duplicate'
import type { PublishJob, PublishTask } from './types'

const task = (accountId: string, status: PublishTask['status']): PublishTask => ({ id: `${accountId}-${status}`, accountId, platform: 'weibo', status })
const job = (id: string, title: string, tasks: PublishTask[]): PublishJob => ({ id, postId: id, title, tasks, createdAt: 0 })

describe('findPublishedDuplicate', () => {
  it('finds a successful post with the same title on the same account', () => {
    const jobs = [job('new', ' 春游 ', [task('a', 'pending'), task('b', 'pending')]), job('old', '春游', [task('a', 'success'), task('b', 'failed')])]
    expect(findPublishedDuplicate(jobs, 'new', 'a')?.job.id).toBe('old')
    expect(findPublishedDuplicate(jobs, 'new', 'b')).toBeUndefined()
  })

  it('ignores deleted posts, other titles and the job itself', () => {
    const jobs = [
      job('new', '春游', [task('a', 'success')]),
      job('deleted', '春游', [task('a', 'deleted')]),
      job('other', '秋游', [task('a', 'success')]),
    ]
    expect(findPublishedDuplicate(jobs, 'new', 'a')).toBeUndefined()
  })

  it('does not check posts without a title', () => {
    const jobs = [job('new', '', [task('a', 'pending')]), job('old', '', [task('a', 'success')])]
    expect(findPublishedDuplicate(jobs, 'new', 'a')).toBeUndefined()
  })
})
