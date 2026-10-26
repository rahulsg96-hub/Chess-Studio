#include "pid.h"

#include "fc_math.h"

void pid_init(pid_ctrl_t *pid, float dterm_cutoff_hz, float dt)
{
    pt1_init(&pid->dterm_lpf, dterm_cutoff_hz, dt);
    pid_reset(pid, 0.0f);
}

void pid_reset(pid_ctrl_t *pid, float measurement)
{
    pid->integral = 0.0f;
    pid->prev_measurement = measurement;
    pid->dterm_lpf.state = 0.0f;
}

float pid_update(pid_ctrl_t *pid, const pid_gains_t *g, float setpoint, float measurement,
                 float dt, float i_scale)
{
    float error = setpoint - measurement;

    if (i_scale > 0.0f && g->ki > 0.0f) {
        float limit = g->i_limit / g->ki;
        pid->integral = fc_clampf(pid->integral + error * i_scale * dt, -limit, limit);
    }

    /* Derivative of the measurement, not the error, so setpoint steps don't kick the output. */
    float derivative = pt1_apply(&pid->dterm_lpf, -(measurement - pid->prev_measurement) / dt);
    pid->prev_measurement = measurement;

    return g->kp * error + g->ki * pid->integral + g->kd * derivative;
}
