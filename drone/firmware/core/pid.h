/* PID controller with derivative on measurement and a clamped integral. */
#ifndef FC_PID_H
#define FC_PID_H

#include "filter.h"

typedef struct {
    float kp, ki, kd;
    float i_limit;      /* largest output the I term may contribute */
} pid_gains_t;

typedef struct {
    float integral;
    float prev_measurement;
    pt1_filter_t dterm_lpf;
} pid_ctrl_t;

void pid_init(pid_ctrl_t *pid, float dterm_cutoff_hz, float dt);
void pid_reset(pid_ctrl_t *pid, float measurement);

/* `i_scale` scales how fast the integral moves: 0 holds it where it is (on the ground, or
 * when the motors are saturated, so it can't wind up), 1 integrates fully, and values in
 * between slow it during fast stick moves (I-term relax). */
float pid_update(pid_ctrl_t *pid, const pid_gains_t *g, float setpoint, float measurement,
                 float dt, float i_scale);

#endif
