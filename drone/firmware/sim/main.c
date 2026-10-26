/* quadsim: fly the flight-controller core in the simulator.
 *
 *   quadsim list                          list the scenarios
 *   quadsim run <scenario> [--csv FILE]   fly one, print a summary, optionally log it
 *   quadsim check                         run every requirement check (Markdown report)
 *
 * Add --seed N to any command to change the random turbulence and sensor noise.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "checks.h"
#include "sim.h"

#define DEG (180.0 / 3.14159265358979)
#define CSV_DECIMATE 4  /* log at 250 Hz */

typedef struct {
    FILE *csv;
    long n;
    double max_alt, max_tilt, armed_time, first_armed, flight_time;
    uint32_t arming_blocked;
} run_ctx_t;

static void on_sample(const sim_sample_t *s, void *vctx)
{
    run_ctx_t *c = vctx;
    double alt = -s->pos[2];
    double tilt = acos(cos(s->roll) * cos(s->pitch)) * DEG;

    c->max_alt = alt > c->max_alt ? alt : c->max_alt;
    c->arming_blocked = s->arming_blocked;
    if (s->armed) {
        c->max_tilt = tilt > c->max_tilt ? tilt : c->max_tilt;
        c->armed_time += 0.001;
        if (c->first_armed < 0.0) {
            c->first_armed = s->t;
        }
        if (!s->on_ground) {
            c->flight_time += 0.001;
        }
    }

    if (c->csv && c->n % CSV_DECIMATE == 0) {
        /* The angle the controller is asked for, where there is one (not in ACRO). */
        double sp_roll = NAN, sp_pitch = NAN;
        if (s->armed && s->failsafe != FC_FAILSAFE_IDLE) {
            sp_roll = sp_pitch = 0.0;
        } else if (s->armed && s->rc.mode == FC_MODE_ANGLE) {
            sp_roll = s->rc.roll * s->angle_max * DEG;
            sp_pitch = -s->rc.pitch * s->angle_max * DEG;
        }
        fprintf(c->csv,
                "%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,"
                "%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,"
                "%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,"
                "%.4f,%.4f,%.4f,%.4f,%d,%d,%d,%.3f,%.3f,%.3f,%.3f,%d,%.3f,%.3f\n",
                s->t, s->pos[0], s->pos[1], alt, s->vel[0], s->vel[1], -s->vel[2],
                s->roll * DEG, s->pitch * DEG, s->yaw * DEG, s->est_roll * DEG, s->est_pitch * DEG, s->est_yaw * DEG,
                s->omega[0] * DEG, s->omega[1] * DEG, s->omega[2] * DEG, s->gyro[0] * DEG, s->gyro[1] * DEG,
                s->gyro[2] * DEG, s->rate_sp[0] * DEG, s->rate_sp[1] * DEG, s->rate_sp[2] * DEG,
                s->motor_cmd[0], s->motor_cmd[1], s->motor_cmd[2], s->motor_cmd[3], s->armed, (int)s->failsafe,
                s->rc.link_ok, s->rc.roll, s->rc.pitch, s->rc.yaw, s->rc.throttle, (int)s->rc.mode, sp_roll,
                sp_pitch);
    }
    c->n++;
}

static int usage(void)
{
    fprintf(stderr, "usage: quadsim list | run <scenario> [--csv FILE] | check   [--seed N]\n");
    return 2;
}

int main(int argc, char **argv)
{
    unsigned long long seed = 1;
    const char *csv_path = NULL;
    const char *positional[2] = {NULL, NULL};
    int npos = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            seed = strtoull(argv[++i], NULL, 10);
        } else if (strcmp(argv[i], "--csv") == 0 && i + 1 < argc) {
            csv_path = argv[++i];
        } else if (npos < 2) {
            positional[npos++] = argv[i];
        } else {
            return usage();
        }
    }
    if (npos == 0) {
        return usage();
    }

    if (strcmp(positional[0], "list") == 0) {
        for (int i = 0; i < sim_scenario_count; i++) {
            printf("%-18s %s\n", sim_scenarios[i].name, sim_scenarios[i].summary);
        }
        return 0;
    }

    if (strcmp(positional[0], "check") == 0) {
        return sim_check_all(stdout, seed) == 0 ? 0 : 1;
    }

    if (strcmp(positional[0], "run") == 0 && npos == 2) {
        const sim_scenario_t *sc = sim_find_scenario(positional[1]);
        if (!sc) {
            fprintf(stderr, "unknown scenario '%s' (try: quadsim list)\n", positional[1]);
            return 2;
        }
        run_ctx_t ctx = {0};
        ctx.first_armed = -1.0;
        if (csv_path) {
            ctx.csv = fopen(csv_path, "w");
            if (!ctx.csv) {
                perror(csv_path);
                return 1;
            }
            fprintf(ctx.csv, "t,x,y,alt,vx,vy,climb,roll,pitch,yaw,est_roll,est_pitch,est_yaw,"
                             "p,q,r,gyro_p,gyro_q,gyro_r,sp_p,sp_q,sp_r,m1,m2,m3,m4,armed,failsafe,"
                             "link_ok,rc_roll,rc_pitch,rc_yaw,rc_throttle,mode,sp_roll,sp_pitch\n");
        }
        sim_run(sc, seed, on_sample, &ctx);
        if (ctx.csv) {
            fclose(ctx.csv);
        }
        printf("%s: %s\n", sc->name, sc->summary);
        printf("  armed at          %s%.3f s\n", ctx.first_armed < 0 ? "never " : "", ctx.first_armed);
        printf("  time in the air   %.2f s\n", ctx.flight_time);
        printf("  highest point     %.2f m\n", ctx.max_alt);
        printf("  worst tilt armed  %.1f deg\n", ctx.max_tilt);
        printf("  arming blocked by 0x%02x at the end (flags in core/flight.h)\n", (unsigned)ctx.arming_blocked);
        if (csv_path) {
            printf("  log               %s (250 Hz; angles in deg, rates in deg/s)\n", csv_path);
        }
        return 0;
    }

    return usage();
}
