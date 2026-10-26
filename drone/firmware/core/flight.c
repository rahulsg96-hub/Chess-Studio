#include "flight.h"

void fc_config_defaults(fc_config_t *cfg)
{
    cfg->loop_hz = 1000.0f;
    cfg->gyro_hz = 2000.0f;
    cfg->gyro_lpf_hz = 120.0f;
    cfg->dterm_lpf_hz = 80.0f;
    cfg->accel_lpf_hz = 20.0f;

    /* Tuned in the simulator for the 206 g build (see sim/quad_model.c). The D term puts a
     * zero near the motors' 20 ms lag, which buys the phase margin for a ~38 rad/s rate loop.
     * The high I gain rejects turbulence; I-term relax stops it overshooting on stick moves.
     * Real-world tuning on the test rig will move these. */
    cfg->rate_gains[FC_AXIS_ROLL] = (pid_gains_t){0.014f, 0.15f, 0.00028f, 0.15f};
    cfg->rate_gains[FC_AXIS_PITCH] = (pid_gains_t){0.016f, 0.17f, 0.00032f, 0.15f};
    cfg->rate_gains[FC_AXIS_YAW] = (pid_gains_t){0.06f, 0.3f, 0.0f, 0.15f};
    cfg->acro_max_rate[FC_AXIS_ROLL] = 400.0f * FC_DEG2RAD;
    cfg->acro_max_rate[FC_AXIS_PITCH] = 400.0f * FC_DEG2RAD;
    cfg->acro_max_rate[FC_AXIS_YAW] = 300.0f * FC_DEG2RAD;

    cfg->angle_kp = 10.0f;
    cfg->angle_max = 40.0f * FC_DEG2RAD;
    cfg->angle_rate_limit = 300.0f * FC_DEG2RAD;
    cfg->angle_yaw_rate = 150.0f * FC_DEG2RAD;

    cfg->motor_idle = 0.04f;
    cfg->iterm_throttle_min = 0.15f;
    cfg->iterm_relax_hz = 15.0f;
    cfg->iterm_relax_threshold = 40.0f * FC_DEG2RAD;

    cfg->arm_throttle_max = 0.05f;
    cfg->arm_tilt_max = 25.0f * FC_DEG2RAD;
    cfg->gyro_cal_time = 1.0f;
    cfg->gyro_cal_motion_max = 0.05f;

    cfg->ahrs_kp_boot = 2.0f;
    cfg->ahrs_kp_flight = 0.2f;
    cfg->ahrs_ki = 0.01f;

    cfg->failsafe_delay = 0.5f;          /* REQ-S4 */
    cfg->failsafe_land_delay = 3.0f;     /* REQ-S4 */
    cfg->failsafe_throttle = 0.37f;      /* set from the measured hover throttle in Block 0 */
    cfg->failsafe_land_timeout = 20.0f;
    cfg->landing_impact_g = 1.5f;
}

void fc_init(fc_t *fc, const fc_config_t *cfg)
{
    *fc = (fc_t){0};
    fc->cfg = *cfg;
    float dt = 1.0f / cfg->loop_hz;

    for (int i = 0; i < 3; i++) {
        biquad_init_lowpass(&fc->gyro_lpf[i], cfg->gyro_lpf_hz, cfg->gyro_hz);
        pt1_init(&fc->accel_lpf[i], cfg->accel_lpf_hz, dt);
        pid_init(&fc->rate_pid[i], cfg->dterm_lpf_hz, dt);
        pt1_init(&fc->setpoint_lpf[i], cfg->iterm_relax_hz, dt);
    }
    mahony_init(&fc->ahrs, cfg->ahrs_kp_boot, cfg->ahrs_ki);

    /* A switch that is already on at power-up must be cycled before it can arm. */
    fc->arm_switch_prev = true;
}

static float v3_axis(vec3_t v, int axis)
{
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}

void fc_gyro_sample(fc_t *fc, vec3_t raw)
{
    const fc_config_t *cfg = &fc->cfg;

    if (!fc->gyro_calibrated) {
        /* Average the gyro while the drone is still; any movement starts the average again. */
        bool moved = false;
        if (fc->gyro_cal_count > 0) {
            vec3_t mean = v3_scale(fc->gyro_cal_sum, 1.0f / (float)fc->gyro_cal_count);
            vec3_t d = v3_sub(raw, mean);
            moved = fabsf(d.x) > cfg->gyro_cal_motion_max || fabsf(d.y) > cfg->gyro_cal_motion_max ||
                    fabsf(d.z) > cfg->gyro_cal_motion_max;
        }
        if (moved) {
            fc->gyro_cal_sum = v3(0.0f, 0.0f, 0.0f);
            fc->gyro_cal_count = 0;
        } else {
            fc->gyro_cal_sum = v3_add(fc->gyro_cal_sum, raw);
            fc->gyro_cal_count++;
            if ((float)fc->gyro_cal_count >= cfg->gyro_cal_time * cfg->gyro_hz) {
                fc->gyro_bias = v3_scale(fc->gyro_cal_sum, 1.0f / (float)fc->gyro_cal_count);
                fc->gyro_calibrated = true;
            }
        }
    }

    vec3_t g = v3_sub(raw, fc->gyro_bias);
    fc->gyro = v3(biquad_apply(&fc->gyro_lpf[0], g.x), biquad_apply(&fc->gyro_lpf[1], g.y),
                  biquad_apply(&fc->gyro_lpf[2], g.z));
}

static void fc_arm(fc_t *fc)
{
    fc->armed = true;
    fc->failsafe = FC_FAILSAFE_IDLE;
    for (int i = 0; i < 3; i++) {
        pid_reset(&fc->rate_pid[i], v3_axis(fc->gyro, i));
        fc->setpoint_lpf[i].state = 0.0f;
    }
}

static void fc_disarm(fc_t *fc)
{
    fc->armed = false;
    fc->failsafe = FC_FAILSAFE_IDLE;
    fc->landing_time = 0.0f;
}

static void update_failsafe(fc_t *fc, const fc_inputs_t *in, float dt)
{
    const fc_config_t *cfg = &fc->cfg;

    if (in->rc_link_ok) {
        fc->rc_lost_time = 0.0f;
        fc->throttle_low_time = in->rc_throttle < cfg->arm_throttle_max ? fc->throttle_low_time + dt : 0.0f;
    } else {
        fc->rc_lost_time += dt;
    }

    if (!fc->armed) {
        fc->failsafe = FC_FAILSAFE_IDLE;
        return;
    }

    switch (fc->failsafe) {
    case FC_FAILSAFE_IDLE:
        if (fc->rc_lost_time >= cfg->failsafe_delay) {
            /* Throttle was at zero for a while before the link went: we're on the ground, so
             * don't spin up to failsafe throttle and risk a take-off. */
            if (fc->throttle_low_time > 1.0f) {
                fc_disarm(fc);
            } else {
                fc->failsafe = FC_FAILSAFE_STAGE1;
            }
        }
        break;
    case FC_FAILSAFE_STAGE1:
        if (in->rc_link_ok) {
            fc->failsafe = FC_FAILSAFE_IDLE;
        } else if (fc->rc_lost_time >= cfg->failsafe_land_delay) {
            fc->failsafe = FC_FAILSAFE_LANDING;
            fc->landing_time = 0.0f;
        }
        break;
    case FC_FAILSAFE_LANDING:
        /* Latched until disarm: a link that comes back now doesn't hand control back. */
        fc->landing_time += dt;
        if (v3_norm(fc->accel) > cfg->landing_impact_g * FC_GRAVITY ||
            fc->landing_time > cfg->failsafe_land_timeout) {
            fc_disarm(fc);
        }
        break;
    }
}

static void update_arming(fc_t *fc, const fc_inputs_t *in)
{
    const fc_config_t *cfg = &fc->cfg;
    uint32_t blocked = 0;

    if (!fc->gyro_calibrated) {
        blocked |= FC_ARMING_BLOCKED_GYRO_CAL;
    }
    if (!in->gyro_ok) {
        blocked |= FC_ARMING_BLOCKED_GYRO_FAIL;
    }
    if (!in->rc_link_ok) {
        blocked |= FC_ARMING_BLOCKED_RC_LINK;
    }
    if (in->rc_throttle > cfg->arm_throttle_max) {
        blocked |= FC_ARMING_BLOCKED_THROTTLE;
    }
    if (quat_tilt(fc->ahrs.q) > cfg->arm_tilt_max) {
        blocked |= FC_ARMING_BLOCKED_ANGLE;
    }

    if (in->rc_link_ok) {
        bool on = in->rc_arm;
        if (fc->armed && !on) {
            fc_disarm(fc);  /* kill switch: REQ-S2 */
        } else if (!fc->armed && on && !fc->arm_switch_prev && blocked == 0) {
            fc_arm(fc);     /* only on the switch's rising edge: REQ-S1 */
        }
        fc->arm_switch_prev = on;
        if (!fc->armed && on) {
            blocked |= FC_ARMING_BLOCKED_SWITCH;
        }
    }
    fc->arming_blocked = blocked;
}

static vec3_t angle_rate_setpoint(fc_t *fc, float roll_stick, float pitch_stick, float yaw_stick)
{
    const fc_config_t *cfg = &fc->cfg;
    float roll, pitch, yaw;
    quat_to_euler(fc->ahrs.q, &roll, &pitch, &yaw);

    /* Target tilt from the sticks, keeping the current heading. The error quaternion is the
     * body-frame rotation from where we are to where we want to be. */
    quat_t target = quat_from_euler(roll_stick * cfg->angle_max, -pitch_stick * cfg->angle_max, yaw);
    quat_t err = quat_mul(quat_conj(fc->ahrs.q), target);
    float sign = err.w < 0.0f ? -1.0f : 1.0f;

    float k = 2.0f * cfg->angle_kp * sign;
    float lim = cfg->angle_rate_limit;
    return v3(fc_clampf(k * err.x, -lim, lim), fc_clampf(k * err.y, -lim, lim),
              yaw_stick * cfg->angle_yaw_rate);
}

void fc_update(fc_t *fc, const fc_inputs_t *in, float motor_out[FC_MOTOR_COUNT])
{
    const fc_config_t *cfg = &fc->cfg;
    float dt = 1.0f / cfg->loop_hz;

    if (!fc->ahrs_seeded) {
        mahony_reset_to_accel(&fc->ahrs, in->accel);
        fc->accel_lpf[0].state = in->accel.x;
        fc->accel_lpf[1].state = in->accel.y;
        fc->accel_lpf[2].state = in->accel.z;
        fc->ahrs_seeded = true;
    }
    fc->accel = v3(pt1_apply(&fc->accel_lpf[0], in->accel.x), pt1_apply(&fc->accel_lpf[1], in->accel.y),
                   pt1_apply(&fc->accel_lpf[2], in->accel.z));
    fc->ahrs.kp = fc->armed ? cfg->ahrs_kp_flight : cfg->ahrs_kp_boot;
    mahony_update(&fc->ahrs, fc->gyro, fc->accel, dt);

    update_failsafe(fc, in, dt);
    update_arming(fc, in);

    if (!fc->armed) {
        for (int i = 0; i < 3; i++) {
            pid_reset(&fc->rate_pid[i], v3_axis(fc->gyro, i));
        }
        fc->rate_setpoint = fc->torque = v3(0.0f, 0.0f, 0.0f);
        fc->collective = 0.0f;
        fc->saturated = false;
        for (int i = 0; i < FC_MOTOR_COUNT; i++) {
            fc->motor[i] = motor_out[i] = 0.0f;
        }
        return;
    }

    float roll = in->rc_roll, pitch = in->rc_pitch, yaw = in->rc_yaw, throttle = in->rc_throttle;
    fc_flight_mode_t mode = in->rc_mode;
    if (fc->failsafe != FC_FAILSAFE_IDLE) {
        roll = pitch = yaw = 0.0f;
        throttle = cfg->failsafe_throttle;
        mode = FC_MODE_ANGLE;
    }

    if (mode == FC_MODE_ANGLE) {
        fc->rate_setpoint = angle_rate_setpoint(fc, roll, pitch, yaw);
    } else {
        fc->rate_setpoint = v3(roll * cfg->acro_max_rate[FC_AXIS_ROLL],
                               -pitch * cfg->acro_max_rate[FC_AXIS_PITCH],
                               yaw * cfg->acro_max_rate[FC_AXIS_YAW]);
    }

    fc->collective = throttle;
    bool integrate = throttle > cfg->iterm_throttle_min && !fc->saturated;
    float torque[3];
    for (int i = 0; i < 3; i++) {
        /* I-term relax: during a fast stick move the rate error is the loop catching up, not a
         * disturbance, so the integral mostly sits it out instead of winding up. */
        float sp = v3_axis(fc->rate_setpoint, i);
        float moving = fabsf(sp - pt1_apply(&fc->setpoint_lpf[i], sp));
        float relax = fc_clampf(1.0f - moving / cfg->iterm_relax_threshold, 0.0f, 1.0f);
        torque[i] = pid_update(&fc->rate_pid[i], &cfg->rate_gains[i], sp, v3_axis(fc->gyro, i), dt,
                               integrate ? relax : 0.0f);
    }
    fc->torque = v3(torque[0], torque[1], torque[2]);
    fc->saturated = mixer_mix(fc->collective, fc->torque, cfg->motor_idle, fc->motor);
    for (int i = 0; i < FC_MOTOR_COUNT; i++) {
        motor_out[i] = fc->motor[i];
    }
}
