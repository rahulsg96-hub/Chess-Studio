#include "mixer.h"

/* Roll right: speed up the left motors. Pitch up: speed up the front motors.
 * Yaw right: speed up the counter-clockwise motors, whose reaction torque turns the body
 * clockwise. */
const mixer_rule_t fc_mixer_quad_x[FC_MOTOR_COUNT] = {
    {-1.0f, -1.0f, -1.0f},  /* 1: rear right, CW */
    {-1.0f, +1.0f, +1.0f},  /* 2: front right, CCW */
    {+1.0f, -1.0f, +1.0f},  /* 3: rear left, CCW */
    {+1.0f, +1.0f, -1.0f},  /* 4: front left, CW */
};

bool mixer_mix(float collective, vec3_t torque, float idle, float motor[FC_MOTOR_COUNT])
{
    float delta[FC_MOTOR_COUNT];
    float lo = 0.0f, hi = 0.0f;

    for (int i = 0; i < FC_MOTOR_COUNT; i++) {
        const mixer_rule_t *r = &fc_mixer_quad_x[i];
        delta[i] = r->roll * torque.x + r->pitch * torque.y + r->yaw * torque.z;
        lo = i == 0 || delta[i] < lo ? delta[i] : lo;
        hi = i == 0 || delta[i] > hi ? delta[i] : hi;
    }

    bool saturated = false;
    float span = hi - lo;
    float room = 1.0f - idle;
    if (span > room) {
        float scale = room / span;
        for (int i = 0; i < FC_MOTOR_COUNT; i++) {
            delta[i] *= scale;
        }
        lo *= scale;
        hi *= scale;
        saturated = true;
    }

    /* Shift the collective so every motor stays inside [idle, 1]. */
    collective = fc_clampf(collective, idle - lo, 1.0f - hi);
    for (int i = 0; i < FC_MOTOR_COUNT; i++) {
        motor[i] = fc_clampf(collective + delta[i], idle, 1.0f);
    }
    return saturated;
}
