import './worklet-env';
import createSlopsixModule, {
  type SlopsixModule,
  type SlopsixModuleOptions,
} from '../../build/slopsix.mjs';
import {
  ENGINE_DX7,
  VOICE_DUMP_SIZE,
  neutralExtensions,
  type EngineCommand,
  type EngineEvent,
  type EngineType,
  type VoiceExtensions,
} from './protocol';

const BLOCK_FRAMES = 128;

interface WorkletOptions {
  processorOptions?: {
    /**
     * The engine binary, already compiled by the main thread. It is
     * instantiated right here, and the engine is ready before the first
     * sound.
     */
    wasmModule?: WebAssembly.Module;
    /**
     * The engine binary as bytes, for the browsers that cannot hand a
     * compiled module over to the worklet. It is compiled in here, and
     * that may only happen from the first render quantum.
     */
    wasmBinary?: ArrayBuffer;
    /** The personality to create (0 = DX7, 1 = DX7S). */
    engineType?: EngineType;
  };
}

/**
 * The module object the Emscripten runtime fills in while it starts up:
 * the exports and the heap views appear on the object that was handed in.
 */
type MutableSlopsixModule = Partial<SlopsixModule> & SlopsixModuleOptions;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settingKey(command: EngineCommand): string {
  switch (command.type) {
    case 'ctrl':
    case 'ctrlRange':
    case 'ctrlAssign':
      return `${command.type}:${command.source}`;
    default:
      return command.type;
  }
}

class Six7Processor extends AudioWorkletProcessor {
  private module: SlopsixModule | null = null;
  private context = 0;
  private outPtr = 0;
  private voicePtr = 0;
  private samples: Int16Array | null = null;
  private heapBuffer: ArrayBufferLike | null = null;
  private queue: EngineCommand[] = [];
  private wasmBinary: ArrayBuffer | undefined;
  private building = false;
  private engineType: EngineType = ENGINE_DX7;
  private voice: Uint8Array | null = null;
  private extensions: VoiceExtensions = neutralExtensions();
  private readonly settings = new Map<string, EngineCommand>();

  constructor(options: WorkletOptions) {
    super(options);

    this.port.onmessage = (event: MessageEvent<EngineCommand>) => {
      const command = event.data;
      if (this.module === null) {
        this.queue.push(command);
        return;
      }
      this.handle(command);
    };

    this.engineType = options.processorOptions?.engineType ?? ENGINE_DX7;

    const wasmModule = options.processorOptions?.wasmModule;
    if (wasmModule !== undefined) {
      this.build(wasmModule);
      return;
    }

    this.wasmBinary = options.processorOptions?.wasmBinary;
  }

  override process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    const module = this.module;
    const output = outputs[0];

    if (module === null || output === undefined) {
      if (!this.building) {
        this.compile();
      }
      for (const channel of output ?? []) {
        channel.fill(0);
      }
      return true;
    }

    module._six7_process(this.context, this.outPtr, BLOCK_FRAMES);

    const left = output[0];
    const right = output[1] ?? output[0];
    const samples = this.samples;
    if (left !== undefined && right !== undefined && samples !== null) {
      for (let frame = 0; frame < BLOCK_FRAMES; frame += 1) {
        const index = frame * 2;
        left[frame] = (samples[index] ?? 0) / 32768;
        right[frame] = (samples[index + 1] ?? 0) / 32768;
      }
    }

    return true;
  }

  /**
   * Build the engine from the module the main thread compiled.
   *
   * The instance is created here and the runtime is started synchronously,
   * so the engine is ready as soon as the processor exists. A promise
   * would not do: in an AudioWorkletGlobalScope it is only settled while
   * the context renders, and the context does not render before the first
   * gesture.
   */
  private build(wasmModule: WebAssembly.Module): void {
    this.building = true;

    const module: MutableSlopsixModule = {
      instantiateWasm: (
        imports: WebAssembly.Imports,
        receiveInstance: (instance: WebAssembly.Instance) => WebAssembly.Exports,
      ) => {
        const instance = new WebAssembly.Instance(wasmModule, imports);
        return receiveInstance(instance);
      },
      onRuntimeInitialized: () => {
        this.attach(module as SlopsixModule);
      },
    };

    try {
      void createSlopsixModule(module).catch((error: unknown) => {
        this.emit({ type: 'error', message: describe(error) });
      });
    } catch (error: unknown) {
      this.emit({ type: 'error', message: describe(error) });
    }
  }

  /**
   * Build the engine from the bytes.
   *
   * The wasm module must not be compiled while the worklet global scope is
   * still initialising: the audio thread cannot run the tasks the compiler
   * needs, and the compilation never finishes. The compile therefore
   * starts from the first render quantum, and `locateFile` keeps the
   * Emscripten runtime from building a `URL` for the binary: an
   * AudioWorkletGlobalScope has no `URL` constructor.
   */
  private compile(): void {
    this.building = true;

    const wasmBinary = this.wasmBinary;
    if (wasmBinary === undefined) {
      this.emit({ type: 'error', message: 'the engine binary is missing' });
      return;
    }

    createSlopsixModule({ wasmBinary, locateFile: (path) => path })
      .then((module) => {
        this.attach(module);
      })
      .catch((error: unknown) => {
        this.emit({ type: 'error', message: describe(error) });
      });
  }

  /** Take over the engine the runtime has just started. */
  private attach(module: SlopsixModule): void {
    // The engine runs at the rate of the graph, not at its own default.
    const context = module._six7_create(this.engineType, sampleRate);
    if (context === 0) {
      this.queue.length = 0;
      this.emit({
        type: 'error',
        message: 'could not allocate the engine context',
      });
      return;
    }

    this.context = context;
    this.module = module;
    this.outPtr = module._malloc(
      BLOCK_FRAMES * 2 * Int16Array.BYTES_PER_ELEMENT,
    );
    this.voicePtr = module._malloc(VOICE_DUMP_SIZE);
    this.refreshViews();
    this.configureContext();

    this.emit({
      type: 'ready',
      version: module._six7_version_number(),
      dumpSize: module._six7_voice_dump_size(context),
      engineType: this.engineType,
    });

    for (const command of this.queue) {
      this.handle(command);
    }
    this.queue.length = 0;
  }

  private refreshViews(): void {
    const module = this.module;
    if (module === null) {
      return;
    }
    this.heapBuffer = module.HEAPU8.buffer;
    this.samples = new Int16Array(
      this.heapBuffer,
      this.outPtr,
      BLOCK_FRAMES * 2,
    );
  }

  private configureContext(): void {
    const module = this.module;
    if (module === null) {
      return;
    }
    module._six7_set_master_volume(this.context, 7);
    module.HEAPU8.fill(0, this.voicePtr, this.voicePtr + VOICE_DUMP_SIZE);
    const voice = this.voice;
    if (voice !== null) {
      module.HEAPU8.set(voice, this.voicePtr);
    }
    module._six7_set_voice(this.context, this.voicePtr, VOICE_DUMP_SIZE);
    this.applyExtensions();
    for (const command of this.settings.values()) {
      this.applySetting(command);
    }
  }

  private applyExtensions(): void {
    const module = this.module;
    if (module === null) {
      return;
    }
    module._six7_set_key_mode(this.context, this.extensions.keyMode);
    module._six7_set_unison_detune(
      this.context,
      this.extensions.unisonDetune,
    );
    module._six7_set_peg_range(this.context, this.extensions.pegRange);
    module._six7_set_peg_velocity(
      this.context,
      this.extensions.pegVelocity === 0 ? 0 : 1,
    );
    module._six7_set_peg_rate_scaling(
      this.context,
      this.extensions.pegRateScaling,
    );
    module._six7_set_lfo_mode(this.context, this.extensions.lfoMode);
  }

  private applySetting(command: EngineCommand): void {
    const module = this.module;
    if (module === null) {
      return;
    }

    switch (command.type) {
      case 'outputGain': {
        module._six7_set_output_gain(this.context, command.gainQ16);
        break;
      }
      case 'ctrl': {
        module._six7_set_ctrl_value(
          this.context,
          command.source,
          command.value,
        );
        break;
      }
      case 'ctrlRange': {
        module._six7_set_ctrl_range(
          this.context,
          command.source,
          command.range,
        );
        break;
      }
      case 'ctrlAssign': {
        module._six7_set_ctrl_assign(
          this.context,
          command.source,
          command.flags,
        );
        break;
      }
      case 'sustain': {
        module._six7_set_sustain(this.context, command.on ? 1 : 0);
        break;
      }
      case 'bend': {
        module._six7_set_pitch_bend(this.context, command.value);
        break;
      }
      case 'bendRange': {
        module._six7_set_pitch_bend_range(
          this.context,
          command.range,
          command.step,
        );
        break;
      }
      case 'tune': {
        module._six7_set_master_tune(this.context, command.centsQ16);
        break;
      }
      case 'reset': {
        module._six7_reset(this.context);
        break;
      }
      default:
        break;
    }
  }

  private switchEngine(engineType: EngineType): void {
    const module = this.module;
    if (module === null) {
      return;
    }

    const context = module._six7_create(engineType, sampleRate);
    if (context === 0) {
      this.emit({
        type: 'error',
        message: 'could not allocate the engine context',
      });
      return;
    }

    module._six7_destroy(this.context);
    this.context = context;
    this.engineType = engineType;
    this.refreshViews();
    this.configureContext();

    this.emit({
      type: 'ready',
      version: module._six7_version_number(),
      dumpSize: module._six7_voice_dump_size(context),
      engineType,
    });
  }

  private handle(command: EngineCommand): void {
    const module = this.module;
    if (module === null) {
      this.queue.push(command);
      return;
    }

    switch (command.type) {
      case 'voice': {
        const data = command.data;
        if (data.length !== VOICE_DUMP_SIZE) {
          this.emit({
            type: 'error',
            message: `the voice dump is ${data.length} bytes, expected ${VOICE_DUMP_SIZE}`,
          });
          return;
        }
        if (module.HEAPU8.buffer !== this.heapBuffer) {
          this.refreshViews();
        }
        const voice = data.slice();
        this.voice = voice;
        this.extensions = command.extensions ?? neutralExtensions();
        module._six7_all_notes_off(this.context);
        module.HEAPU8.set(voice, this.voicePtr);
        module._six7_set_voice(this.context, this.voicePtr, voice.length);
        this.applyExtensions();
        break;
      }
      case 'noteOn': {
        module._six7_note_on(this.context, command.note, command.velocity);
        break;
      }
      case 'noteOff': {
        module._six7_note_off(this.context, command.note);
        break;
      }
      case 'allNotesOff': {
        module._six7_all_notes_off(this.context);
        break;
      }
      case 'setEngine': {
        this.switchEngine(command.engineType);
        break;
      }
      case 'reset': {
        this.applySetting(command);
        break;
      }
      default: {
        this.settings.set(settingKey(command), command);
        this.applySetting(command);
        break;
      }
    }
  }

  private emit(event: EngineEvent): void {
    this.port.postMessage(event);
  }
}

registerProcessor('six7-processor', Six7Processor);
