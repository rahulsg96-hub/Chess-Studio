#include "sim.h"

#include <math.h>
#include <string.h>

/* --- Pilot building blocks ------------------------------------------------------------- */

static double altitude(const quad_state_t *s)
{
    return -s->pos[2];
}

/* A steady pilot holds height by eye: throttle around hover, corrected for height and climb
 * rate. This is the pilot's skill, not a flight-controller feature. */
static double hold_altitude(const quad_state_t *s, const quad_params_t *p, double target)
{
    double climb = -s->vel[2];
    double throttle = quad_hover_throttle(p) + 0.08 * (target - altitude(s)) - 0.08 * climb;
    return throttle < 0.0 ? 0.0 : (throttle > 1.0 ? 1.0 : throttle);
}

/* Gyro calibrates for the first second; arm at 1.5 s, lift off at 2 s and hold `target`. */
static void take_off_and_hover(double t, const quad_state_t *s, const quad_params_t *p, double target,
                               rc_command_t *rc)
{
    memset(rc, 0, sizeof *rc);
    rc->link_ok = true;
    rc->mode = FC_MODE_ANGLE;
    rc->arm = t >= 1.5;
    rc->throttle = t >= 2.0 ? hold_altitude(s, p, target) : 0.0;
}

static bool between(double t, double from, double to)
{
    return t >= from && t < to;
}

/* --- Scenarios ------------------------------------------------------------------------- */

static void pilot_hover(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    take_off_and_hover(t, s, p, 2.0, rc);
}

/* Step tests fly in light air, so the response isn't hidden in turbulence. */
static void setup_light_air(quad_params_t *p, quad_state_t *s, fc_config_t *cfg)
{
    (void)s;
    (void)cfg;
    p->turbulence_torque *= 0.25;
    p->turbulence_force *= 0.25;
}

static void pilot_angle_step(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    take_off_and_hover(t, s, p, 2.0, rc);
    if (between(t, 8.0, 9.5)) {
        rc->roll = 0.5;     /* 20 degrees right */
    }
    if (between(t, 11.0, 12.5)) {
        rc->pitch = -0.5;   /* stick back: 20 degrees nose up */
    }
}

static void pilot_acro_step(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    take_off_and_hover(t, s, p, 2.0, rc);
    if (t >= 7.9 && t < 9.0) {
        rc->mode = FC_MODE_ACRO;
        if (between(t, 8.0, 8.25)) {
            rc->roll = 0.5;     /* 200 deg/s for 0.25 s: 50 degrees right... */
        } else if (between(t, 8.25, 8.5)) {
            rc->roll = -0.5;    /* ...and back */
        }
    }
}

static void pilot_kill(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    take_off_and_hover(t, s, p, 2.0, rc);
    if (t >= 8.0) {
        rc->arm = false;
    }
}

static void pilot_link_loss(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    take_off_and_hover(t, s, p, 3.0, rc);
    if (t >= 8.0) {
        rc->link_ok = false;
    }
}

static void pilot_link_blips(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    take_off_and_hover(t, s, p, 2.0, rc);
    if (between(t, 8.0, 8.3) || between(t, 10.0, 11.0)) {
        rc->link_ok = false;
    }
}

static void pilot_ground_link_loss(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    (void)s;
    (void)p;
    memset(rc, 0, sizeof *rc);
    rc->link_ok = t < 5.0;
    rc->mode = FC_MODE_ANGLE;
    rc->arm = t >= 1.5;     /* armed, idling on the ground, throttle at zero */
}

static void pilot_switch_on_at_boot(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    (void)t;
    (void)s;
    (void)p;
    memset(rc, 0, sizeof *rc);
    rc->link_ok = true;
    rc->mode = FC_MODE_ANGLE;
    rc->arm = true;
}

static void setup_tilted(quad_params_t *p, quad_state_t *s, fc_config_t *cfg)
{
    (void)p;
    (void)cfg;
    /* Held in a hand, rolled 30 degrees. */
    double half = 0.5 * 30.0 * 3.14159265358979 / 180.0;
    s->q[0] = cos(half);
    s->q[1] = sin(half);
    s->held = true;
}

static void pilot_arm_attempt(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc)
{
    (void)s;
    (void)p;
    memset(rc, 0, sizeof *rc);
    rc->link_ok = true;
    rc->mode = FC_MODE_ANGLE;
    rc->arm = t >= 1.5;
}

const sim_scenario_t sim_scenarios[] = {
    {"hover", "Take off, hover at 2 m in ANGLE mode with turbulence", 20.0, NULL, pilot_hover},
    {"angle_step", "Hover, then 20-degree roll and pitch stick steps in ANGLE mode (light air)", 15.0,
     setup_light_air, pilot_angle_step},
    {"acro_step", "Hover, then a 200 deg/s roll there and back in ACRO mode (light air)", 12.0,
     setup_light_air, pilot_acro_step},
    {"kill", "Hover, then flip the arm switch off", 10.0, NULL, pilot_kill},
    {"link_loss", "Hover at 3 m, then lose the RC link for good", 25.0, NULL, pilot_link_loss},
    {"link_blips", "Hover, lose the link for 0.3 s and then for 1 s", 14.0, NULL, pilot_link_blips},
    {"ground_link_loss", "Armed on the ground at zero throttle, then lose the link", 8.0, NULL,
     pilot_ground_link_loss},
    {"switch_on_at_boot", "Power up with the arm switch already on", 5.0, NULL, pilot_switch_on_at_boot},
    {"tilted_arm", "Try to arm while held at 30 degrees of roll", 5.0, setup_tilted, pilot_arm_attempt},
};
const int sim_scenario_count = (int)(sizeof sim_scenarios / sizeof sim_scenarios[0]);

const sim_scenario_t *sim_find_scenario(const char *name)
{
    for (int i = 0; i < sim_scenario_count; i++) {
        if (strcmp(sim_scenarios[i].name, name) == 0) {
            return &sim_scenarios[i];
        }
    }
    return NULL;
}

/* --- Runner ----------------------------------------------------------------------------- */

void sim_run(const sim_scenario_t *sc, uint64_t seed, sim_sample_fn fn, void *ctx)
{
    quad_params_t p;
    quad_state_t s;
    fc_config_t cfg;
    fc_t fc;

    quad_params_default(&p);
    quad_init(&s, &p, seed);
    fc_config_defaults(&cfg);
    /* In Block 0 we read the real hover throttle from Betaflight logs; here we know it. */
    cfg.failsafe_throttle = (float)(quad_hover_throttle(&p) - 0.02);
    if (sc->setup) {
        sc->setup(&p, &s, &cfg);
    }
    fc_init(&fc, &cfg);

    const int gyro_div = SIM_PHYSICS_HZ / (int)cfg.gyro_hz;
    const int loop_div = SIM_PHYSICS_HZ / (int)cfg.loop_hz;
    const double dt = 1.0 / SIM_PHYSICS_HZ;
    const long steps = (long)(sc->duration * SIM_PHYSICS_HZ);

    double throttle[QUAD_MOTORS] = {0.0};
    double gyro[3], accel[3] = {0.0, 0.0, -9.80665};
    rc_command_t rc;
    memset(&rc, 0, sizeof rc);

    for (long k = 1; k <= steps; k++) {
        quad_step(&s, &p, throttle, dt);

        if (k % gyro_div == 0) {
            quad_read_imu(&s, &p, gyro, accel);
            fc_gyro_sample(&fc, v3((float)gyro[0], (float)gyro[1], (float)gyro[2]));
        }
        if (k % loop_div != 0) {
            continue;
        }

        double t = (double)k * dt;
        sc->pilot(t, &s, &p, &rc);
        fc_inputs_t in = {
            .rc_link_ok = rc.link_ok,
            .rc_roll = (float)rc.roll,
            .rc_pitch = (float)rc.pitch,
            .rc_yaw = (float)rc.yaw,
            .rc_throttle = (float)rc.throttle,
            .rc_arm = rc.arm,
            .rc_mode = rc.mode,
            .accel = v3((float)accel[0], (float)accel[1], (float)accel[2]),
            .gyro_ok = true,
        };
        float out[FC_MOTOR_COUNT];
        fc_update(&fc, &in, out);
        for (int i = 0; i < QUAD_MOTORS; i++) {
            throttle[i] = out[i];
        }

        sim_sample_t sm;
        memset(&sm, 0, sizeof sm);
        sm.t = t;
        memcpy(sm.pos, s.pos, sizeof sm.pos);
        memcpy(sm.vel, s.vel, sizeof sm.vel);
        memcpy(sm.omega, s.omega, sizeof sm.omega);
        quad_euler(&s, &sm.roll, &sm.pitch, &sm.yaw);
        float er, ep, ey;
        quat_to_euler(fc.ahrs.q, &er, &ep, &ey);
        sm.est_roll = er;
        sm.est_pitch = ep;
        sm.est_yaw = ey;
        sm.gyro[0] = fc.gyro.x;
        sm.gyro[1] = fc.gyro.y;
        sm.gyro[2] = fc.gyro.z;
        sm.rate_sp[0] = fc.rate_setpoint.x;
        sm.rate_sp[1] = fc.rate_setpoint.y;
        sm.rate_sp[2] = fc.rate_setpoint.z;
        for (int i = 0; i < QUAD_MOTORS; i++) {
            sm.motor_cmd[i] = throttle[i];
        }
        sm.armed = fc.armed;
        sm.on_ground = s.on_ground;
        sm.failsafe = fc.failsafe;
        sm.arming_blocked = fc.arming_blocked;
        sm.rc = rc;
        sm.angle_max = cfg.angle_max;
        for (int i = 0; i < 3; i++) {
            sm.acro_max_rate[i] = cfg.acro_max_rate[i];
        }
        fn(&sm, ctx);
    }
}
