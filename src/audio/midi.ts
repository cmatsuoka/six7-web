/**
 * The MIDI input.
 *
 * The app is a sound module: notes, pitch bend and the modulation wheel
 * come from a MIDI controller. Web MIDI asks for permission from a user
 * gesture, so the connection is made by the MIDI control on the panel. A
 * browser without Web MIDI, or a user who declines the permission, still
 * has the on-screen and computer keyboards for auditioning.
 */

export interface MidiDevice {
  readonly id: string;
  readonly name: string;
}

export interface MidiHandlers {
  onNoteOn(note: number, velocity: number): void;
  onNoteOff(note: number): void;
  onPitchBend(value: number): void;
  onModulation(value: number): void;
  onSustain(on: boolean): void;
  onAllNotesOff(): void;
  onDevices(devices: MidiDevice[]): void;
  onStatus(message: string): void;
  onError(message: string): void;
}

export class MidiInput {
  private access: WebMidi.MIDIAccess | null = null;
  private readonly handlers: MidiHandlers;
  private readonly attached = new Map<string, WebMidi.MIDIInput>();
  private selectedId: string | null = null;

  constructor(handlers: MidiHandlers) {
    this.handlers = handlers;
  }

  static get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.requestMIDIAccess === 'function'
    );
  }

  get connected(): boolean {
    return this.access !== null;
  }

  get selected(): string | null {
    return this.selectedId;
  }

  get devices(): MidiDevice[] {
    const access = this.access;
    if (access === null) {
      return [];
    }
    const devices: MidiDevice[] = [];
    for (const input of access.inputs.values()) {
      devices.push({ id: input.id, name: input.name ?? input.id });
    }
    return devices;
  }

  /** Listen to one input, or to every input when id is null. */
  select(id: string | null): void {
    this.selectedId = id;
    this.listen();
  }

  async connect(): Promise<void> {
    if (!MidiInput.supported) {
      this.handlers.onError('this browser does not support Web MIDI');
      return;
    }
    if (this.access !== null) {
      return;
    }

    try {
      const access = await navigator.requestMIDIAccess({
        sysex: false,
        software: false,
      });
      this.access = access;
      access.onstatechange = () => {
        this.listen();
        this.handlers.onDevices(this.devices);
        this.handlers.onStatus(this.describe());
      };
      this.listen();
      this.handlers.onDevices(this.devices);
      this.handlers.onStatus(this.describe());
    } catch (error: unknown) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.handlers.onError(
        `the MIDI permission was not granted (${reason.message})`,
      );
    }
  }

  disconnect(): void {
    for (const input of this.attached.values()) {
      input.onmidimessage = null;
    }
    this.attached.clear();
    this.access = null;
    this.handlers.onDevices([]);
    this.handlers.onAllNotesOff();
    this.handlers.onPitchBend(8192);
    this.handlers.onModulation(0);
    this.handlers.onSustain(false);
    this.handlers.onStatus('MIDI not connected');
  }

  private listen(): void {
    const access = this.access;
    if (access === null) {
      return;
    }

    const selected = this.selectedId;

    for (const [id, input] of this.attached) {
      const wanted =
        selected === null || id === selected ? access.inputs.has(id) : false;
      if (!wanted) {
        input.onmidimessage = null;
        this.attached.delete(id);
      }
    }

    for (const [id, input] of access.inputs) {
      if (selected !== null && id !== selected) {
        continue;
      }
      if (this.attached.has(id)) {
        continue;
      }
      input.onmidimessage = (event: WebMidi.MIDIMessageEvent) => {
        this.handleMessage(event);
      };
      this.attached.set(id, input);
    }
  }

  private describe(): string {
    const count = this.devices.length;
    if (count === 0) {
      return 'MIDI connected, no inputs';
    }
    return count === 1 ? 'MIDI connected: 1 input' : `MIDI connected: ${count} inputs`;
  }

  private handleMessage(event: WebMidi.MIDIMessageEvent): void {
    const data = event.data;
    if (data === undefined || data.length < 2) {
      return;
    }

    const status = data[0] ?? 0;
    const kind = status & 0xf0;
    const first = data[1] ?? 0;
    const second = data[2] ?? 0;

    switch (kind) {
      case 0x80: {
        this.handlers.onNoteOff(first);
        break;
      }
      case 0x90: {
        if (second === 0) {
          this.handlers.onNoteOff(first);
        } else {
          this.handlers.onNoteOn(first, second);
        }
        break;
      }
      case 0xb0: {
        if (first === 1) {
          this.handlers.onModulation(second);
        } else if (first === 64) {
          this.handlers.onSustain(second >= 64);
        } else if (first === 123 || first === 120) {
          this.handlers.onAllNotesOff();
        }
        break;
      }
      case 0xe0: {
        // The 14-bit value is sent least significant byte first.
        this.handlers.onPitchBend(((second & 0x7f) << 7) | (first & 0x7f));
        break;
      }
      default:
        break;
    }
  }
}
