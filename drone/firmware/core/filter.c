#include "filter.h"

#include "fc_math.h"

void pt1_init(pt1_filter_t *f, float cutoff_hz, float dt)
{
    float rc = 1.0f / (2.0f * FC_PI * cutoff_hz);
    f->k = dt / (rc + dt);
    f->state = 0.0f;
}

float pt1_apply(pt1_filter_t *f, float input)
{
    f->state += f->k * (input - f->state);
    return f->state;
}

/* Coefficients from the RBJ audio EQ cookbook, normalised by a0. */
static void biquad_set(biquad_t *f, float b0, float b1, float b2, float a0, float a1, float a2)
{
    f->b0 = b0 / a0;
    f->b1 = b1 / a0;
    f->b2 = b2 / a0;
    f->a1 = a1 / a0;
    f->a2 = a2 / a0;
    f->x1 = f->x2 = f->y1 = f->y2 = 0.0f;
}

void biquad_init_lowpass(biquad_t *f, float cutoff_hz, float sample_hz)
{
    float w0 = 2.0f * FC_PI * cutoff_hz / sample_hz;
    float c = cosf(w0);
    float alpha = sinf(w0) / (2.0f * 0.70710678f);
    biquad_set(f, (1.0f - c) * 0.5f, 1.0f - c, (1.0f - c) * 0.5f, 1.0f + alpha, -2.0f * c, 1.0f - alpha);
}

void biquad_init_notch(biquad_t *f, float center_hz, float q, float sample_hz)
{
    float w0 = 2.0f * FC_PI * center_hz / sample_hz;
    float c = cosf(w0);
    float alpha = sinf(w0) / (2.0f * q);
    biquad_set(f, 1.0f, -2.0f * c, 1.0f, 1.0f + alpha, -2.0f * c, 1.0f - alpha);
}

float biquad_apply(biquad_t *f, float input)
{
    float out = f->b0 * input + f->b1 * f->x1 + f->b2 * f->x2 - f->a1 * f->y1 - f->a2 * f->y2;
    f->x2 = f->x1;
    f->x1 = input;
    f->y2 = f->y1;
    f->y1 = out;
    return out;
}
