# Six7

Six7 is a browser-based synthesizer built as a test interface for
[libslopsix](https://github.com/cmatsuoka/slopsix), a dependency-free,
integer-only, fixed-point FM engine compiled to WebAssembly. Itplays
standard DX7 programs and an experimental DX7S mode is included.

## Running

```sh
npm install
npm run build:wasm         # fetch/copy and compile libslopsix
npm run build:wasm:debug   # same, with runtime assertions
npm run dev                # Vite dev server
```

For another machine on the LAN, the AudioWorklet needs a secure
context, so use the HTTPS dev server:

```sh
npm run dev:secure
```

## SYSEX formats

- 32-voice bulk dump: `F0 43 00 09 20 00`, 4096 data bytes
  (32 × 128 packed voices), checksum, `F7`.
- Single voice dump: `F0 43 00 00 01 1B`, 155 data bytes, checksum, `F7`.

The packed voice is unpacked into the engine's 156-byte dump, and the patch
name comes from the voice data itself (offsets 145…154 of the unpacked
form). The checksum is checked; a mismatch shows `CHECK SUM ERROR!` on the
LCD but does not corrupt the data. A file with no readable dump shows
`MIDI DATA ERROR!`, and a bank that was read shows ` MIDI RECEIVED`, the
same transient messages the firmware uses.

## Storing a voice

The panel has 32 internal memory positions, the ones the bank list shows
as internal voices. Press **STORE** to store the sounding patch: the
program display then shows the internal memory position the patch will be
written to, the program buttons pick that position, and a second **STORE**
press writes the patch there. The panel then moves to the internal
memory and the position that was written becomes the active program. Any
button other than the program buttons cancels the pending store. The
internal memory is kept across reloads, in the browser's local storage;
the positions that were never written to keep the initial voices.

## Build details

```sh
npm run build        # production build (runs build:wasm first)
npm run typecheck    # tsc --noEmit
npm run test:sysex   # node check of the SYSEX parser
npm run test:storage # node check of the internal memory store
npm run smoke        # node smoke test of the built engine
```

`scripts/build-wasm.sh` uses the sibling checkout `../slopsix` when it is
present and otherwise fetches a pinned commit. The sources the build
compiles are a copy in `vendor/libslopsix`; the source tree is never
written to. Point `SLOPSIX_SOURCE` at another checkout to build that. The
library is never patched here.
