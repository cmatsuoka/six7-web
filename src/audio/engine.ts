import wasmUrl from '../../build/slopsix.wasm?url';
import workletUrl from './worklet.ts?worker&url';
import {
  ASSIGN_AMP,
  ASSIGN_PITCH,
  CTRL_MOD_WHEEL,
  ENGINE_DX7,
  VOICE_DUMP_SIZE,
  type EngineCommand,
  type EngineEvent,
  type EngineType,
  type VoiceExtensions,
} from './protocol';

/**
 * The Web Audio worklet is only exposed in a secure context, and a few
 * browsers still hide it behind a flag. Check for that before the engine
 * tries to build a node, so the panel can say what is actually wrong
 * instead of failing with a bare "cannot read addModule".
 */
function workletUnavailableReason(): string | null {
  if (typeof AudioWorkletNode === 'undefined') {
    return 'this browser does not support the Web Audio worklet';
  }
  if (!window.isSecureContext) {
    return 'the Web Audio worklet needs a secure context — open the app on http://localhost:5173 or over HTTPS';
  }
  return null;
}

/**
 * The main-thread facade of the engine.
 *
 * The engine itself lives in the worklet: the C engine is not thread-safe,
 * so every call to it happens on the audio thread. This class owns the
 * AudioContext, the graph and the messages.
 */
export class Six7Engine {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private readonly pending: EngineCommand[] = [];
  private readonly readyListeners = new Set<
    (version: number, dumpSize: number, engineType: EngineType) => void
  >();
  private readonly errorListeners = new Set<(message: string) => void>();
  // A missing worklet is not something a retry can fix, so the failure is
  // latched and the engine stops trying to build a node.
  private fatal: Error | null = null;
  private readyVersion: number | null = null;
  private readyDumpSize = VOICE_DUMP_SIZE;
  private readyEngineType: EngineType = ENGINE_DX7;
  private targetEngineType: EngineType = ENGINE_DX7;

  constructor() {
    const unsupported = workletUnavailableReason();
    if (unsupported !== null) {
      this.fatal = new Error(unsupported);
    }
  }

  /** Why the engine cannot run at all, if that is the case. */
  get unavailable(): string | null {
    return this.fatal?.message ?? null;
  }

  /** The linked library version, once the worklet is up. */
  get version(): number | null {
    return this.readyVersion;
  }

  /** The engine's voice dump size, 156 for the DX7. */
  get dumpSize(): number {
    return this.readyDumpSize;
  }

  /** The currently selected personality (0 = DX7, 1 = DX7S). */
  get engineType(): EngineType {
    return this.readyEngineType;
  }

  /** Switch the engine personality, recreating the context once it exists. */
  setEngineType(engineType: EngineType): void {
    if (this.targetEngineType === engineType) {
      return;
    }
    this.targetEngineType = engineType;
    if (this.node !== null) {
      this.post({ type: 'setEngine', engineType });
      this.poke();
    }
  }

  onReady(
    listener: (version: number, dumpSize: number, engineType: EngineType) => void,
  ): () => void {
    this.readyListeners.add(listener);
    if (this.readyVersion !== null) {
      listener(this.readyVersion, this.readyDumpSize, this.readyEngineType);
    }
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /**
   * Build the audio graph while the page is loading.
   *
   * Creating the context, loading the worklet and compiling the engine
   * binary takes a moment, and none of it has to wait for the user: the
   * first press then only has to wake the context up.
   */
  async init(): Promise<void> {
    try {
      await this.ensure();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.emitError(reason.message);
    }
  }

  /** Replace the live voice with a 156-byte dump and its extensions. */
  setVoice(data: Uint8Array, extensions?: VoiceExtensions): void {
    if (data.length !== VOICE_DUMP_SIZE) {
      this.emitError(
        `the voice dump is ${data.length} bytes, expected ${VOICE_DUMP_SIZE}`,
      );
      return;
    }
    this.post({ type: 'voice', data: data.slice(), extensions });
    this.poke();
  }

  noteOn(note: number, velocity: number): void {
    this.post({
      type: 'noteOn',
      note: clampInt(note, 0, 127),
      velocity: clampInt(velocity, 0, 127),
    });
    this.poke();
  }

  noteOff(note: number): void {
    this.post({ type: 'noteOff', note: clampInt(note, 0, 127) });
  }

  allNotesOff(): void {
    this.post({ type: 'allNotesOff' });
  }

  /** Set the host output gain, Q16: 0 is silence, 65536 is unity. */
  setOutputGain(gainQ16: number): void {
    this.post({
      type: 'outputGain',
      gainQ16: clampInt(gainQ16, 0, 65536),
    });
    this.poke();
  }

  setPitchBend(value: number): void {
    this.post({ type: 'bend', value: clampInt(value, 0, 16383) });
    this.poke();
  }

  /** Set the modulation wheel, 0..127. */
  setModulation(value: number): void {
    this.post({
      type: 'ctrl',
      source: CTRL_MOD_WHEEL,
      value: clampInt(value, 0, 127),
    });
    this.poke();
  }

  /** Hold or release the sustain pedal. */
  setSustain(on: boolean): void {
    this.post({ type: 'sustain', on });
    this.poke();
  }

  /**
   * The host's controller setup: a two-semitone bend range and a mod wheel
   * routed to the LFO's pitch and amplitude modulation at full range.
   */
  configureMidiControllers(): void {
    this.setPitchBendRange(2, 0);
    this.post({ type: 'ctrlRange', source: CTRL_MOD_WHEEL, range: 99 });
    this.post({
      type: 'ctrlAssign',
      source: CTRL_MOD_WHEEL,
      flags: ASSIGN_PITCH | ASSIGN_AMP,
    });
    this.poke();
  }

  setPitchBendRange(range: number, step: number): void {
    this.post({
      type: 'bendRange',
      range: clampInt(range, 0, 12),
      step: clampInt(step, 0, 15),
    });
    this.poke();
  }

  setMasterTune(centsQ16: number): void {
    this.post({ type: 'tune', centsQ16: Math.round(centsQ16) });
    this.poke();
  }

  reset(): void {
    this.post({ type: 'reset' });
    this.poke();
  }

  /**
   * Bring the audio graph up: build it if it is not built yet, and resume
   * the context. A user gesture may bring a suspended context back to
   * life, so the panel calls this on the first gesture.
   */
  async wake(): Promise<void> {
    try {
      await this.ensure();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.emitError(reason.message);
      return;
    }
    await this.resumeContext();
  }

  async dispose(): Promise<void> {
    this.node?.disconnect();
    this.node = null;
    const context = this.context;
    this.context = null;
    if (context !== null) {
      await context.close();
    }
  }

  private async ensure(): Promise<void> {
    if (this.fatal !== null) {
      throw this.fatal;
    }

    if (this.node !== null) {
      return;
    }

    if (this.starting !== null) {
      return this.starting;
    }

    this.starting = this.createNode();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async createNode(): Promise<void> {
    const unsupported = workletUnavailableReason();
    if (unsupported !== null) {
      this.fatal = new Error(unsupported);
      throw this.fatal;
    }

    const context = new AudioContext({ latencyHint: 'interactive' });
    const worklet: AudioWorklet | undefined = context.audioWorklet;
    if (worklet === undefined) {
      await context.close();
      this.fatal = new Error(
        'this browser does not expose the Web Audio worklet',
      );
      throw this.fatal;
    }

    try {
      const [bytes] = await Promise.all([
        fetch(wasmUrl).then(async (response) => {
          if (!response.ok) {
            throw new Error(`wasm request failed (${response.status})`);
          }
          return response.arrayBuffer();
        }),
        worklet.addModule(workletUrl),
      ]);

      // The binary is compiled here, in the main thread. A worklet may not
      // compile a module while its global scope is still initialising, and
      // a compiled module can be handed over to it as it is.
      const wasmModule = await WebAssembly.compile(bytes);

      const node = this.createWorkletNode(context, wasmModule, bytes);

      node.port.onmessage = (event: MessageEvent<EngineEvent>) => {
        this.handleEvent(event.data);
      };
      node.addEventListener('processorerror', () => {
        this.emitError('the audio processor stopped unexpectedly');
      });

      node.connect(context.destination);
      this.context = context;
      this.node = node;
      for (const command of this.pending) {
        node.port.postMessage(command);
      }
      this.pending.length = 0;
      // The context starts on its own once the page has been activated. The
      // resume is not awaited: the autoplay policy may hold it back until a
      // gesture happens, and the engine has to stay usable in the meantime.
      void this.resumeContext();
    } catch (error) {
      await context.close();
      throw error;
    }
  }

 /**
    * Build the worklet node.
    *
    * The compiled module is the fast way in: the worklet only has to
    * instantiate it, and the engine is ready right away. Browsers that
    * cannot hand a compiled module over to the worklet get the bytes
    * instead, and the worklet compiles them itself.
    */
   private createWorkletNode(
     context: AudioContext,
     wasmModule: WebAssembly.Module,
     bytes: ArrayBuffer,
   ): AudioWorkletNode {
     const options: AudioWorkletNodeOptions = {
       numberOfInputs: 0,
       numberOfOutputs: 1,
       outputChannelCount: [2],
     };

     try {
       return new AudioWorkletNode(context, 'six7-processor', {
         ...options,
         processorOptions: {
           wasmModule,
           engineType: this.targetEngineType,
         },
       });
     } catch {
       return new AudioWorkletNode(context, 'six7-processor', {
         ...options,
         processorOptions: {
           wasmBinary: bytes.slice(0),
           engineType: this.targetEngineType,
         },
       });
     }
   }

  private async resumeContext(): Promise<void> {
    const context = this.context;
    if (context === null || context.state === 'running') {
      return;
    }
    try {
      await context.resume();
    } catch {
      // A closed context cannot be resumed; the engine stays silent.
    }
  }

  private post(command: EngineCommand): void {
    if (this.node !== null) {
      this.node.port.postMessage(command);
      return;
    }
    this.pending.push(command);
  }

  private poke(): void {
    void this.ensure().catch((error: unknown) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.emitError(reason.message);
    });
    // A control that is moved is a user gesture: it may bring a context
    // that the browser suspended back to life.
    void this.resumeContext();
  }

  private handleEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'ready': {
        this.readyVersion = event.version;
        this.readyDumpSize = event.dumpSize;
        this.readyEngineType = event.engineType;
        for (const listener of this.readyListeners) {
          listener(this.readyVersion, this.readyDumpSize, this.readyEngineType);
        }
        break;
      }
      case 'error': {
        this.emitError(event.message);
        break;
      }
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener(message);
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}
