declare module '*slopsix.mjs' {
  export interface SlopsixModule {
    HEAPU8: Uint8Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;

    _malloc(size: number): number;
    _free(ptr: number): void;
    _six7_version_number(): number;
    _six7_create(engine: number, sampleRate: number): number;
    _six7_destroy(ctx: number): void;
    _six7_reset(ctx: number): void;
    _six7_set_voice(ctx: number, data: number, size: number): number;
    _six7_get_voice(ctx: number, out: number, size: number): number;
    _six7_process(ctx: number, out: number, frames: number): void;
    _six7_note_on(ctx: number, note: number, velocity: number): number;
    _six7_note_off(ctx: number, note: number): number;
    _six7_all_notes_off(ctx: number): number;
    _six7_set_ctrl_value(
      ctx: number,
      source: number,
      value: number,
    ): number;
    _six7_set_ctrl_range(
      ctx: number,
      source: number,
      range: number,
    ): number;
    _six7_set_ctrl_assign(
      ctx: number,
      source: number,
      flags: number,
    ): number;
    _six7_set_sustain(ctx: number, on: number): number;
    _six7_set_lfo_mode(ctx: number, mode: number): number;
    _six7_set_key_mode(ctx: number, mode: number): number;
    _six7_set_unison_detune(ctx: number, depth: number): number;
    _six7_set_peg_range(ctx: number, range: number): number;
    _six7_set_peg_velocity(ctx: number, on: number): number;
    _six7_set_peg_rate_scaling(ctx: number, depth: number): number;
    _six7_set_master_volume(ctx: number, level: number): number;
    _six7_set_output_gain(ctx: number, gainQ16: number): number;
    _six7_set_master_tune(ctx: number, centsQ16: number): number;
    _six7_set_pitch_bend(ctx: number, bend: number): number;
    _six7_set_pitch_bend_range(
      ctx: number,
      range: number,
      step: number,
    ): number;
    _six7_voice_dump_size(ctx: number): number;
    _six7_voice_count(ctx: number): number;
    _six7_context_engine(ctx: number): number;
  }

  export interface SlopsixModuleOptions {
    wasmBinary?: ArrayBuffer;
    noInitialRun?: boolean;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
    locateFile?: (path: string) => string;
    /**
     * Take over the instantiation of the wasm module. The callback gets
     * the imports of the module and hands the instance back to the
     * runtime. It may be called synchronously, and the exports of the
     * instance have to be returned: the runtime takes them from there.
     */
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance) => WebAssembly.Exports,
    ) => WebAssembly.Exports;
    /**
     * Called when the runtime is up and the C constructors have run. The
     * module object that was handed in carries the exports and the heap
     * views from that moment on.
     */
    onRuntimeInitialized?: () => void;
  }

  const createSlopsixModule: (
    options?: SlopsixModuleOptions,
  ) => Promise<SlopsixModule>;
  export default createSlopsixModule;
}
