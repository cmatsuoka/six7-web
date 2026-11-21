import type { Six7Engine } from '../audio/engine';
import {
  BANK_VOICE_COUNT,
  ENGINE_DX7,
  ENGINE_DX7S,
  KEY_POLY,
  PEG_RANGE_8_OCTAVES,
  formatEngineType,
  formatVersion,
  type EngineType,
} from '../audio/protocol';
import {
  bankNameFromFile,
  createStarterBank,
  makeBank,
  newBankId,
  reparseBank,
  type Bank,
} from './bank';
import {
  attachComputerKeyboard,
  noteName,
  type ComputerKeyboard,
} from './computer-keyboard';
import { createDisplay } from './display';
import { MidiInput, type MidiDevice } from '../audio/midi';
import { parseSysex, voiceAlgorithm } from './sysex';
import { loadBanks, saveBanks } from './storage';

const PROGRAM_BUTTON_COUNT = BANK_VOICE_COUNT;
const ENGINE_TYPES: readonly EngineType[] = [ENGINE_DX7, ENGINE_DX7S];
const KEYBOARD_OCTAVES = 2;
const MAX_VOLUME = 100;
const MAX_SENSITIVITY = 100;
const Q16_ONE = 65536;

const LCD_INTERNAL_VOICE = 'INTERNAL VOICE';
const LCD_MIDI_RECEIVED = ' MIDI RECEIVED';
const LCD_CHECKSUM_ERROR = 'CHECK SUM ERROR!';
const LCD_MIDI_DATA_ERROR = 'MIDI DATA ERROR!';

export interface Panel {
  showError(message: string): void;
  showNotice(message: string): void;
  handleFiles(files: readonly File[]): void;
}

interface KnobOptions {
  id: string;
  label: string;
  ariaLabel: string;
  max: number;
  getValue: () => number;
  setValue: (value: number) => void;
}

interface KnobControl {
  wrap: HTMLDivElement;
  element: HTMLDivElement;
  dial: HTMLDivElement;
}

function createKnob(options: KnobOptions): KnobControl {
  const wrap = document.createElement('div');
  wrap.className = 'knob-wrap';

  const element = document.createElement('div');
  element.className = 'knob';
  element.id = options.id;
  element.tabIndex = 0;
  element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', options.ariaLabel);
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', String(options.max));
  element.setAttribute('aria-valuenow', String(options.getValue()));

  const dial = document.createElement('div');
  dial.className = 'knob-dial';

  const pointer = document.createElement('span');
  pointer.className = 'knob-pointer';
  dial.append(pointer);

  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = options.label;

  element.append(dial);
  wrap.append(element, label);

  let dragStartY = 0;
  let dragStartValue = 0;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    element.classList.add('dragging');
    dragStartY = event.clientY;
    dragStartValue = options.getValue();
  });
  element.addEventListener('pointermove', (event) => {
    if (!element.hasPointerCapture(event.pointerId)) {
      return;
    }
    event.preventDefault();
    const delta = ((dragStartY - event.clientY) / 160) * options.max;
    options.setValue(dragStartValue + delta);
  });
  const endDrag = (event: PointerEvent): void => {
    if (!element.hasPointerCapture(event.pointerId)) {
      return;
    }
    element.releasePointerCapture(event.pointerId);
    element.classList.remove('dragging');
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      options.setValue(options.getValue() + (event.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );
  element.addEventListener('keydown', (event) => {
    const value = options.getValue();
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        options.setValue(value + 1);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        options.setValue(value - 1);
        break;
      case 'PageUp':
        options.setValue(value + 10);
        break;
      case 'PageDown':
        options.setValue(value - 10);
        break;
      case 'Home':
        options.setValue(0);
        break;
      case 'End':
        options.setValue(options.max);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  return { wrap, element, dial };
}

export function createPanel(root: HTMLElement, engine: Six7Engine): Panel {
  const starter = createStarterBank();
  let banks: Bank[] = [starter, ...loadBanks()];
  let bankId = starter.id;
  let program = 0;
  let volume = 70;
  let sensitivity = MAX_SENSITIVITY;
  let messageTimer: ReturnType<typeof setTimeout> | null = null;
  let lcdTimer: ReturnType<typeof setTimeout> | null = null;
  let lcdLineOne = starter.name;
  let engineType: EngineType = ENGINE_DX7;

  const display = createDisplay();

  const machine = document.createElement('section');
  machine.className = 'machine';
  machine.setAttribute('aria-label', 'FM synthesizer display cluster');

  const caseTop = document.createElement('div');
  caseTop.className = 'case-top';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = '<span class="brand-mark">six7</span><span class="brand-sub">FM SYNTHESIZER</span>';

  const displayBezel = document.createElement('div');
  displayBezel.className = 'display-bezel';
  displayBezel.append(display.element);

  caseTop.append(brand, displayBezel);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const engineRow = document.createElement('div');
  engineRow.className = 'control-row source-row';

  const engineButton = document.createElement('button');
  engineButton.type = 'button';
  engineButton.className = 'button engine-button';
  engineButton.textContent = 'ENGINE';
  engineButton.setAttribute('aria-label', 'cycle engine personality');

  engineButton.addEventListener('click', () => {
    const index = ENGINE_TYPES.indexOf(engineType);
    const next = ENGINE_TYPES[(index + 1) % ENGINE_TYPES.length] ?? ENGINE_DX7;
    engineType = next;
    engine.setEngineType(engineType);
    renderPatchInfo();
  });

  const bankLabel = document.createElement('span');
  bankLabel.className = 'field-label bank-label';
  bankLabel.textContent = 'BANK';

  const bankPrevButton = document.createElement('button');
  bankPrevButton.type = 'button';
  bankPrevButton.className = 'button button-small';
  bankPrevButton.textContent = '−';
  bankPrevButton.setAttribute('aria-label', 'previous bank');

  const bankNextButton = document.createElement('button');
  bankNextButton.type = 'button';
  bankNextButton.className = 'button button-small';
  bankNextButton.textContent = '+';
  bankNextButton.setAttribute('aria-label', 'next bank');

  const programLabel = document.createElement('span');
  programLabel.className = 'field-label program-label';
  programLabel.textContent = 'PRG';

  const programPrevButton = document.createElement('button');
  programPrevButton.type = 'button';
  programPrevButton.className = 'button button-small';
  programPrevButton.textContent = '−';
  programPrevButton.setAttribute('aria-label', 'previous program');

  const programNextButton = document.createElement('button');
  programNextButton.type = 'button';
  programNextButton.className = 'button button-small';
  programNextButton.textContent = '+';
  programNextButton.setAttribute('aria-label', 'next program');

  const loadButton = document.createElement('button');
  loadButton.type = 'button';
  loadButton.className = 'button';
  loadButton.textContent = 'Load bank…';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.syx,.sysex,application/octet-stream';
  fileInput.multiple = true;
  fileInput.hidden = true;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'button button-quiet';
  removeButton.textContent = 'Remove bank';

  engineRow.append(
    engineButton,
    programLabel,
    programPrevButton,
    programNextButton,
    bankLabel,
    bankPrevButton,
    bankNextButton,
    loadButton,
    removeButton,
    fileInput,
  );

  const midiRow = document.createElement('div');
  midiRow.className = 'control-row midi-row';

  const midiLabel = document.createElement('span');
  midiLabel.className = 'field-label';
  midiLabel.textContent = 'MIDI IN';

  const midiConnect = document.createElement('button');
  midiConnect.type = 'button';
  midiConnect.className = 'button';
  midiConnect.textContent = 'Connect MIDI';

  const midiSelect = document.createElement('select');
  midiSelect.className = 'bank-select midi-select';
  midiSelect.setAttribute('aria-label', 'MIDI input');
  midiSelect.disabled = true;

  const midiStatus = document.createElement('span');
  midiStatus.className = 'midi-status';
  midiStatus.setAttribute('role', 'status');
  midiStatus.setAttribute('aria-live', 'polite');

  midiRow.append(midiLabel, midiConnect, midiSelect, midiStatus);

  const knobs = document.createElement('div');
  knobs.className = 'knobs';

  const volumeKnob = createKnob({
    id: 'volume',
    label: 'VOL',
    ariaLabel: 'volume',
    max: MAX_VOLUME,
    getValue: () => volume,
    setValue: (value) => setVolume(value),
  });
  const sensitivityKnob = createKnob({
    id: 'sensitivity',
    label: 'SENS',
    ariaLabel: 'velocity sensitivity',
    max: MAX_SENSITIVITY,
    getValue: () => sensitivity,
    setValue: (value) => setSensitivity(value),
  });

  knobs.append(sensitivityKnob.wrap, volumeKnob.wrap);
  engineRow.append(knobs);

  const programGrid = document.createElement('div');
  programGrid.className = 'program-grid';
  programGrid.setAttribute('role', 'group');
  programGrid.setAttribute('aria-label', 'programs');

  const programButtons: HTMLButtonElement[] = [];
  for (let slot = 0; slot < PROGRAM_BUTTON_COUNT; slot += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'program-button';
    button.textContent = String(slot + 1).padStart(2, '0');
    button.addEventListener('click', () => {
      selectProgram(slot);
    });
    programButtons.push(button);
    programGrid.append(button);
  }

  const keyboardPanel = document.createElement('div');
  keyboardPanel.className = 'keyboard-panel';

  const keyboardHead = document.createElement('div');
  keyboardHead.className = 'keyboard-head';

  const keyboardTitle = document.createElement('span');
  keyboardTitle.className = 'field-label';
  keyboardTitle.textContent = 'PLAY';

  const octaveDown = document.createElement('button');
  octaveDown.type = 'button';
  octaveDown.className = 'button button-small';
  octaveDown.textContent = '−';
  octaveDown.setAttribute('aria-label', 'octave down');

  const octaveLabel = document.createElement('span');
  octaveLabel.className = 'octave-label';

  const octaveUp = document.createElement('button');
  octaveUp.type = 'button';
  octaveUp.className = 'button button-small';
  octaveUp.textContent = '+';
  octaveUp.setAttribute('aria-label', 'octave up');

  keyboardHead.append(keyboardTitle, octaveDown, octaveLabel, octaveUp);

  const piano = document.createElement('div');
  piano.className = 'piano';

  keyboardPanel.append(keyboardHead, piano);

  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const attribution = document.createElement('div');
  attribution.className = 'attribution';
  attribution.innerHTML =
    'Using <a href="https://github.com/cmatsuoka/slopsix" rel="noreferrer" target="_blank">libslopsix</a> (MIT)';

  controls.append(
    engineRow,
    midiRow,
    programGrid,
    keyboardPanel,
    status,
  );

  const caseBottom = document.createElement('div');
  caseBottom.className = 'case-bottom';

  machine.append(caseTop, controls, caseBottom);
  root.append(machine, attribution);

  const keyElements = new Map<number, HTMLButtonElement>();
  /** Notes held by the on-screen and computer keyboards. */
  const downNotes = new Set<number>();
  /** Notes held by a MIDI input, which need the same key highlight. */
  const midiNotes = new Set<number>();
  /** The note under every pointer that is dragging across the keys. */
  const pointerNotes = new Map<number, number | null>();
  let keyboard: ComputerKeyboard;

  function currentBank(): Bank {
    return banks.find((bank) => bank.id === bankId) ?? starter;
  }

  function currentVoice() {
    const bank = currentBank();
    return bank.voices[program] ?? null;
  }

  function freshCurrentBank(): Bank {
    const bank = currentBank();
    const reparsed = reparseBank(bank);
    if (reparsed === null) {
      return bank;
    }
    banks = banks.map((entry) => (entry.id === bank.id ? reparsed : entry));
    if (reparsed.voices.length !== bank.voices.length) {
      refreshBankControls();
    }
    return reparsed;
  }

  function refreshBankControls(): void {
    const bank = currentBank();
    bankPrevButton.disabled = banks.length < 2;
    bankNextButton.disabled = banks.length < 2;
    removeButton.disabled = bank.builtin === true || banks.length <= 1;
  }

  function refreshPrograms(): void {
    const bank = currentBank();
    programButtons.forEach((button, slot) => {
      const voice = bank.voices[slot];
      button.hidden = voice === undefined;
      button.disabled = voice === undefined;
      button.textContent = String(slot + 1).padStart(2, '0');
      button.title = voice === undefined ? '' : voice.name;
      button.setAttribute(
        'aria-label',
        voice === undefined
          ? `program ${slot + 1}`
          : `program ${slot + 1}: ${voice.name || 'unnamed'}`,
      );
      button.classList.toggle('selected', slot === program);
      button.setAttribute('aria-pressed', slot === program ? 'true' : 'false');
    });

    const voice = currentVoice();
    display.setProgram(voice === null ? null : program + 1);
    cancelLcdFlash();
    renderPatchInfo();
    programPrevButton.disabled = bank.voices.length < 2;
    programNextButton.disabled = bank.voices.length < 2;
  }

  /**
   * The bank's name on the first line, and the source prefix, program
   * number, ten-character patch name and engine personality on the second.
   */
  function renderPatchInfo(): void {
    const bank = currentBank();
    const voice = currentVoice();
    const cartridge = bank.builtin !== true;
    const prefix = cartridge ? 'CRT' : 'INT';
    const number = program + 1;
    const digits = number < 10 ? ` ${number}` : String(number);
    const name = (voice?.name ?? '').slice(0, 10).padEnd(10, ' ');
    const personality = formatEngineType(engine.engineType).padEnd(4, ' ');
    lcdLineOne = cartridge
      ? `CARTRIDGE VOICE  ${(bank.name ?? '').slice(0, 16)}`
      : LCD_INTERNAL_VOICE;
    display.setLines(
      lcdLineOne,
      `${prefix}${digits} ${name} ENG ${personality}`,
    );
    display.setPatchDetails(
      voice === null
        ? null
        : {
            algorithm: voiceAlgorithm(voice.data),
            pegRange: voice.extensions?.pegRange ?? PEG_RANGE_8_OCTAVES,
            keyMode: voice.extensions?.keyMode ?? KEY_POLY,
            unisonDetune: voice.extensions?.unisonDetune ?? 0,
          },
    );
  }

  /** Show a message on the LCD's second line, as the hardware does. */
  function flashLcdLine2(message: string): void {
    cancelLcdFlash();
    display.setLines(lcdLineOne, message);
    lcdTimer = setTimeout(() => {
      lcdTimer = null;
      renderPatchInfo();
    }, 2000);
  }

  function cancelLcdFlash(): void {
    if (lcdTimer !== null) {
      clearTimeout(lcdTimer);
      lcdTimer = null;
    }
  }

  function selectProgram(slot: number): void {
    const bank = freshCurrentBank();
    if (slot < 0 || slot >= bank.voices.length) {
      return;
    }
    program = slot;
    const voice = bank.voices[program];
    if (voice !== undefined) {
      engine.setVoice(voice.data, voice.extensions);
    }
    refreshPrograms();
  }

  function selectBank(id: string): void {
    const bank = banks.find((entry) => entry.id === id);
    if (bank === undefined) {
      return;
    }
    bankId = bank.id;
    program = Math.max(0, Math.min(bank.voices.length - 1, program));
    refreshBankControls();
    refreshPrograms();
    selectProgram(program);
  }

  function stepBank(delta: number): void {
    if (banks.length < 2) {
      return;
    }
    const index = banks.findIndex((entry) => entry.id === bankId);
    const bank = banks[(index + delta + banks.length) % banks.length];
    if (bank !== undefined) {
      selectBank(bank.id);
    }
  }

  function setVolume(percent: number): void {
    volume = Math.max(0, Math.min(MAX_VOLUME, Math.round(percent)));
    const angle = -135 + (volume / MAX_VOLUME) * 270;
    volumeKnob.dial.style.setProperty('--knob-angle', `${angle}deg`);
    volumeKnob.element.setAttribute('aria-valuenow', String(volume));
    volumeKnob.element.setAttribute('aria-valuetext', `${volume}%`);
    engine.setOutputGain(Math.round((volume / MAX_VOLUME) * Q16_ONE));
  }

  function setSensitivity(percent: number): void {
    sensitivity = Math.max(
      0,
      Math.min(MAX_SENSITIVITY, Math.round(percent)),
    );
    const angle = -135 + (sensitivity / MAX_SENSITIVITY) * 270;
    sensitivityKnob.dial.style.setProperty('--knob-angle', `${angle}deg`);
    sensitivityKnob.element.setAttribute('aria-valuenow', String(sensitivity));
    sensitivityKnob.element.setAttribute('aria-valuetext', `${sensitivity}%`);
  }

  function scaledVelocity(velocity: number): number {
    const input = Math.max(0, Math.min(127, Math.round(velocity)));
    const scaled =
      127 - ((127 - input) * sensitivity) / MAX_SENSITIVITY;
    return Math.max(0, Math.min(127, Math.round(scaled)));
  }

  function removeCurrentBank(): void {
    const bank = currentBank();
    if (bank.builtin === true) {
      return;
    }
    banks = banks.filter((entry) => entry.id !== bank.id);
    saveBanks(banks);
    const fallback = banks[0] ?? starter;
    if (!banks.some((entry) => entry.id === starter.id)) {
      banks = [starter, ...banks];
    }
    bankId = fallback.id;
    program = 0;
    refreshBankControls();
    refreshPrograms();
    selectProgram(0);
    showNotice(`Removed ${bank.name}`);
  }

  async function readFiles(files: readonly File[]): Promise<void> {
    let added = 0;
    let checksumError = false;
    const warnings: string[] = [];

    for (const file of files) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        warnings.push(`${file.name}: the file could not be read`);
        continue;
      }

      const parsed = parseSysex(bytes);
      if (parsed.warnings.some((warning) => warning.includes('checksum'))) {
        checksumError = true;
      }
      warnings.push(...parsed.warnings.map((warning) => `${file.name}: ${warning}`));

      parsed.dumps.forEach((dump, dumpIndex) => {
        const base = bankNameFromFile(file.name);
        const name =
          parsed.dumps.length > 1 ? `${base} ${dumpIndex + 1}` : base;
        const bank = makeBank(
          newBankId(),
          name,
          dump.voices,
          dump.extensions,
          dump.raw,
        );
        banks = [starter, ...banks.filter((entry) => entry.id !== starter.id), bank].filter(
          (entry, index, list) =>
            entry.builtin === true ||
            list.findIndex((other) => other.id === entry.id) === index,
        );
        added += 1;
      });
    }

    if (added > 0) {
      saveBanks(banks);
      refreshBankControls();
      flashLcdLine2(checksumError ? LCD_CHECKSUM_ERROR : LCD_MIDI_RECEIVED);
      showNotice(
        added === 1
          ? 'Added one bank to the library'
          : `Added ${added} banks to the library`,
      );
      if (warnings.length > 0) {
        showError(warnings.join(' · '));
      }
    } else {
      flashLcdLine2(checksumError ? LCD_CHECKSUM_ERROR : LCD_MIDI_DATA_ERROR);
      showError(
        warnings.length > 0
          ? warnings.join(' · ')
          : 'No DX7-family voice dump was found in the file',
      );
    }
  }

  function handleFiles(files: readonly File[]): void {
    if (files.length === 0) {
      return;
    }
    void readFiles(files);
  }

  function showNotice(message: string): void {
    status.textContent = message;
    status.dataset.kind = 'notice';
    scheduleStatusClear();
  }

  function showError(message: string): void {
    status.textContent = message;
    status.dataset.kind = 'error';
    scheduleStatusClear();
  }

  function scheduleStatusClear(): void {
    if (messageTimer !== null) {
      clearTimeout(messageTimer);
    }
    messageTimer = setTimeout(() => {
      status.textContent = '';
      delete status.dataset.kind;
      messageTimer = null;
    }, 9000);
  }

  function buildPiano(): void {
    piano.replaceChildren();
    keyElements.clear();

    const start = (keyboard.octave + 1) * 12;
    const end = start + KEYBOARD_OCTAVES * 12 + 1;
    const naturals = new Set([0, 2, 4, 5, 7, 9, 11]);
    const whiteNotes: number[] = [];
    for (let note = start; note < end; note += 1) {
      if (naturals.has(note % 12)) {
        whiteNotes.push(note);
      }
    }
    const whiteWidth = 100 / whiteNotes.length;
    const blackWidth = whiteWidth * 0.62;
    let whiteIndex = 0;

    for (let note = start; note < end; note += 1) {
      const natural = naturals.has(note % 12);
      if (natural) {
        const key = makePianoKey(note, 'white');
        key.style.left = `${whiteIndex * whiteWidth}%`;
        key.style.width = `${whiteWidth}%`;
        piano.append(key);
        whiteIndex += 1;
      } else {
        const key = makePianoKey(note, 'black');
        key.style.left = `${whiteIndex * whiteWidth - blackWidth / 2}%`;
        key.style.width = `${blackWidth}%`;
        piano.append(key);
      }
    }

    octaveLabel.textContent = `C${keyboard.octave}`;
  }

  function makePianoKey(
    note: number,
    kind: 'white' | 'black',
  ): HTMLButtonElement {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = `piano-key piano-${kind}`;
    key.setAttribute('aria-label', noteName(note));
    key.dataset.note = String(note);
    keyElements.set(note, key);
    return key;
  }

  /** The note of the key under a pointer, or null when it is off the keys. */
  function noteAt(clientX: number, clientY: number): number | null {
    const element = document.elementFromPoint(clientX, clientY);
    if (!(element instanceof Element)) {
      return null;
    }
    const key = element.closest('.piano-key');
    if (!(key instanceof HTMLElement)) {
      return null;
    }
    const note = Number(key.dataset.note);
    return Number.isInteger(note) ? note : null;
  }

  /*
   * The pointer is captured by the keyboard, not by the key it started on,
   * so sliding from one key to the next keeps delivering pointermove. The
   * key under the pointer is looked up at every move: the old note is
   * released and the new one is pressed, which is what makes a glissando.
   */
  piano.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const note = noteAt(event.clientX, event.clientY);
    if (note === null) {
      return;
    }
    event.preventDefault();
    piano.setPointerCapture(event.pointerId);
    pointerNotes.set(event.pointerId, note);
    pressNote(note);
  });

  piano.addEventListener('pointermove', (event) => {
    if (!pointerNotes.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    const next = noteAt(event.clientX, event.clientY);
    const current = pointerNotes.get(event.pointerId) ?? null;
    if (next === current) {
      return;
    }
    if (current !== null) {
      releaseNote(current);
    }
    pointerNotes.set(event.pointerId, next);
    if (next !== null) {
      pressNote(next);
    }
  });

  const endPointer = (event: PointerEvent): void => {
    if (!pointerNotes.has(event.pointerId)) {
      return;
    }
    const note = pointerNotes.get(event.pointerId) ?? null;
    pointerNotes.delete(event.pointerId);
    if (note !== null) {
      releaseNote(note);
    }
    if (piano.hasPointerCapture(event.pointerId)) {
      piano.releasePointerCapture(event.pointerId);
    }
  };

  piano.addEventListener('pointerup', endPointer);
  piano.addEventListener('pointercancel', endPointer);

  function refreshKey(note: number): void {
    const key = keyElements.get(note);
    key?.classList.toggle(
      'down',
      downNotes.has(note) || midiNotes.has(note),
    );
  }

  function pressNote(note: number): void {
    if (downNotes.has(note)) {
      return;
    }
    downNotes.add(note);
    engine.noteOn(note, scaledVelocity(100));
    refreshKey(note);
  }

  function releaseNote(note: number): void {
    if (!downNotes.has(note)) {
      return;
    }
    downNotes.delete(note);
    engine.noteOff(note);
    refreshKey(note);
  }

  function allNotesOff(): void {
    downNotes.clear();
    midiNotes.clear();
    pointerNotes.clear();
    engine.allNotesOff();
    for (const key of keyElements.values()) {
      key.classList.remove('down');
    }
  }

  keyboard = attachComputerKeyboard(
    {
      onNoteOn: (note) => pressNote(note),
      onNoteOff: (note) => releaseNote(note),
      onAllNotesOff: allNotesOff,
    },
    3,
  );


  const midi = new MidiInput({
    onNoteOn: (note, velocity) => {
      midiNotes.add(note);
      refreshKey(note);
      engine.noteOn(note, scaledVelocity(velocity));
    },
    onNoteOff: (note) => {
      midiNotes.delete(note);
      refreshKey(note);
      engine.noteOff(note);
    },
    onPitchBend: (value) => {
      engine.setPitchBend(value);
    },
    onModulation: (value) => {
      engine.setModulation(value);
    },
    onSustain: (on) => {
      engine.setSustain(on);
    },
    onAllNotesOff: () => {
      allNotesOff();
    },
    onDevices: (devices) => {
      updateMidiDevices(devices);
    },
    onStatus: (message) => {
      midiStatus.textContent = message;
    },
    onError: (message) => {
      showError(message);
    },
  });

  function updateMidiDevices(devices: readonly MidiDevice[]): void {
    const selected = midi.selected;
    midiSelect.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All inputs';
    midiSelect.append(all);
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.name;
      midiSelect.append(option);
    }
    if (selected !== null && !devices.some((device) => device.id === selected)) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = 'Disconnected input';
      midiSelect.append(option);
    }
    midiSelect.value = selected ?? '';
    midiSelect.disabled = !midi.connected || devices.length === 0;
  }

  if (!MidiInput.supported) {
    midiConnect.disabled = true;
    midiStatus.textContent = 'Web MIDI is not available in this browser';
  }

  bankPrevButton.addEventListener('click', () => {
    stepBank(-1);
  });
  bankNextButton.addEventListener('click', () => {
    stepBank(1);
  });
  loadButton.addEventListener('click', () => {
    fileInput.click();
  });
  midiConnect.addEventListener('click', () => {
    void midi.connect().then(() => {
      if (midi.connected) {
        midiConnect.textContent = 'MIDI connected';
        midiConnect.disabled = true;
        midiSelect.disabled = midi.devices.length === 0;
        engine.configureMidiControllers();
      }
    });
  });
  midiSelect.addEventListener('change', () => {
    midi.select(midiSelect.value === '' ? null : midiSelect.value);
  });
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (files !== null) {
      handleFiles(Array.from(files));
    }
    fileInput.value = '';
  });
  removeButton.addEventListener('click', removeCurrentBank);
  programPrevButton.addEventListener('click', () => {
    const bank = currentBank();
    selectProgram((program - 1 + bank.voices.length) % bank.voices.length);
  });
  programNextButton.addEventListener('click', () => {
    const bank = currentBank();
    selectProgram((program + 1) % bank.voices.length);
  });
  octaveDown.addEventListener('click', () => {
    allNotesOff();
    keyboard.setOctave(keyboard.octave - 1);
    buildPiano();
  });
  octaveUp.addEventListener('click', () => {
    allNotesOff();
    keyboard.setOctave(keyboard.octave + 1);
    buildPiano();
  });

  // Files can also be dropped on the machine.
  machine.addEventListener('dragover', (event) => {
    event.preventDefault();
    machine.classList.add('drop-target');
  });
  machine.addEventListener('dragleave', () => {
    machine.classList.remove('drop-target');
  });
  machine.addEventListener('drop', (event) => {
    event.preventDefault();
    machine.classList.remove('drop-target');
    const files = event.dataTransfer?.files;
    if (files !== undefined && files !== null) {
      handleFiles(Array.from(files));
    }
  });

  refreshBankControls();
  refreshPrograms();
  buildPiano();
  setVolume(volume);
  setSensitivity(sensitivity);
  const initialBank = freshCurrentBank();
  const initial = initialBank.voices[program] ?? null;
  if (initial !== null) {
    engine.setVoice(initial.data, initial.extensions);
  }

  engine.onReady((version, _dumpSize, readyEngineType) => {
    engineType = readyEngineType;
    renderPatchInfo();
    attribution.innerHTML = `Using <a href="https://github.com/cmatsuoka/slopsix" rel="noreferrer" target="_blank">libslopsix</a> ${formatVersion(version)} (MIT)`;
    engine.configureMidiControllers();
    const voice = currentVoice();
    if (voice !== null) {
      engine.setVoice(voice.data, voice.extensions);
    }
  });

  if (engine.unavailable !== null) {
    showError(engine.unavailable);
  }

  window.addEventListener('beforeunload', () => {
    keyboard.dispose();
    midi.disconnect();
  });

  return { showError, showNotice, handleFiles };
}
