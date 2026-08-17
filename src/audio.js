// Original 1.8.8 sound effects decoded through WebAudio.  Short sounds are
// AudioBufferSourceNode based (low latency + MC-style random pitch), music is
// streamed through <audio> elements.
const SOUND_BASE = new URL('../assets/sounds/', import.meta.url).href;

const GROUPS = {
  dig_grass: ['dig/grass1.ogg', 'dig/grass2.ogg', 'dig/grass3.ogg', 'dig/grass4.ogg'],
  dig_stone: ['dig/stone1.ogg', 'dig/stone2.ogg', 'dig/stone3.ogg', 'dig/stone4.ogg'],
  dig_wood: ['dig/wood1.ogg', 'dig/wood2.ogg', 'dig/wood3.ogg', 'dig/wood4.ogg'],
  dig_sand: ['dig/sand1.ogg', 'dig/sand2.ogg', 'dig/sand3.ogg', 'dig/sand4.ogg'],
  dig_gravel: ['dig/gravel1.ogg', 'dig/gravel2.ogg', 'dig/gravel3.ogg', 'dig/gravel4.ogg'],
  dig_cloth: ['dig/cloth1.ogg', 'dig/cloth2.ogg', 'dig/cloth3.ogg', 'dig/cloth4.ogg'],
  dig_snow: ['dig/snow1.ogg', 'dig/snow2.ogg', 'dig/snow3.ogg', 'dig/snow4.ogg'],
  dig_glass: ['random/glass1.ogg', 'random/glass2.ogg', 'random/glass3.ogg'],
  step_grass: ['step/grass1.ogg', 'step/grass2.ogg', 'step/grass3.ogg', 'step/grass4.ogg', 'step/grass5.ogg', 'step/grass6.ogg'],
  step_stone: ['step/stone1.ogg', 'step/stone2.ogg', 'step/stone3.ogg', 'step/stone4.ogg', 'step/stone5.ogg', 'step/stone6.ogg'],
  step_wood: ['step/wood1.ogg', 'step/wood2.ogg', 'step/wood3.ogg', 'step/wood4.ogg', 'step/wood5.ogg', 'step/wood6.ogg'],
  step_sand: ['step/sand1.ogg', 'step/sand2.ogg', 'step/sand3.ogg', 'step/sand4.ogg', 'step/sand5.ogg'],
  step_gravel: ['step/gravel1.ogg', 'step/gravel2.ogg', 'step/gravel3.ogg', 'step/gravel4.ogg'],
  step_snow: ['step/snow1.ogg', 'step/snow2.ogg', 'step/snow3.ogg', 'step/snow4.ogg'],
  step_cloth: ['step/cloth1.ogg', 'step/cloth2.ogg', 'step/cloth3.ogg', 'step/cloth4.ogg'],
  break: ['random/break.ogg'], click: ['random/click.ogg'], pop: ['random/pop.ogg'],
  levelup: ['random/levelup.ogg'], wood_click: ['random/wood_click.ogg'],
  hit: ['random/successful_hit.ogg'], orb: ['random/orb.ogg'],
  hurt: ['damage/hit1.ogg', 'damage/hit2.ogg', 'damage/hit3.ogg'],
  fallbig: ['damage/fallbig.ogg'], fallsmall: ['damage/fallsmall.ogg'],
  splash: ['liquid/splash.ogg', 'liquid/splash2.ogg', 'random/splash.ogg'],
  swim: ['liquid/swim1.ogg', 'liquid/swim2.ogg', 'liquid/swim3.ogg', 'liquid/swim4.ogg'],
  water: ['liquid/water.ogg'], lava: ['liquid/lava.ogg'], lavapop: ['liquid/lavapop.ogg'],
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.master = null;
    this.volume = 0.7;
    this.enabled = true;
    this.musicEnabled = true;
    this.musicEl = null;
    this.gameMusic = null;
    this.loaded = false;
    this.lastStep = 0;
    this.allowResume = false;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx && this.ctx.state === 'suspended' && this.allowResume) this.ctx.resume();
  }

  // Call from a real user gesture (click / key press).
  unlock() {
    this.allowResume = true;
    this.ensure();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  async preload(onProgress) {
    let done = 0;
    const entries = Object.entries(GROUPS);
    for (const [group, files] of entries) {
      const bufs = [];
      for (const file of files) {
        try {
          const resp = await fetch(SOUND_BASE + file);
          if (!resp.ok) throw new Error(resp.status);
          const data = await resp.arrayBuffer();
          this.ensure();
          if (this.ctx) {
            const decoded = await this.ctx.decodeAudioData(data);
            bufs.push(decoded);
          }
        } catch (e) {
          console.warn('sound load failed', file, e);
        }
        done++;
        if (onProgress) onProgress(done);
      }
      this.buffers.set(group, bufs);
    }
    this.loaded = true;
  }

  _playGroup(group, { volume = 0.7, pitch = 1, when = 0 } = {}) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const bufs = this.buffers.get(group);
    if (!bufs || bufs.length === 0) return;
    const buf = bufs[(Math.random() * bufs.length) | 0];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g); g.connect(this.master);
    src.start(when);
  }

  playGroup(group, opts) { this._playGroup(group, opts); }

  playClick() { this._playGroup('click', { volume: 0.8 }); }
  playPop() { this._playGroup('pop', { volume: 0.8, pitch: 0.9 + Math.random() * 0.2 }); }
  playHurt() { this._playGroup('hurt', { volume: 0.9 }); }

  playBreak(blockInfo) {
    if (!blockInfo) return;
    const group = blockInfo.glass ? 'dig_glass' : `dig_${blockInfo.sound}`;
    this._playGroup(group, { volume: 0.7, pitch: 0.85 + Math.random() * 0.3 });
  }

  playDig(blockInfo) {
    if (!blockInfo) return;
    const group = blockInfo.glass ? 'dig_glass' : `dig_${blockInfo.sound}`;
    this._playGroup(group, { volume: 0.7, pitch: 0.85 + Math.random() * 0.3 });
  }

  playPlace(blockInfo) {
    if (!blockInfo) return;
    // MC 1.8 plays the block's dig sound at 0.8x pitch when a block is placed.
    const group = blockInfo.glass ? 'dig_glass' : `dig_${blockInfo.sound}`;
    this._playGroup(group, { volume: 0.68, pitch: 0.8 });
  }

  playStep(blockInfo) {
    if (!blockInfo) return;
    const now = performance.now() / 1000;
    if (now - this.lastStep < 0.16) return;
    this.lastStep = now;
    this._playGroup(`step_${blockInfo.sound}`, { volume: 0.55, pitch: 0.85 + Math.random() * 0.3 });
  }

  playFall(big) {
    this._playGroup(big ? 'fallbig' : 'fallsmall', { volume: 0.8 });
  }

  playSplash() { this._playGroup('splash', { volume: 0.6 }); }
  playWater() { this._playGroup('water', { volume: 0.4, pitch: 0.9 + Math.random() * 0.2 }); }
  playSwim() { this._playGroup('swim', { volume: 0.5, pitch: 0.85 + Math.random() * 0.3 }); }
  playLavaPop() { this._playGroup('lavapop', { volume: 0.7 }); }
  playLava() { this._playGroup('lava', { volume: 0.5, pitch: 0.9 + Math.random() * 0.2 }); }

  startMenuMusic() {
    if (!this.musicEnabled || !this.musicEl) return;
    this.musicEl.loop = true;
    this.musicEl.volume = 0.35;
    this.musicEl.play().catch(() => {});
  }

  stopMenuMusic() {
    if (this.musicEl) { this.musicEl.pause(); this.musicEl.currentTime = 0; }
  }

  startGameMusicTimer() {
    if (!this.gameMusic || !this.musicEnabled || this.gameMusicTimerStarted) return;
    this.gameMusicTimerStarted = true;
    const schedule = () => {
      if (!this.musicEnabled || document.hidden) {
        this.gameMusicTimerStarted = false;
        return;
      }
      this.gameMusic.volume = 0.25;
      this.gameMusic.play().catch(() => {});
      this.gameMusic.onended = () => setTimeout(schedule, 25000 + Math.random() * 50000);
    };
    setTimeout(schedule, 8000 + Math.random() * 20000);
  }

  setMusicEnabled(v) {
    this.musicEnabled = v;
    if (!v) {
      if (this.musicEl) this.musicEl.pause();
      if (this.gameMusic) this.gameMusic.pause();
    }
  }

  createMusicElements() {
    if (!this.musicEl) {
      this.musicEl = new Audio(SOUND_BASE + 'music/menu/menu1.ogg');
      this.musicEl.preload = 'auto';
    }
    if (!this.gameMusic) {
      this.gameMusic = new Audio(SOUND_BASE + 'music/game/calm1.ogg');
      this.gameMusic.preload = 'auto';
    }
  }
}
