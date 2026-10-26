/* Software-in-the-loop runner: the real flight-controller core flying the quad model, with a
 * scripted pilot per scenario. */
#ifndef SIM_H
#define SIM_H

#include <stdbool.h>
#include <stdint.h>

#include "flight.h"
#include "quad_model.h"

#define SIM_PHYSICS_HZ 8000

typedef struct {
    bool link_ok;
    double roll, pitch, yaw;    /* sticks -1..1; pitch forward = nose down */
    double throttle;            /* 0..1 */
    bool arm;
    fc_flight_mode_t mode;
} rc_command_t;

/* One record per flight-controller update. Angles in radians. */
typedef struct {
    double t;
    double pos[3], vel[3];
    double roll, pitch, yaw;            /* true attitude */
    double est_roll, est_pitch, est_yaw;
    double omega[3];                    /* true body rates */
    double gyro[3];                     /* filtered gyro, as the rate loop sees it */
    double rate_sp[3];
    double motor_cmd[QUAD_MOTORS];
    bool armed, on_ground;
    fc_failsafe_state_t failsafe;
    uint32_t arming_blocked;
    rc_command_t rc;
    double angle_max;                   /* from the config, to turn sticks into angles */
    double acro_max_rate[3];
} sim_sample_t;

typedef struct {
    const char *name;
    const char *summary;
    double duration;
    /* Optional: adjust the model, its starting state or the config before the run. */
    void (*setup)(quad_params_t *p, quad_state_t *s, fc_config_t *cfg);
    /* The pilot: sets the RC command at time t. It sees the true state, as a pilot sees the
     * drone. */
    void (*pilot)(double t, const quad_state_t *s, const quad_params_t *p, rc_command_t *rc);
} sim_scenario_t;

extern const sim_scenario_t sim_scenarios[];
extern const int sim_scenario_count;

const sim_scenario_t *sim_find_scenario(const char *name);

typedef void (*sim_sample_fn)(const sim_sample_t *sample, void *ctx);

/* Runs a scenario and calls fn after every flight-controller update. */
void sim_run(const sim_scenario_t *sc, uint64_t seed, sim_sample_fn fn, void *ctx);

#endif
