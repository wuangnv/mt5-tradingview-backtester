export const REPLAY_IDLE_MS = 120_000
export const REPLAY_ACTIVITY_FLUSH_MS = 10_000

// Monotonic elapsed time prevents clock changes and suspended tabs from adding hours.
export class ReplayActivityClock {
  constructor(monotonic, wall, eligible) {
    this.last = monotonic
    this.wall = wall
    this.lastActivity = monotonic
    this.eligible = eligible
  }

  sample(monotonic, wall) {
    const gap = monotonic - this.last
    const end = Math.min(monotonic, this.lastActivity + REPLAY_IDLE_MS)
    const elapsed = end - this.last
    const valid = this.eligible && gap > 0 && gap <= 30_000 && elapsed > 0
      && Math.abs(wall - this.wall - gap) < 5_000
    const segment = valid ? { start: wall - (monotonic - end) - elapsed, end: wall - (monotonic - end) } : null
    this.last = monotonic
    this.wall = wall
    return segment
  }

  touch(monotonic) { this.lastActivity = monotonic }
  setEligible(eligible) { this.eligible = eligible }
}

export function appendActivitySegment(segments, segment) {
  if (!segment) return
  const previous = segments.at(-1)
  if (previous && Math.abs(previous.end - segment.start) < 2 && segment.end - previous.start <= 30_000) previous.end = segment.end
  else segments.push(segment)
}
