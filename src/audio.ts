export class RangeAudio {
  enabled = true;
  private context?: AudioContext;
  private ambient?: AudioBufferSourceNode;

  unlock() {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
    if (!this.ambient) {
      const buffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 3,
        this.context.sampleRate,
      );
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.015) / 1.015;
        data[i] = last;
      }
      this.ambient = this.context.createBufferSource();
      this.ambient.buffer = buffer;
      this.ambient.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 600;
      const gain = this.context.createGain();
      gain.gain.value = 0.055;
      this.ambient.connect(filter);
      filter.connect(gain);
      gain.connect(this.context.destination);
      this.ambient.start();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.context)
      void (enabled ? this.context.resume() : this.context.suspend());
  }

  play(kind: "hit" | "score" | "pickup" | "unload") {
    if (!this.enabled || !this.context) return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const frequency =
      kind === "hit"
        ? 260
        : kind === "score"
          ? 660
          : kind === "pickup"
            ? 800
            : 420;
    oscillator.type = kind === "hit" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "hit" ? 55 : frequency * 1.5,
      now + 0.1,
    );
    gain.gain.setValueAtTime(kind === "hit" ? 0.18 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
  }
}
