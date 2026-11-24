import logoUrl from '../../six-seven.svg';
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
  mergeStoredVoices,
  newBankId,
  reparseBank,
  type Bank,
  type Voice,
} from './bank';
import {
  attachComputerKeyboard,
  noteName,
  type ComputerKeyboard,
} from './computer-keyboard';
import { createDisplay } from './display';
import { MidiInput, type MidiDevice } from '../audio/midi';
import { parseSysex, voiceAlgorithm } from './sysex';
import { loadBanks, saveBanks, loadInternalMemory, saveInternalMemory, loadSensitivity, scheduleSensitivitySave, cancelSensitivitySave } from './storage';

const PROGRAM_BUTTON_COUNT = BANK_VOICE_COUNT;

/**
 * The parameter each program key will edit once program editing exists.
 * They are a preview of the edit layout: keys 1–6 select the operator and
 * 7–32 select the parameter page (DX7 Mk1 numbering).
 */
const PROGRAM_KEY_LABELS: readonly string[] = [
  'OP1',
  'OP2',
  'OP3',
  'OP4',
  'OP5',
  'OP6',
  'ALG',
  'FDBK',
  'LFO WAV',
  'LFO SPD',
  'LFO DLY',
  'LFO PMD',
  'LFO AMD',
  'LFO SYN',
  'PM SENS',
  'AM SENS',
  'OSC MODE',
  'COARSE',
  'FINE',
  'DETUNE',
  'EG RATE',
  'EG LVL',
  'BRK PT',
  'SCL CRV',
  'SCL DEP',
  'RATE SCL',
  'OUTPUT',
  'KEY VEL',
  'PEG RATE',
  'PEG LVL',
  'MID C',
  'NAME',
];
const ENGINE_TYPES: readonly EngineType[] = [ENGINE_DX7, ENGINE_DX7S];
const KEYBOARD_OCTAVES = 2;
const MAX_VOLUME = 100;
const MAX_SENSITIVITY = 100;
const Q16_ONE = 65536;
const STORE_BLINK_TIMES = 3;

const LCD_INTERNAL_VOICE = 'INTERNAL VOICE';
const LCD_MIDI_RECEIVED = ' MIDI RECEIVED';
const LCD_CHECKSUM_ERROR = 'CHECK SUM ERROR!';
const LCD_MIDI_DATA_ERROR = 'MIDI DATA ERROR!';
const LCD_MEMORY_STORE = ' MEMORY STORE';
const LCD_DELETE_BANK = `${' '.repeat(19)}DELETE BANK`;

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
  /** The voices the user stored in the internal memory, by position. */
  let storedVoices: (Voice | null)[] = loadInternalMemory();
  let starter = mergeStoredVoices(createStarterBank(), storedVoices);
  let banks: Bank[] = [starter, ...loadBanks()];
  let bankId = starter.id;
  let program = 0;
  let volume = 70;
  /** The store operation is pending: a position is being chosen. */
  let storeMode = false;
  /** The internal memory position the pending store will write to. */
  let storeTarget = 0;
  /** The delete operation is pending: the bank is waiting for a confirm. */
  let deleteMode = false;
  const savedSensitivity = loadSensitivity();
  let sensitivity =
    typeof savedSensitivity === 'number'
      ? Math.max(0, Math.min(MAX_SENSITIVITY, savedSensitivity))
      : MAX_SENSITIVITY;
  let messageTimer: ReturnType<typeof setTimeout> | null = null;
  let lcdTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWheelStep = 0;
  let lcdLineOne = starter.name;
  let engineType: EngineType = ENGINE_DX7;
  let normalizeOutput = false;

  const display = createDisplay();

  const machine = document.createElement('section');
  machine.className = 'machine';
  machine.setAttribute('aria-label', 'FM synthesizer display cluster');

  const caseTop = document.createElement('div');
  caseTop.className = 'case-top';

  const brand = document.createElement('div');
  brand.className = 'brand';

  const brandLogo = document.createElement('img');
  brandLogo.className = 'brand-logo';
  brandLogo.src = logoUrl;
  brandLogo.alt = 'Six7';

  const brandSub = document.createElement('span');
  brandSub.className = 'brand-sub';
  brandSub.textContent = 'FM SYNTHESIZER';

  const storeButton = document.createElement('button');
  storeButton.type = 'button';
  storeButton.className = 'button button-quiet bank-action-button store-button';
  storeButton.textContent = 'STORE';
  storeButton.setAttribute('aria-label', 'store voice in the internal memory');

  brand.append(brandLogo, brandSub);

  const displayWrapper = document.createElement('div');
  displayWrapper.className = 'display-wrapper';

  const programButtonsWrap = document.createElement('div');
  programButtonsWrap.className = 'program-buttons-group';

  const programPrevButton = document.createElement('button');
  programPrevButton.type = 'button';
  programPrevButton.className = 'button button-quiet program-nav-button';
  programPrevButton.setAttribute('aria-label', 'previous program');
  programPrevButton.textContent = '−';

  const programLabel = document.createElement('span');
  programLabel.className = 'program-label-inline';
  programLabel.textContent = 'PRG';

  const programNextButton = document.createElement('button');
  programNextButton.type = 'button';
  programNextButton.className = 'button button-quiet program-nav-button';
  programNextButton.setAttribute('aria-label', 'next program');
  programNextButton.textContent = '+';

  programButtonsWrap.append(programPrevButton, programLabel, programNextButton);

  const bankButtonsWrap = document.createElement('div');
  bankButtonsWrap.className = 'program-buttons-group bank-buttons-group';

  const bankPrevButton = document.createElement('button');
  bankPrevButton.type = 'button';
  bankPrevButton.className = 'button button-quiet program-nav-button';
  bankPrevButton.setAttribute('aria-label', 'previous bank');
  bankPrevButton.textContent = '−';

  const bankLabel = document.createElement('span');
  bankLabel.className = 'program-label-inline';
  bankLabel.textContent = 'BANK';

  const bankNextButton = document.createElement('button');
  bankNextButton.type = 'button';
  bankNextButton.className = 'button button-quiet program-nav-button';
  bankNextButton.setAttribute('aria-label', 'next bank');
  bankNextButton.textContent = '+';

  bankButtonsWrap.append(bankPrevButton, bankLabel, bankNextButton);

  const displayBezel = document.createElement('div');
  displayBezel.className = 'display-bezel';
  displayBezel.append(display.element);

  const displayButtons = document.createElement('div');
  displayButtons.className = 'display-buttons';
  displayButtons.append(programButtonsWrap, bankButtonsWrap, storeButton);

  displayWrapper.append(displayBezel, displayButtons);

  caseTop.append(brand, displayWrapper);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const leftButtons = document.createElement('div');
  leftButtons.className = 'left-buttons';

  const okButton = document.createElement('button');
  okButton.type = 'button';
  okButton.className = 'button button-quiet bank-action-button ok-button';
  okButton.textContent = 'EDIT';
  okButton.setAttribute('aria-label', 'edit voice');
  okButton.title = 'Edit the current voice';

  const okSub = document.createElement('span');
  okSub.className = 'button-label-sublabel';
  okSub.textContent = 'OK';

  const okWrap = document.createElement('div');
  okWrap.className = 'button-label-group ok-group';
  okWrap.append(okButton, okSub);

  const engineButton = document.createElement('button');
  engineButton.type = 'button';
  engineButton.className = 'button button-quiet bank-action-button engine-button';
  engineButton.textContent = 'ENG';
  engineButton.setAttribute('aria-label', 'cycle engine personality');

  engineButton.addEventListener('click', () => {
    cancelPending();
    const index = ENGINE_TYPES.indexOf(engineType);
    const next = ENGINE_TYPES[(index + 1) % ENGINE_TYPES.length] ?? ENGINE_DX7;
    engineType = next;
    engine.setEngineType(engineType);
    renderPatchInfo();
  });

  leftButtons.append(okWrap, engineButton);

  const loadButton = document.createElement('button');
  loadButton.type = 'button';
  loadButton.className = 'button button-quiet bank-action-button';
  loadButton.textContent = 'LOAD';
  loadButton.setAttribute('aria-label', 'load bank');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.syx,.sysex,application/octet-stream';
  fileInput.multiple = true;
  fileInput.hidden = true;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'button button-quiet bank-action-button del-button';
  removeButton.textContent = 'DEL';
  removeButton.setAttribute('aria-label', 'delete bank');

  const removeSub = document.createElement('span');
  removeSub.className = 'button-label-sublabel';
  removeSub.textContent = 'CANCEL';

  const removeWrap = document.createElement('div');
  removeWrap.className = 'button-label-group del-group';
  removeWrap.append(removeButton, removeSub);

  bankButtonsWrap.append(loadButton, removeWrap);

  controls.append(fileInput);

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

  const normalizeButton = document.createElement('button');
  normalizeButton.type = 'button';
  normalizeButton.className = 'button button-quiet normalize-button';
  normalizeButton.setAttribute('aria-label', 'output gain normalization');
  normalizeButton.setAttribute('aria-pressed', 'false');
  normalizeButton.title = 'Normalize the DX7S output gain to the DX7 level';

  const normalizeLed = document.createElement('span');
  normalizeLed.className = 'led-rect';
  normalizeLed.setAttribute('aria-hidden', 'true');

  const normalizeText = document.createElement('span');
  normalizeText.textContent = 'NORM';

  normalizeButton.append(normalizeLed, normalizeText);

  const volNormCluster = document.createElement('div');
  volNormCluster.className = 'knob-wrap';

  const volNormRow = document.createElement('div');
  volNormRow.className = 'vol-norm-row';
  volNormRow.append(volumeKnob.element, normalizeButton);

  const volNormLabel = document.createElement('span');
  volNormLabel.className = 'field-label';
  volNormLabel.textContent = 'VOL';

  volNormCluster.append(volNormRow, volNormLabel);

  knobs.append(sensitivityKnob.wrap);
  displayButtons.append(leftButtons, knobs, volNormCluster);

  const programGrid = document.createElement('div');
  programGrid.className = 'program-grid';
  programGrid.setAttribute('role', 'group');
  programGrid.setAttribute('aria-label', 'programs');

  const programButtons: HTMLButtonElement[] = [];
  const programKeys: HTMLDivElement[] = [];
  for (let slot = 0; slot < PROGRAM_BUTTON_COUNT; slot += 1) {
    const key = document.createElement('div');
    key.className = 'program-key';

    const keyLabel = document.createElement('span');
    keyLabel.className = 'program-key-label';
    keyLabel.setAttribute('aria-hidden', 'true');
    keyLabel.textContent = PROGRAM_KEY_LABELS[slot] ?? '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'program-button';
    button.textContent = String(slot + 1);
    button.addEventListener('click', () => {
      if (storeMode) {
        storeTarget = slot;
        refreshPrograms();
        return;
      }
      if (deleteMode) {
        cancelDelete();
      }
      selectProgram(slot);
    });
    programButtons.push(button);
    programKeys.push(key);
    key.append(keyLabel, button);
    programGrid.append(key);
  }
  programGrid.addEventListener(
    'wheel',
    (event) => {
      if (storeMode || event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelStep < 120) {
        return;
      }
      lastWheelStep = now;
      const bank = currentBank();
      if (bank.voices.length < 2) {
        return;
      }
      const delta = event.deltaY > 0 ? 1 : -1;
      selectProgram((program + delta + bank.voices.length) % bank.voices.length);
    },
    { passive: false },
  );

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
    'Using <a href="https://github.com/cmatsuoka/slopsix" rel="noreferrer" target="_blank">libslopsix</a>';

  controls.append(
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
    const canDelete = bank.builtin !== true && banks.length > 1;
    const pending = storeMode || deleteMode;
    removeButton.disabled = !pending && !canDelete;
    removeButton.classList.toggle('lit', deleteMode);
    removeButton.title = storeMode
      ? 'Cancel the pending store'
      : deleteMode
        ? 'Press OK to confirm, or DEL to cancel'
        : 'Delete bank';
    removeButton.setAttribute(
      'aria-label',
      storeMode
        ? 'cancel the pending store'
        : deleteMode
          ? 'confirm or cancel the bank deletion'
          : 'delete bank',
    );
  }

  function refreshPrograms(): void {
    const bank = currentBank();
    programGrid.classList.toggle('store-mode', storeMode);
    programButtons.forEach((button, slot) => {
      const voice = bank.voices[slot];
      programKeys[slot]?.toggleAttribute(
        'hidden',
        !storeMode && voice === undefined,
      );
      if (storeMode) {
        // Every internal memory position is offered, not only the ones the
        // current bank happens to hold.
        button.disabled = false;
        button.title = `internal memory position ${slot + 1}`;
        button.setAttribute('aria-label', `internal memory position ${slot + 1}`);
      } else {
        button.disabled = voice === undefined;
        button.title = voice === undefined ? '' : voice.name;
        button.setAttribute(
          'aria-label',
          voice === undefined
            ? `program ${slot + 1}`
            : `program ${slot + 1}: ${voice.name || 'unnamed'}`,
        );
      }
      button.textContent = String(slot + 1);
      button.classList.toggle('selected', !storeMode && slot === program);
      button.classList.toggle('store-target', storeMode && slot === storeTarget);
      button.setAttribute(
        'aria-pressed',
        storeMode ? String(slot === storeTarget) : String(slot === program),
      );
    });

    const voice = currentVoice();
    // While a store is pending the display shows the internal memory
    // position the patch will be written to, not the sounding program.
    display.setProgram(
      storeMode ? storeTarget + 1 : voice === null ? null : program + 1,
    );
    storeButton.classList.toggle('lit', storeMode);
    storeButton.title = storeMode
      ? 'Press OK to confirm the store'
      : 'Store the voice in the internal memory';
    cancelLcdFlash();
    renderPatchInfo();
    programPrevButton.disabled = !storeMode && bank.voices.length < 2;
    programNextButton.disabled = !storeMode && bank.voices.length < 2;
  }

  /**
   * The bank's name on the first line, and the source prefix, program
   * number, ten-character patch name and engine personality on the second.
   */
  function renderPatchInfo(): void {
    const available = engineType === ENGINE_DX7S;
    normalizeButton.disabled = !available;
    normalizeButton.title = available
      ? 'Normalize the DX7S output gain to the DX7 level'
      : 'Output gain normalization is a DX7S feature';
    normalizeButton.classList.toggle('lit', available && normalizeOutput);
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
      deleteMode
        ? LCD_DELETE_BANK
        : storeMode
          ? LCD_MEMORY_STORE
          : `${prefix}${digits} ${name} ENG ${personality}`,
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

  /**
   * The internal memory is the starter bank: the 32 positions the panel
   * shows as internal voices, like the hardware's own RAM.
   */
  function storeInternalVoice(slot: number, voice: Voice): void {
    storedVoices = storedVoices.slice();
    storedVoices[slot] = voice;
    starter = mergeStoredVoices(starter, storedVoices);
    banks = banks.map((entry) => (entry.id === starter.id ? starter : entry));
    saveInternalMemory(storedVoices);
  }

  /** Ask for the internal memory position the patch will be written to. */
  function beginStore(): void {
    if (currentVoice() === null) {
      showError('There is no voice to store');
      return;
    }
    storeMode = true;
    storeTarget = program;
    refreshBankControls();
    refreshPrograms();
    showNotice(
      'STORE: pick a position, then press OK to confirm or any other button to cancel',
    );
  }

  /** Abandon the pending store; the sounding patch is left alone. */
  function cancelStore(): void {
    if (!storeMode) {
      return;
    }
    storeMode = false;
    refreshBankControls();
    refreshPrograms();
    showNotice('Store cancelled');
  }

  /** Write the sounding patch to the chosen internal memory position. */
  function confirmStore(): void {
    if (!storeMode) {
      showNotice('Press STORE to store the voice or DEL to delete the bank');
      return;
    }
    const voice = currentVoice();
    const slot = storeTarget;
    storeMode = false;
    refreshBankControls();
    if (voice === null) {
      refreshPrograms();
      showError('There is no voice to store');
      return;
    }
    storeInternalVoice(slot, voice);
    // The panel moves to the internal memory and the position that was
    // written becomes the active program.
    selectBank(starter.id);
    selectProgram(slot);
    display.blinkProgram(STORE_BLINK_TIMES);
    showNotice(
      `Stored "${voice.name || 'unnamed'}" in internal memory ${slot + 1}`,
    );
  }

  /** Ask for a confirmation before deleting the selected bank. */
  function beginDelete(): void {
    const bank = currentBank();
    if (bank.builtin === true || banks.length <= 1) {
      return;
    }
    deleteMode = true;
    refreshBankControls();
    renderPatchInfo();
    showNotice(
      `Delete "${bank.name}"? Press OK to confirm or any other button to cancel`,
    );
  }

  /** Abandon the pending delete; the bank is left in the library. */
  function cancelDelete(): void {
    if (!deleteMode) {
      return;
    }
    deleteMode = false;
    refreshBankControls();
    renderPatchInfo();
    showNotice('Delete cancelled');
  }

  /** Delete the selected bank after the confirmation. */
  function confirmDelete(): void {
    if (!deleteMode) {
      return;
    }
    deleteMode = false;
    removeCurrentBank();
  }

  /** Cancel whichever operation is waiting for a confirmation. */
  function cancelPending(): void {
    if (storeMode) {
      cancelStore();
      return;
    }
    if (deleteMode) {
      cancelDelete();
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

  function setNormalizeOutput(on: boolean): void {
    normalizeOutput = on;
    normalizeButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    normalizeButton.classList.toggle('lit', on && engineType === ENGINE_DX7S);
    engine.setDigitalOutputGain(on);
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
    scheduleSensitivitySave(sensitivity);
  }

  function maximumVelocity(): number {
    return engineType === ENGINE_DX7S ? 120 : 108;
  }

  function scaledVelocity(velocity: number): number {
    const input = Math.max(0, Math.min(127, Math.round(velocity)));
    const maxVelocity = maximumVelocity();
    const scaled =
      100 + (input - 100) * sensitivity / MAX_SENSITIVITY;
    return Math.max(0, Math.min(maxVelocity, Math.round(scaled)));
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
    engine.noteOn(note, 100);
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
    onVolume: (value) => {
      setVolume((value / 127) * MAX_VOLUME);
    },
    onSensitivity: (value) => {
      setSensitivity((value / 127) * MAX_SENSITIVITY);
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
    cancelPending();
    stepBank(-1);
  });
  bankNextButton.addEventListener('click', () => {
    cancelPending();
    stepBank(1);
  });
  loadButton.addEventListener('click', () => {
    cancelPending();
    fileInput.click();
  });
  midiConnect.addEventListener('click', () => {
    cancelPending();
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
  normalizeButton.addEventListener('click', () => {
    cancelPending();
    setNormalizeOutput(!normalizeOutput);
  });
  storeButton.addEventListener('click', () => {
    if (storeMode) {
      cancelStore();
      return;
    }
    if (deleteMode) {
      cancelDelete();
      return;
    }
    beginStore();
  });
  okButton.addEventListener('click', () => {
    if (deleteMode) {
      confirmDelete();
      return;
    }
    confirmStore();
  });
  removeButton.addEventListener('click', () => {
    if (storeMode) {
      cancelStore();
      return;
    }
    if (deleteMode) {
      cancelDelete();
      return;
    }
    beginDelete();
  });
  programPrevButton.addEventListener('click', () => {
    if (deleteMode) {
      cancelDelete();
    }
    if (storeMode) {
      const length = starter.voices.length;
      storeTarget = (storeTarget - 1 + length) % length;
      refreshPrograms();
      return;
    }
    const bank = currentBank();
    selectProgram((program - 1 + bank.voices.length) % bank.voices.length);
  });
  programNextButton.addEventListener('click', () => {
    if (deleteMode) {
      cancelDelete();
    }
    if (storeMode) {
      const length = starter.voices.length;
      storeTarget = (storeTarget + 1) % length;
      refreshPrograms();
      return;
    }
    const bank = currentBank();
    selectProgram((program + 1) % bank.voices.length);
  });
  octaveDown.addEventListener('click', () => {
    cancelPending();
    allNotesOff();
    keyboard.setOctave(keyboard.octave - 1);
    buildPiano();
  });
  octaveUp.addEventListener('click', () => {
    cancelPending();
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
  setNormalizeOutput(normalizeOutput);
  const initialBank = freshCurrentBank();
  const initial = initialBank.voices[program] ?? null;
  if (initial !== null) {
    engine.setVoice(initial.data, initial.extensions);
  }

  engine.onReady((version, _dumpSize, readyEngineType) => {
    engineType = readyEngineType;
    renderPatchInfo();
    attribution.innerHTML = `Using <a href="https://github.com/cmatsuoka/slopsix" rel="noreferrer" target="_blank">libslopsix</a> ${formatVersion(version)}`;
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
    cancelSensitivitySave();
  });

  return { showError, showNotice, handleFiles };
}
