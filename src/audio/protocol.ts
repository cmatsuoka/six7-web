/**
 * The messages between the engine (main thread) and the worklet (audio
 * thread), and the shape of the engine's own data.
 *
 * The engine speaks standard DX7 voice dumps: 156 unpacked bytes. The host
 * owns the bank, the selected program and the display strings.
 */

/** The DX7 personality (engine 0 in the library). */
export const ENGINE_DX7 = 0;

/** The DX7S personality (engine 1 in the library). */
export const ENGINE_DX7S = 1;

export type EngineType = typeof ENGINE_DX7 | typeof ENGINE_DX7S;

/** The engine's voice dump size, in bytes. */
export const VOICE_DUMP_SIZE = 156;

/** The offset of the ten-byte patch name inside the voice dump. */
export const VOICE_NAME_OFFSET = 145;

/** The length of the patch name field. */
export const VOICE_NAME_LENGTH = 10;

/** The algorithm in the voice dump's global block, 0..31. */
export const VOICE_ALGORITHM_OFFSET = 134;

/** The LFO parameters in the voice dump's global block. */
export const VOICE_LFO_SPEED_OFFSET = 137;
export const VOICE_LFO_DELAY_OFFSET = 138;
export const VOICE_LFO_PMD_OFFSET = 139;
export const VOICE_LFO_AMD_OFFSET = 140;
export const VOICE_LFO_WAVE_OFFSET = 142;

/** How many voices a canonical 32-voice bank holds. */
export const BANK_VOICE_COUNT = 32;

/** The controller sources of the engine, in its own order. */
export const CTRL_MOD_WHEEL = 0;
export const CTRL_FOOT = 1;
export const CTRL_BREATH = 2;
export const CTRL_AFTERTOUCH = 3;
export type CtrlSource = 0 | 1 | 2 | 3;

/** The routing flags of a controller. */
export const ASSIGN_PITCH = 0x1;
export const ASSIGN_AMP = 0x2;
export const ASSIGN_EG = 0x4;

/** The DX7S LFO distribution, from the additional voice data. */
export const LFO_SINGLE = 0;
export const LFO_MULTI = 1;

/** The DX7S voice modes, from the additional voice data. */
export const KEY_POLY = 0;
export const KEY_MONO = 1;
export const KEY_UNISON_POLY = 2;
export const KEY_UNISON_MONO = 3;

/** The DX7S pitch-EG ranges, in the additional voice data's encoding. */
export const PEG_RANGE_8_OCTAVES = 0;
export const PEG_RANGE_2_OCTAVES = 1;
export const PEG_RANGE_1_OCTAVE = 2;
export const PEG_RANGE_HALF_OCTAVE = 3;

/**
 * The DX7S parameters that the additional voice data carries and that the
 * 156-byte dump does not hold.
 */
export interface VoiceExtensions {
  readonly keyMode: number;
  readonly unisonDetune: number;
  readonly pegRange: number;
  readonly pegVelocity: number;
  readonly pegRateScaling: number;
  readonly lfoMode: number;
}

export function neutralExtensions(): VoiceExtensions {
  return {
    keyMode: KEY_POLY,
    unisonDetune: 0,
    pegRange: PEG_RANGE_8_OCTAVES,
    pegVelocity: 0,
    pegRateScaling: 0,
    lfoMode: LFO_SINGLE,
  };
}

/** The commands the main thread sends to the worklet. */
export type EngineCommand =
  /** Replace the live voice with a 156-byte dump and its extensions. */
  | { type: 'voice'; data: Uint8Array; extensions?: VoiceExtensions }
  /** Start a note. Velocity is 0..127. */
  | { type: 'noteOn'; note: number; velocity: number }
  /** Release a note. */
  | { type: 'noteOff'; note: number }
  /** Release every held note. */
  | { type: 'allNotesOff' }
  /** Set the host output gain, Q16: 0 is silence, 65536 is unity. */
  | { type: 'outputGain'; gainQ16: number }
  /** Normalize the DX7S output gain to the DX7 Mk1's level. */
  | { type: 'digitalOutputGain'; normalize: boolean }
  /** Set a controller's value, 0..127. */
  | { type: 'ctrl'; source: CtrlSource; value: number }
  /** Set a controller's range, 0..99. */
  | { type: 'ctrlRange'; source: CtrlSource; range: number }
  /** Set a controller's routing flags. */
  | { type: 'ctrlAssign'; source: CtrlSource; flags: number }
  /** Hold or release the sustain pedal. */
  | { type: 'sustain'; on: boolean }
  /** Set pitch bend, 14-bit, 8192 is centred. */
  | { type: 'bend'; value: number }
  /** Set the global bend range in semitones and the bend step, 0..15. */
  | { type: 'bendRange'; range: number; step: number }
  /** Set the master tune in Q16 cents. */
  | { type: 'tune'; centsQ16: number }
  /** Restore the engine defaults. */
  | { type: 'reset' }
  /** Switch the engine personality. */
  | { type: 'setEngine'; engineType: EngineType };

/** The events the worklet sends back. */
export type EngineEvent =
  | {
      type: 'ready';
      /** The linked library version, packed as 0x00MMmmpp. */
      version: number;
      /** The engine's voice dump size, 156 for the DX7. */
      dumpSize: number;
      /** The personality that was created (0 = DX7, 1 = DX7S). */
      engineType: EngineType;
    }
  | { type: 'error'; message: string };

/** Format a packed library version as `major.minor.patch`. */
export function formatVersion(version: number): string {
  const major = (version >> 16) & 0xff;
  const minor = (version >> 8) & 0xff;
  const patch = version & 0xff;
  return `${major}.${minor}.${patch}`;
}

/** Format an engine type as a human-readable name. */
export function formatEngineType(engineType: EngineType): string {
  return engineType === ENGINE_DX7S ? 'DX7S' : 'DX7';
}
