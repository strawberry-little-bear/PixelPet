// Experimental observation protocol. Nothing here earns a score or reward.
export const pattern = ['A', 'B', 'B', 'A', 'B', 'A', 'A', 'B', 'A', 'B', 'B', 'A'];
export const leadMs = 1800, lateMs = 1800, earlyMs = 250;
export function createSession(id) {
  return { id, status: 'paused', sequence: 0, cue: null, observations: [] };
}
export function command(session, input, now) {
  const s = structuredClone(session);
  const cue = () => {
    s.status = 'playing';
    s.cue = { sequence: ++s.sequence, key: pattern[s.observations.length], target: now + leadMs, deadline: now + leadMs + lateMs };
  };
  switch (input.kind) {
    case 'pause': s.status = s.status === 'done' ? 'done' : 'paused'; s.cue = null; break;
    case 'restart': return { ...createSession(s.id), sequence: s.sequence };
    case 'resume':
      if (s.status !== 'paused') throw new Error('先暂停，再明确继续。');
      cue(); break;
    case 'answer': {
      if (s.status !== 'playing' || !s.cue || input.sequence !== s.cue.sequence) throw new Error('旧拍已停，不接收旧输入。');
      if (!['A', 'B'].includes(input.key)) throw new Error('只接收 A / B。');
      const delta = now - s.cue.target;
      s.observations.push({ sequence: s.cue.sequence, expected: s.cue.key, key: input.key,
        directionMatches: input.key === s.cue.key, arrivalDeltaMs: delta,
        arrival: delta < -earlyMs ? 'early' : delta > lateMs ? 'late' : 'inside' });
      // Arrival is diagnostic only. In particular late packets are NOT a miss.
      if (s.observations.length === pattern.length) { s.status = 'done'; s.cue = null; }
      else cue();
      break;
    }
    default: throw new Error('未知原型操作。');
  }
  return s;
}
