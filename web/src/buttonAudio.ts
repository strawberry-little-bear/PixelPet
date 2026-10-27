// Optional key/bite feedback must never block gameplay, reject into the page,
// or replay old events after the browser grants audio permission later.
export class ButtonAudio {
  private context: AudioContext | null = null;
  private resuming: { context: AudioContext; promise: Promise<void> } | null = null;
  private enabled = false;
  private suspendRequested = false;
  private epoch = 0;
  private notes = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  cancel() {
    this.epoch++;
    for (const note of this.notes) {
      try { note.oscillator.stop(); } catch { /* Already ended. */ }
      this.release(note);
    }
  }

  // Background pages should not keep an unlocked context running. The next
  // user key may resume it through play(); no automatic resume is attempted.
  suspend() {
    this.cancel();
    this.suspendRequested = true;
    const context = this.context;
    if (!context || context.state === "closed" || context.state === "suspended") return;
    this.pauseContext(context);
  }

  private pauseContext(context: AudioContext) {
    try { void context.suspend().catch(() => {}); }
    catch { /* Audio is optional and browser lifecycle is outside gameplay. */ }
  }

  private release(note: { oscillator: OscillatorNode; gain: GainNode }) {
    this.notes.delete(note);
    try { note.oscillator.disconnect(); } catch { /* Audio is optional. */ }
    try { note.gain.disconnect(); } catch { /* Audio is optional. */ }
  }

  async play(confirm = false): Promise<void> {
    if (!this.enabled || document.hidden) return;
    this.suspendRequested = false;
    const epoch = ++this.epoch;
    const pressedAt = performance.now();
    try {
      if (!this.context || this.context.state === "closed") this.context = new AudioContext();
      const context = this.context;
      if (context.state !== "running") {
        const attempt = this.resuming?.context === context ? this.resuming : { context, promise: context.resume() };
        this.resuming = attempt;
        try { await attempt.promise; }
        finally { if (this.resuming === attempt) this.resuming = null; }
      }
      if (this.suspendRequested) {
        if (this.context === context && context.state === "running") this.pauseContext(context);
        return;
      }
      if (!this.enabled || document.hidden || epoch !== this.epoch || performance.now() - pressedAt > 250 || this.context !== context || context.state !== "running") return;
      this.tone(context, confirm ? 740 : 520, 0.045, 0.09, 0.1);
    } catch { /* Missing, blocked or interrupted audio must not affect a key. */ }
  }

  // Automatic game feedback may use an already-unlocked context only. Never
  // create/resume one or retain a promise that could announce an old bite.
  bite() {
    if (!this.enabled || document.hidden || this.context?.state !== "running") return;
    this.tone(this.context, 1040, 0.03, 0.12, 0.14);
  }

  private tone(context: AudioContext, frequency: number, volume: number, fade: number, duration: number) {
    try {
      const oscillator = context.createOscillator();
      let gain: GainNode;
      try { gain = context.createGain(); }
      catch {
        try { oscillator.disconnect(); } catch { /* Audio is optional. */ }
        return;
      }
      const note = { oscillator, gain };
      this.notes.add(note);
      oscillator.onended = () => this.release(note);
      try {
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(volume, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + fade);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration);
      } catch {
        try { oscillator.stop(); } catch { /* May not have started. */ }
        this.release(note);
      }
    } catch { /* Optional audio never changes gameplay. */ }
  }

  dispose() {
    this.setEnabled(false);
    this.suspendRequested = false;
    const context = this.context;
    this.context = null;
    this.resuming = null;
    try {
      if (context && context.state !== "closed") void context.close().catch(() => {});
    } catch { /* Some environments cannot close a context. */ }
  }
}
