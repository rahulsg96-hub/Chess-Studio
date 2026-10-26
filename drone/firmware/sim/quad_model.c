#include "quad_model.h"

#include <math.h>
#include <string.h>

#define G 9.80665
#define TWO_PI 6.283185307179586

/* Motor positions (signs of x forward, y right) and spin direction (+1 = clockwise seen from
 * above), in Betaflight's quad-X order: rear right, front right, rear left, front left. */
static const double motor_x[QUAD_MOTORS] = {-1.0, +1.0, -1.0, +1.0};
static const double motor_y[QUAD_MOTORS] = {+1.0, +1.0, -1.0, -1.0};
static const double motor_spin[QUAD_MOTORS] = {+1.0, -1.0, -1.0, +1.0};

void quad_params_default(quad_params_t *p)
{
    /* The full build from analysis/sizing-report.md: 206 g on a 4S 650 mAh pack, 3-inch props
     * on 1404 3800KV motors, ~130 mm motor-to-motor diagonal. The inertia is estimated from
     * where the motor, battery and frame masses sit; a swing test on the real drone replaces
     * it. */
    p->mass = 0.206;
    p->inertia[0] = 1.6e-4;
    p->inertia[1] = 1.8e-4;
    p->inertia[2] = 2.6e-4;
    p->arm = 0.046;
    p->k_thrust = 1.255e-7;         /* C_T = 0.12 for a 3-inch prop, as in sizing.py */
    p->k_torque = 9.3e-10;          /* from hover shaft power at figure of merit 0.45 */
    p->motor_max_speed = 4712.0;    /* 3800 KV x 14.8 V x 0.8 loaded, in rad/s */
    p->motor_tau = 0.02;
    p->drag_xy = 0.10;
    p->drag_z = 0.20;
    p->drag_rot = 2e-5;

    p->ground_k = 200.0;
    p->ground_c = 6.0;
    p->ground_friction = 3.0;
    p->ground_level_k = 0.05;
    p->ground_level_c = 0.003;

    p->gyro_noise = 0.003;
    p->gyro_bias_max = 0.02;
    p->accel_noise = 0.05;
    p->gyro_vibration = 0.15;
    p->accel_vibration = 3.0;

    p->turbulence_torque = 0.002;
    p->turbulence_force = 0.05;
    p->turbulence_tau = 0.3;
}

double quad_hover_throttle(const quad_params_t *p)
{
    double speed = sqrt(p->mass * G / (QUAD_MOTORS * p->k_thrust));
    return speed / p->motor_max_speed;
}

static double rng_uniform(uint64_t *s)
{
    /* xorshift64* */
    *s ^= *s >> 12;
    *s ^= *s << 25;
    *s ^= *s >> 27;
    return (double)((*s * 2685821657736338717ULL) >> 11) * (1.0 / 9007199254740992.0);
}

static double rng_normal(uint64_t *s)
{
    double u1 = rng_uniform(s), u2 = rng_uniform(s);
    if (u1 < 1e-300) {
        u1 = 1e-300;
    }
    return sqrt(-2.0 * log(u1)) * cos(TWO_PI * u2);
}

static void cross(const double a[3], const double b[3], double out[3])
{
    double r[3] = {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
    memcpy(out, r, sizeof r);
}

/* Rotates v by q (body -> earth), or by q's inverse when `inverse` is set. */
static void rotate(const double q[4], const double v[3], double out[3], bool inverse)
{
    double s = inverse ? -1.0 : 1.0;
    double u[3] = {s * q[1], s * q[2], s * q[3]};
    double t[3], ut[3];
    cross(u, v, t);
    for (int i = 0; i < 3; i++) {
        t[i] *= 2.0;
    }
    cross(u, t, ut);
    for (int i = 0; i < 3; i++) {
        out[i] = v[i] + q[0] * t[i] + ut[i];
    }
}

void quad_init(quad_state_t *s, const quad_params_t *p, uint64_t seed)
{
    memset(s, 0, sizeof *s);
    s->q[0] = 1.0;
    s->pos[2] = p->mass * G / p->ground_k;  /* resting on the ground contact spring */
    s->specific_force[2] = -G;
    s->on_ground = true;
    s->rng = seed * 0x9E3779B97F4A7C15ULL + 0x2545F4914F6CDD1DULL;
    for (int i = 0; i < 3; i++) {
        s->gyro_bias[i] = (2.0 * rng_uniform(&s->rng) - 1.0) * p->gyro_bias_max;
    }
}

void quad_step(quad_state_t *s, const quad_params_t *p, const double throttle[QUAD_MOTORS], double dt)
{
    double hover_speed = quad_hover_throttle(p) * p->motor_max_speed;
    double thrust = 0.0;
    double torque[3] = {0.0, 0.0, 0.0};
    double vib_gyro[3] = {0.0, 0.0, 0.0};
    double vib_accel[3] = {0.0, 0.0, 0.0};

    for (int i = 0; i < QUAD_MOTORS; i++) {
        double cmd = throttle[i] < 0.0 ? 0.0 : (throttle[i] > 1.0 ? 1.0 : throttle[i]);
        s->motor_speed[i] += (cmd * p->motor_max_speed - s->motor_speed[i]) * dt / p->motor_tau;
        if (s->motor_speed[i] < 0.0) {
            s->motor_speed[i] = 0.0;
        }
        s->motor_phase[i] = fmod(s->motor_phase[i] + s->motor_speed[i] * dt, TWO_PI);

        double w2 = s->motor_speed[i] * s->motor_speed[i];
        double t = p->k_thrust * w2;
        thrust += t;
        /* r x F with F = (0, 0, -t) at r = (x, y, 0), plus the rotor's reaction torque. */
        torque[0] += -motor_y[i] * p->arm * t;
        torque[1] += motor_x[i] * p->arm * t;
        torque[2] += -motor_spin[i] * p->k_torque * w2;

        /* Prop and motor imbalance shake the frame once per revolution, growing with speed^2. */
        double level = w2 / (hover_speed * hover_speed);
        double ph = s->motor_phase[i];
        vib_gyro[0] += p->gyro_vibration * level * sin(ph);
        vib_gyro[1] += p->gyro_vibration * level * 0.8 * sin(ph + 1.3);
        vib_gyro[2] += p->gyro_vibration * level * 0.5 * sin(ph + 2.1);
        vib_accel[0] += p->accel_vibration * level * 0.6 * sin(ph + 0.7);
        vib_accel[1] += p->accel_vibration * level * 0.6 * sin(ph + 1.9);
        vib_accel[2] += p->accel_vibration * level * sin(ph + 2.6);
    }

    /* Turbulence as an Ornstein-Uhlenbeck process (random but smooth). It only acts in the
     * air: on the ground the feet take it. */
    double decay = dt / p->turbulence_tau;
    double kick = sqrt(2.0 * dt / p->turbulence_tau);
    double airborne = s->on_ground ? 0.0 : 1.0;
    for (int i = 0; i < 3; i++) {
        s->turb_torque[i] += -decay * s->turb_torque[i] + kick * p->turbulence_torque * rng_normal(&s->rng);
        s->turb_force[i] += -decay * s->turb_force[i] + kick * p->turbulence_force * rng_normal(&s->rng);
    }

    double v_body[3];
    rotate(s->q, s->vel, v_body, true);
    double f_body[3] = {
        -p->drag_xy * v_body[0] + airborne * s->turb_force[0],
        -p->drag_xy * v_body[1] + airborne * s->turb_force[1],
        -thrust - p->drag_z * v_body[2] + airborne * s->turb_force[2],
    };
    for (int i = 0; i < 3; i++) {
        torque[i] += airborne * s->turb_torque[i] - p->drag_rot * s->omega[i];
    }

    double f_earth[3];
    rotate(s->q, f_body, f_earth, false);

    s->on_ground = s->pos[2] > 0.0;
    if (s->on_ground) {
        double push = -(p->ground_k * s->pos[2] + p->ground_c * s->vel[2]);
        if (push < 0.0) {
            f_earth[2] += push;  /* the ground only pushes up */
        }
        f_earth[0] -= p->ground_friction * s->vel[0];
        f_earth[1] -= p->ground_friction * s->vel[1];

        /* The feet hold the drone level: torque about (body z) x (earth z). */
        double up[3] = {0.0, 0.0, 1.0}, body_z[3], axis_earth[3], axis_body[3];
        rotate(s->q, up, body_z, false);
        cross(body_z, up, axis_earth);
        rotate(s->q, axis_earth, axis_body, true);
        for (int i = 0; i < 3; i++) {
            torque[i] += p->ground_level_k * axis_body[i] - p->ground_level_c * s->omega[i];
        }
    }

    double sf_earth[3] = {f_earth[0] / p->mass, f_earth[1] / p->mass, f_earth[2] / p->mass};
    rotate(s->q, sf_earth, s->specific_force, true);

    if (s->held) {
        double reaction[3] = {0.0, 0.0, -G};
        memset(s->vel, 0, sizeof s->vel);
        memset(s->omega, 0, sizeof s->omega);
        rotate(s->q, reaction, s->specific_force, true);
    } else {
        for (int i = 0; i < 3; i++) {
            double accel = f_earth[i] / p->mass + (i == 2 ? G : 0.0);
            s->vel[i] += accel * dt;
            s->pos[i] += s->vel[i] * dt;
        }

        /* Euler's equations: I w' = tau - w x (I w) */
        double iw[3] = {p->inertia[0] * s->omega[0], p->inertia[1] * s->omega[1], p->inertia[2] * s->omega[2]};
        double gyroscopic[3];
        cross(s->omega, iw, gyroscopic);
        for (int i = 0; i < 3; i++) {
            s->omega[i] += (torque[i] - gyroscopic[i]) / p->inertia[i] * dt;
        }

        /* q' = 0.5 q (0, w) */
        double wx = s->omega[0], wy = s->omega[1], wz = s->omega[2];
        double *q = s->q;
        double dq[4] = {
            0.5 * (-q[1] * wx - q[2] * wy - q[3] * wz),
            0.5 * (q[0] * wx + q[2] * wz - q[3] * wy),
            0.5 * (q[0] * wy - q[1] * wz + q[3] * wx),
            0.5 * (q[0] * wz + q[1] * wy - q[2] * wx),
        };
        double n = 0.0;
        for (int i = 0; i < 4; i++) {
            q[i] += dq[i] * dt;
            n += q[i] * q[i];
        }
        n = sqrt(n);
        for (int i = 0; i < 4; i++) {
            q[i] /= n;
        }
    }

    for (int i = 0; i < 3; i++) {
        s->imu_gyro_sum[i] += s->omega[i] + vib_gyro[i];
        s->imu_accel_sum[i] += s->specific_force[i] + vib_accel[i];
    }
    s->imu_count++;
}

void quad_read_imu(quad_state_t *s, const quad_params_t *p, double gyro[3], double accel[3])
{
    double n = s->imu_count > 0 ? (double)s->imu_count : 1.0;
    for (int i = 0; i < 3; i++) {
        double g = s->imu_count > 0 ? s->imu_gyro_sum[i] / n : s->omega[i];
        double a = s->imu_count > 0 ? s->imu_accel_sum[i] / n : s->specific_force[i];
        gyro[i] = g + s->gyro_bias[i] + p->gyro_noise * rng_normal(&s->rng);
        accel[i] = a + p->accel_noise * rng_normal(&s->rng);
        s->imu_gyro_sum[i] = s->imu_accel_sum[i] = 0.0;
    }
    s->imu_count = 0;
}

void quad_euler(const quad_state_t *s, double *roll, double *pitch, double *yaw)
{
    const double *q = s->q;
    *roll = atan2(2.0 * (q[0] * q[1] + q[2] * q[3]), 1.0 - 2.0 * (q[1] * q[1] + q[2] * q[2]));
    double sp = 2.0 * (q[0] * q[2] - q[3] * q[1]);
    *pitch = asin(sp > 1.0 ? 1.0 : (sp < -1.0 ? -1.0 : sp));
    *yaw = atan2(2.0 * (q[0] * q[3] + q[1] * q[2]), 1.0 - 2.0 * (q[2] * q[2] + q[3] * q[3]));
}
