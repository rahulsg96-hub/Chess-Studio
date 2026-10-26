/* The flight controller: gyro filtering, attitude estimation, arming, failsafe, the angle and
 * rate loops and the mixer. Hardware-free: the caller feeds sensor samples and RC input in,
 * and gets motor commands out.
 *
 * Call fc_gyro_sample() at cfg.gyro_hz with each new gyro reading, and fc_update() at
 * cfg.loop_hz with the latest accelerometer reading and RC state.
 */
#ifndef FC_FLIGHT_H
#define FC_FLIGHT_H

#include <stdbool.h>
#include <stdint.h>

#include "fc_math.h"
#include "filter.h"
#include "mahony.h"
#include "mixer.h"
#include "pid.h"

typedef enum {
    FC_MODE_ACRO = 0,   /* sticks command rotation rates */
    FC_MODE_ANGLE = 1,  /* sticks command tilt angles; centred sticks level the drone */
} fc_flight_mode_t;

typedef enum {
    FC_FAILSAFE_IDLE = 0,
    FC_FAILSAFE_STAGE1 = 1,   /* link lost briefly: level out, recover if the link returns */
    FC_FAILSAFE_LANDING = 2,  /* link lost for good: descend and disarm on touchdown */
} fc_failsafe_state_t;

/* Why arming is refused (bit flags). */
enum {
    FC_ARMING_BLOCKED_GYRO_CAL = 1u << 0,   /* gyro still calibrating */
    FC_ARMING_BLOCKED_GYRO_FAIL = 1u << 1,  /* gyro reports a fault */
    FC_ARMING_BLOCKED_RC_LINK = 1u << 2,
    FC_ARMING_BLOCKED_THROTTLE = 1u << 3,   /* throttle not low */
    FC_ARMING_BLOCKED_ANGLE = 1u << 4,      /* tilted too far */
    FC_ARMING_BLOCKED_SWITCH = 1u << 5,     /* arm switch is on: cycle it off and on to arm */
};

enum { FC_AXIS_ROLL = 0, FC_AXIS_PITCH = 1, FC_AXIS_YAW = 2 };

typedef struct {
    float loop_hz;              /* fc_update() rate */
    float gyro_hz;              /* fc_gyro_sample() rate */
    float gyro_lpf_hz;
    float dterm_lpf_hz;
    float accel_lpf_hz;

    pid_gains_t rate_gains[3];  /* roll, pitch, yaw; output in motor-command units per rad/s */
    float acro_max_rate[3];     /* rad/s at full stick in ACRO */

    float angle_kp;             /* rad/s of rate setpoint per rad of angle error */
    float angle_max;            /* rad of tilt at full stick in ANGLE */
    float angle_rate_limit;     /* rad/s */
    float angle_yaw_rate;       /* rad/s at full yaw stick in ANGLE */

    float motor_idle;           /* motor command while armed at zero throttle */
    float iterm_throttle_min;   /* integrate only above this collective (i.e. airborne) */
    float iterm_relax_hz;       /* I-term relax: the integral slows while the rate setpoint */
    float iterm_relax_threshold;/* moves away from its low-passed value by up to this, rad/s */

    float arm_throttle_max;
    float arm_tilt_max;         /* rad */
    float gyro_cal_time;        /* s the drone must be still at boot */
    float gyro_cal_motion_max;  /* rad/s; more motion than this restarts calibration */

    float ahrs_kp_boot, ahrs_kp_flight, ahrs_ki;

    float failsafe_delay;       /* s without RC before stage 1 */
    float failsafe_land_delay;  /* s without RC before landing */
    float failsafe_throttle;    /* collective during failsafe: a little below hover */
    float failsafe_land_timeout;/* s of landing before disarming regardless */
    float landing_impact_g;     /* filtered accel magnitude that counts as touchdown */
} fc_config_t;

typedef struct {
    bool rc_link_ok;            /* a valid RC frame arrived recently */
    float rc_roll;              /* -1..1, right positive */
    float rc_pitch;             /* -1..1, stick forward positive (nose down) */
    float rc_yaw;               /* -1..1, right positive */
    float rc_throttle;          /* 0..1 */
    bool rc_arm;                /* arm switch; off is the kill switch */
    fc_flight_mode_t rc_mode;
    vec3_t accel;               /* m/s^2, body frame */
    bool gyro_ok;
} fc_inputs_t;

typedef struct {
    fc_config_t cfg;

    biquad_t gyro_lpf[3];
    vec3_t gyro_bias;
    vec3_t gyro_cal_sum;
    uint32_t gyro_cal_count;
    bool gyro_calibrated;
    vec3_t gyro;                /* bias-removed and filtered, rad/s */

    pt1_filter_t accel_lpf[3];
    vec3_t accel;               /* filtered, m/s^2 */
    bool ahrs_seeded;
    mahony_t ahrs;

    pid_ctrl_t rate_pid[3];
    pt1_filter_t setpoint_lpf[3];

    bool armed;
    bool arm_switch_prev;
    uint32_t arming_blocked;    /* FC_ARMING_BLOCKED_* flags from the last update */
    fc_failsafe_state_t failsafe;
    float rc_lost_time;
    float throttle_low_time;    /* how long the pilot's throttle has been at zero */
    float landing_time;

    /* Last loop's internals, for logging. */
    vec3_t rate_setpoint;
    vec3_t torque;
    float collective;
    bool saturated;
    float motor[FC_MOTOR_COUNT];
} fc_t;

void fc_config_defaults(fc_config_t *cfg);
void fc_init(fc_t *fc, const fc_config_t *cfg);
void fc_gyro_sample(fc_t *fc, vec3_t gyro_raw);
void fc_update(fc_t *fc, const fc_inputs_t *in, float motor_out[FC_MOTOR_COUNT]);

#endif
