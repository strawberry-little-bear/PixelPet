// Optional key feedback must never block gameplay, reject into the page, or
// replay old presses after the browser grants audio permission later.
export class ButtonAudio {
  private context: AudioContext | null = null;
  private resuming: { context: AudioContext; promise: Promise<void> } | null = null;
  private enabled = false;
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

  private release(note: { oscillator: OscillatorNode; gain: GainNode }) {
    this.notes.delete(note);
    try { note.oscillator.disconnect(); } catch { /* Audio is optional. */ }
    try { note.gain.disconnect(); } catch { /* Audio is optional. */ }
  }

  async play(confirm = false): Promise<void> {
    if (!this.enabled || document.hidden) return;
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
      if (!this.enabled || document.hidden || epoch !== this.epoch || performance.now() - pressedAt > 250 || this.context !== context || context.state !== "running") return;
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
        oscillator.frequency.value = confirm ? 740 : 520;
        gain.gain.setValueAtTime(0.045, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.1);
      } catch {
        try { oscillator.stop(); } catch { /* May not have started. */ }
        this.release(note);
      }
    } catch { /* Missing, blocked or interrupted audio must not affect a key. */ }
  }

  dispose() {
    this.setEnabled(false);
    const context = this.context;
    this.context = null;
    this.resuming = null;
    try {
      if (context && context.state !== "closed") void context.close().catch(() => {});
    } catch { /* Some environments cannot close a context. */ }
  }
}
