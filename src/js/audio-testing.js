export class SyntheticAudioTester {
  constructor() {
    this.audioContext = null;
    this.oscillator = null;
    this.streamDestination = null;
  }

  createSyntheticAudioStream() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass();
    this.streamDestination = this.audioContext.createMediaStreamDestination();

    // Create a 1kHz pulse oscillator for latency and signal quality testing
    this.oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    this.oscillator.type = 'sine';
    this.oscillator.frequency.setValueAtTime(1000, this.audioContext.currentTime); // 1 kHz tone

    // Modulate gain to produce clear 100ms pulses every 1 second
    const now = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);

    this.oscillator.connect(gainNode);
    gainNode.connect(this.streamDestination);
    this.oscillator.start();

    // Periodic 100ms audio pulse
    this.pulseInterval = setInterval(() => {
      if (this.audioContext && this.audioContext.state === 'running') {
        const t = this.audioContext.currentTime;
        gainNode.gain.setValueAtTime(0.5, t);
        gainNode.gain.setValueAtTime(0, t + 0.1);
      }
    }, 1000);

    return this.streamDestination.stream;
  }

  stop() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    if (this.oscillator) {
      this.oscillator.stop();
      this.oscillator.disconnect();
      this.oscillator = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
