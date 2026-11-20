/*
 * slopsix_wasm.c - the only place where libslopsix meets the JS boundary.
 *
 * Every exported function is called from the AudioWorklet thread only.
 * The engine owns the sound; the host owns the patch bank and the display.
 */

#include <emscripten/emscripten.h>
#include <stdint.h>

#include "slopsix.h"

#define WASM_EXPORT EMSCRIPTEN_KEEPALIVE

WASM_EXPORT uint32_t six7_version_number(void)
{
    return slopsix_version_number();
}

WASM_EXPORT void *six7_create(uint32_t engine, uint32_t sample_rate)
{
    return slopsix_create_context((slopsix_engine)engine, sample_rate);
}

WASM_EXPORT void six7_destroy(void *ctx)
{
    slopsix_destroy_context(ctx);
}

WASM_EXPORT void six7_reset(void *ctx)
{
    slopsix_reset(ctx);
}

WASM_EXPORT int32_t six7_set_voice(void *ctx, const uint8_t *data,
    int32_t size)
{
    if (size < 0) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    return (int32_t)slopsix_set_voice(ctx, data, (size_t)size);
}

WASM_EXPORT int32_t six7_get_voice(void *ctx, uint8_t *out, int32_t size)
{
    if (size < 0) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    return (int32_t)slopsix_get_voice(ctx, out, (size_t)size);
}

WASM_EXPORT void six7_process(void *ctx, int16_t *stereo_out,
    int32_t frames)
{
    if (frames > 0) {
        slopsix_process(ctx, stereo_out, (size_t)frames);
    }
}

WASM_EXPORT int32_t six7_note_on(void *ctx, int32_t note, int32_t velocity)
{
    if (note < 0 || note > 127) {
        return (int32_t)SLOPSIX_ERR_RANGE;
    }
    if (velocity < 0 || velocity > 127) {
        return (int32_t)SLOPSIX_ERR_RANGE;
    }
    return (int32_t)slopsix_note_on(ctx, (uint8_t)note,
        (uint8_t)velocity);
}

WASM_EXPORT int32_t six7_note_off(void *ctx, int32_t note)
{
    if (note < 0 || note > 127) {
        return (int32_t)SLOPSIX_ERR_RANGE;
    }
    return (int32_t)slopsix_note_off(ctx, (uint8_t)note);
}

WASM_EXPORT int32_t six7_all_notes_off(void *ctx)
{
    return (int32_t)slopsix_all_notes_off(ctx);
}


WASM_EXPORT int32_t six7_set_ctrl_value(void *ctx, int32_t source,
    int32_t value)
{
    if (source < 0 || source >= (int32_t)SLOPSIX_CTRL_SRC_COUNT) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    if (value < 0) {
        value = 0;
    }
    if (value > 127) {
        value = 127;
    }
    return (int32_t)slopsix_set_ctrl_value(ctx,
        (slopsix_ctrl_source)source, (uint8_t)value);
}

WASM_EXPORT int32_t six7_set_ctrl_range(void *ctx, int32_t source,
    int32_t range)
{
    if (source < 0 || source >= (int32_t)SLOPSIX_CTRL_SRC_COUNT) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    if (range < 0) {
        range = 0;
    }
    if (range > 99) {
        range = 99;
    }
    return (int32_t)slopsix_set_ctrl_range(ctx,
        (slopsix_ctrl_source)source, (uint8_t)range);
}

WASM_EXPORT int32_t six7_set_ctrl_assign(void *ctx, int32_t source,
    int32_t flags)
{
    if (source < 0 || source >= (int32_t)SLOPSIX_CTRL_SRC_COUNT) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    if (flags < 0) {
        flags = 0;
    }
    return (int32_t)slopsix_set_ctrl_assign(ctx,
        (slopsix_ctrl_source)source, (unsigned)flags);
}

WASM_EXPORT int32_t six7_set_sustain(void *ctx, int32_t on)
{
    return (int32_t)slopsix_set_sustain(ctx, on != 0);
}

WASM_EXPORT int32_t six7_set_lfo_mode(void *ctx, int32_t mode)
{
    if (mode < 0 || mode > 1) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    return (int32_t)slopsix_set_lfo_mode(ctx, (slopsix_lfo_mode)mode);
}

WASM_EXPORT int32_t six7_set_key_mode(void *ctx, int32_t mode)
{
    if (mode < 0 || mode > 3) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    return (int32_t)slopsix_set_key_mode(ctx, (slopsix_key_mode)mode);
}

WASM_EXPORT int32_t six7_set_unison_detune(void *ctx, int32_t depth)
{
    return (int32_t)slopsix_set_unison_detune(ctx, (uint8_t)depth);
}

WASM_EXPORT int32_t six7_set_peg_range(void *ctx, int32_t range)
{
    if (range < 0 || range > 3) {
        return (int32_t)SLOPSIX_ERR_INVALID;
    }
    return (int32_t)slopsix_set_peg_range(ctx, (slopsix_peg_range)range);
}

WASM_EXPORT int32_t six7_set_peg_velocity(void *ctx, int32_t on)
{
    return (int32_t)slopsix_set_peg_velocity(ctx, on != 0);
}

WASM_EXPORT int32_t six7_set_peg_rate_scaling(void *ctx, int32_t depth)
{
    return (int32_t)slopsix_set_peg_rate_scaling(ctx, (uint8_t)depth);
}

WASM_EXPORT int32_t six7_set_master_volume(void *ctx, int32_t level)
{
    if (level < 0) {
        level = 0;
    }
    return (int32_t)slopsix_set_midi_volume(ctx, (unsigned)level);
}

WASM_EXPORT int32_t six7_set_output_gain(void *ctx, int32_t gain_q16)
{
    if (gain_q16 < 0) {
        gain_q16 = 0;
    }
    if (gain_q16 > 65536) {
        gain_q16 = 65536;
    }
    return (int32_t)slopsix_set_output_gain(ctx, gain_q16);
}

WASM_EXPORT int32_t six7_set_master_tune(void *ctx, int32_t cents_q16)
{
    return (int32_t)slopsix_set_master_tune(ctx, cents_q16);
}

WASM_EXPORT int32_t six7_set_pitch_bend(void *ctx, int32_t bend)
{
    if (bend < 0) {
        bend = 0;
    }
    if (bend > 16383) {
        bend = 16383;
    }
    return (int32_t)slopsix_set_pitch_bend(ctx, (uint16_t)bend);
}

WASM_EXPORT int32_t six7_set_pitch_bend_range(void *ctx, int32_t range,
    int32_t step)
{
    if (range < 0 || range > 12) {
        return (int32_t)SLOPSIX_ERR_RANGE;
    }
    if (step < 0 || step > 15) {
        return (int32_t)SLOPSIX_ERR_RANGE;
    }
    return (int32_t)slopsix_set_pitch_bend_range(ctx, (uint8_t)range,
        (uint8_t)step);
}

WASM_EXPORT int32_t six7_voice_dump_size(void *ctx)
{
    return (int32_t)slopsix_voice_dump_size(ctx);
}

WASM_EXPORT int32_t six7_voice_count(void *ctx)
{
    return (int32_t)slopsix_voice_count(ctx);
}

WASM_EXPORT int32_t six7_context_engine(void *ctx)
{
    return (int32_t)slopsix_context_engine((const slopsix_context)ctx);
}
