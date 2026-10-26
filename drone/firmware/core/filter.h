/* Digital filters used on the gyro, D-term and accelerometer paths. */
#ifndef FC_FILTER_H
#define FC_FILTER_H

/* First-order low-pass (an RC filter). */
typedef struct {
    float k;
    float state;
} pt1_filter_t;

void pt1_init(pt1_filter_t *f, float cutoff_hz, float dt);
float pt1_apply(pt1_filter_t *f, float input);

/* Second-order section, direct form 1. */
typedef struct {
    float b0, b1, b2, a1, a2;
    float x1, x2, y1, y2;
} biquad_t;

/* Butterworth low-pass (Q = 1/sqrt(2)). */
void biquad_init_lowpass(biquad_t *f, float cutoff_hz, float sample_hz);
void biquad_init_notch(biquad_t *f, float center_hz, float q, float sample_hz);
float biquad_apply(biquad_t *f, float input);

#endif
