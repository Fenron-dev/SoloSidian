export interface AudioCue { id: string; label: string; path?: string; volume: number; enabled: boolean; }

export class AudioLibrary {
  private readonly cues = new Map<string, AudioCue>();

  register(cue: AudioCue): void {
    if (!cue.id.trim()) throw new Error("Audio-Cue braucht eine ID.");
    if (cue.volume < 0 || cue.volume > 1) throw new Error("Audio-Lautstärke muss zwischen 0 und 1 liegen.");
    this.cues.set(cue.id, { ...cue });
  }

  get(id: string): AudioCue | undefined { return this.cues.get(id); }
  list(): AudioCue[] { return [...this.cues.values()].map((cue) => ({ ...cue })); }
}
