/* Rigid-body model of our quadcopter, for software-in-the-loop testing (double precision).
 *
 * Same frames as the flight controller: body FRD, earth NED, the ground at z = 0. The model
 * includes motor lag, rotor thrust and reaction torque, linear drag, turbulence, ground
 * contact and an IMU with noise, bias and motor vibration.
 */
#ifndef QUAD_MODEL_H
#define QUAD_MODEL_H

#include <stdbool.h>
#include <stdint.h>

#define QUAD_MOTORS 4

typedef struct {
    double mass;                /* kg */
    double inertia[3];          /* kg m^2, principal axes */
    double arm;                 /* m, |x| and |y| of each motor from the centre of mass */
    double k_thrust;            /* N per (rad/s)^2 */
    double k_torque;            /* N m per (rad/s)^2 */
    double motor_max_speed;     /* rad/s at full command */
    double motor_tau;           /* s, first-order motor lag */
    double drag_xy, drag_z;     /* N per m/s, body axes (rotor drag + inflow damping) */
    double drag_rot;            /* N m per rad/s */

    double ground_k, ground_c;  /* contact spring and damper */
    double ground_friction;     /* N per m/s, horizontal */
    double ground_level_k;      /* N m per rad: feet hold the drone level */
    double ground_level_c;      /* N m per rad/s */

    double gyro_noise;          /* rad/s, per sample */
    double gyro_bias_max;       /* rad/s, drawn once per run */
    double accel_noise;         /* m/s^2, per sample */
    double gyro_vibration;      /* rad/s amplitude at hover motor speed */
    double accel_vibration;     /* m/s^2 amplitude at hover motor speed */

    double turbulence_torque;   /* N m, standard deviation */
    double turbulence_force;    /* N, standard deviation */
    double turbulence_tau;      /* s, correlation time */
} quad_params_t;

typedef struct {
    double pos[3], vel[3];      /* earth frame, m and m/s */
    double q[4];                /* body -> earth, w x y z */
    double omega[3];            /* body rates, rad/s */
    double motor_speed[QUAD_MOTORS];
    double motor_phase[QUAD_MOTORS];
    double specific_force[3];   /* what an ideal accelerometer reads, body frame */
    bool on_ground;
    bool held;                  /* pinned in place, as if held in a hand */

    double gyro_bias[3];
    double turb_torque[3], turb_force[3];
    double imu_gyro_sum[3], imu_accel_sum[3];
    int imu_count;
    uint64_t rng;
} quad_state_t;

void quad_params_default(quad_params_t *p);

/* Motor command that hovers the drone in still air. */
double quad_hover_throttle(const quad_params_t *p);

/* Starts at rest on the ground, level, at the origin. */
void quad_init(quad_state_t *s, const quad_params_t *p, uint64_t seed);

/* Advances the model by dt seconds with motor commands 0..1 (0 = stopped). */
void quad_step(quad_state_t *s, const quad_params_t *p, const double throttle[QUAD_MOTORS], double dt);

/* IMU samples averaged over the steps since the last read (a crude anti-alias filter, like
 * the one inside the real IMU), plus noise and bias. Resets the average. */
void quad_read_imu(quad_state_t *s, const quad_params_t *p, double gyro[3], double accel[3]);

/* Euler angles (rad) of the true attitude, Z-Y-X order. */
void quad_euler(const quad_state_t *s, double *roll, double *pitch, double *yaw);

#endif
