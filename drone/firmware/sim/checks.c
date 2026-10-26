#include "checks.h"

#include <math.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "sim.h"

#define DEG (180.0 / 3.14159265358979)

typedef struct {
    sim_sample_t *s;
    size_t n, cap;
} trace_t;

static void record(const sim_sample_t *sample, void *ctx)
{
    trace_t *tr = ctx;
    if (tr->n == tr->cap) {
        tr->cap = tr->cap ? 2 * tr->cap : 4096;
        tr->s = realloc(tr->s, tr->cap * sizeof *tr->s);
        if (!tr->s) {
            abort();
        }
    }
    tr->s[tr->n++] = *sample;
}

static trace_t fly(const char *scenario, uint64_t seed)
{
    trace_t tr = {0};
    sim_run(sim_find_scenario(scenario), seed, record, &tr);
    return tr;
}

static double tilt_deg(const sim_sample_t *s)
{
    return acos(cos(s->roll) * cos(s->pitch)) * DEG;
}

typedef bool (*predicate_t)(const sim_sample_t *s);

/* First sample index at or after `from` where `pred` holds, or -1. */
static long find(const trace_t *tr, size_t from, predicate_t pred)
{
    for (size_t i = from; i < tr->n; i++) {
        if (pred(&tr->s[i])) {
            return (long)i;
        }
    }
    return -1;
}

static bool is_armed(const sim_sample_t *s) { return s->armed; }
static bool is_disarmed(const sim_sample_t *s) { return !s->armed; }
static bool is_on_ground(const sim_sample_t *s) { return s->on_ground; }
static bool link_lost(const sim_sample_t *s) { return !s->rc.link_ok; }
static bool switch_off(const sim_sample_t *s) { return !s->rc.arm; }
static bool in_stage1(const sim_sample_t *s) { return s->failsafe == FC_FAILSAFE_STAGE1; }
static bool in_landing(const sim_sample_t *s) { return s->failsafe == FC_FAILSAFE_LANDING; }
static bool failsafe_idle(const sim_sample_t *s) { return s->failsafe == FC_FAILSAFE_IDLE; }
static bool failsafe_active(const sim_sample_t *s) { return s->failsafe != FC_FAILSAFE_IDLE; }
static bool roll_rate_at_90pct(const sim_sample_t *s) { return s->omega[0] * DEG >= 180.0; }

static bool motors_stopped(const sim_sample_t *s)
{
    for (int i = 0; i < QUAD_MOTORS; i++) {
        if (s->motor_cmd[i] != 0.0) {
            return false;
        }
    }
    return true;
}

static size_t index_at(const trace_t *tr, double t)
{
    size_t i = 0;
    while (i < tr->n && tr->s[i].t < t) {
        i++;
    }
    return i;
}

typedef struct {
    FILE *out;
    int total, failed;
} report_t;

static void row(report_t *r, const char *check, const char *req, const char *measured, const char *limit,
                bool pass)
{
    r->total++;
    r->failed += pass ? 0 : 1;
    fprintf(r->out, "| %s | %s | %s | %s | %s |\n", check, req, measured, limit, pass ? "pass" : "**FAIL**");
}

static void rowf(report_t *r, const char *check, const char *req, double value, const char *unit,
                 const char *limit, bool pass)
{
    char measured[64];
    snprintf(measured, sizeof measured, "%.3g %s", value, unit);
    row(r, check, req, measured, limit, pass);
}

typedef struct {
    double rise, overshoot, settle;
} step_metrics_t;

/* Step response of `value(sample)` toward `target` starting at t0, judged until t1. */
static step_metrics_t step_response(const trace_t *tr, double t0, double t1, double target,
                                    double (*value)(const sim_sample_t *), double settle_band)
{
    step_metrics_t m = {NAN, 0.0, NAN};
    double t10 = NAN, t90 = NAN, peak = -INFINITY, last_out = t0;
    for (size_t i = index_at(tr, t0); i < tr->n && tr->s[i].t < t1; i++) {
        double v = value(&tr->s[i]);
        if (isnan(t10) && v >= 0.1 * target) {
            t10 = tr->s[i].t;
        }
        if (isnan(t90) && v >= 0.9 * target) {
            t90 = tr->s[i].t;
        }
        peak = v > peak ? v : peak;
        if (fabs(v - target) > settle_band) {
            last_out = tr->s[i].t;
        }
    }
    m.rise = t90 - t10;
    m.overshoot = (peak - target) / target * 100.0;
    m.settle = last_out - t0;
    return m;
}

static double est_roll_deg(const sim_sample_t *s) { return s->est_roll * DEG; }
static double est_pitch_deg(const sim_sample_t *s) { return s->est_pitch * DEG; }
static double roll_rate_dps(const sim_sample_t *s) { return s->omega[0] * DEG; }

static void check_hover(report_t *r, uint64_t seed)
{
    trace_t tr = fly("hover", seed);
    long armed = find(&tr, 0, is_armed);
    row(r, "Arms when every check passes (switch on at 1.5 s)", "REQ-S1",
        armed >= 0 ? "armed" : "not armed", "arms", armed >= 0 && tr.s[armed].t < 1.51);

    double sum = 0.0, est_sum = 0.0;
    size_t n = 0;
    for (size_t i = index_at(&tr, 6.0); i < tr.n; i++) {
        const sim_sample_t *s = &tr.s[i];
        double tilt = tilt_deg(s);
        double er = (s->est_roll - s->roll) * DEG, ep = (s->est_pitch - s->pitch) * DEG;
        sum += tilt * tilt;
        est_sum += er * er + ep * ep;
        n++;
    }
    double rms = sqrt(sum / (double)n);
    rowf(r, "Hover in turbulence: tilt error, RMS over 6-20 s", "REQ-P4", rms, "deg", "<= 2 deg", rms <= 2.0);
    double est_rms = sqrt(est_sum / (double)n);
    rowf(r, "Attitude estimate error in hover, RMS", "sim target", est_rms, "deg", "<= 1 deg", est_rms <= 1.0);
    free(tr.s);
}

static void check_angle_steps(report_t *r, uint64_t seed)
{
    /* Judged on the attitude the controller believes it has: that is what it controls. How far
     * that belief is from the truth is the estimator's job, checked separately below. */
    trace_t tr = fly("angle_step", seed);
    step_metrics_t roll = step_response(&tr, 8.0, 9.5, 20.0, est_roll_deg, 2.0);
    step_metrics_t pitch = step_response(&tr, 11.0, 12.5, 20.0, est_pitch_deg, 2.0);
    double drift = 0.0;
    for (size_t i = index_at(&tr, 8.0); i < tr.n && tr.s[i].t < 9.5; i++) {
        double d = fabs(tr.s[i].roll - tr.s[i].est_roll) * DEG;
        drift = d > drift ? d : drift;
    }
    free(tr.s);

    rowf(r, "ANGLE roll step 0 -> 20 deg: 10-90% rise time", "sim target", roll.rise, "s", "<= 0.30 s",
         roll.rise <= 0.30);
    rowf(r, "ANGLE roll step: overshoot", "sim target", roll.overshoot, "%", "<= 15%", roll.overshoot <= 15.0);
    rowf(r, "ANGLE roll step: settled within +/-2 deg", "sim target", roll.settle, "s", "<= 0.8 s",
         roll.settle <= 0.8);
    rowf(r, "ANGLE pitch step 0 -> 20 deg: 10-90% rise time", "sim target", pitch.rise, "s", "<= 0.30 s",
         pitch.rise <= 0.30);
    rowf(r, "ANGLE pitch step: overshoot", "sim target", pitch.overshoot, "%", "<= 15%", pitch.overshoot <= 15.0);
    rowf(r, "ANGLE pitch step: settled within +/-2 deg", "sim target", pitch.settle, "s", "<= 0.8 s",
         pitch.settle <= 0.8);
    rowf(r, "Attitude estimate drift in a 1.5 s, 20-degree bank (known limit until Block 4)", "sim target",
         drift, "deg", "<= 5 deg", drift <= 5.0);
}

static void check_acro_step(report_t *r, uint64_t seed)
{
    trace_t tr = fly("acro_step", seed);
    /* Judged from the stick step, so the rise time includes every delay in the loop. */
    long reached = find(&tr, index_at(&tr, 8.0), roll_rate_at_90pct);
    double rise = reached >= 0 ? tr.s[reached].t - 8.0 : INFINITY;
    step_metrics_t m = step_response(&tr, 8.0, 8.25, 200.0, roll_rate_dps, 20.0);
    long back = (long)index_at(&tr, 10.0);
    double roll_after = fabs(tr.s[back].roll * DEG);
    free(tr.s);

    rowf(r, "ACRO roll-rate step to 200 deg/s: time to 90%", "sim target", rise, "s", "<= 0.10 s", rise <= 0.10);
    rowf(r, "ACRO roll-rate step: overshoot", "sim target", m.overshoot, "%", "<= 20%", m.overshoot <= 20.0);
    rowf(r, "Back to level 1 s after switching ACRO -> ANGLE", "sim target", roll_after, "deg", "<= 3 deg",
         roll_after <= 3.0);
}

static void check_kill(report_t *r, uint64_t seed)
{
    trace_t tr = fly("kill", seed);
    long armed = find(&tr, 0, is_armed);
    long off = armed >= 0 ? find(&tr, (size_t)armed, switch_off) : -1;
    long stopped = off >= 0 ? find(&tr, (size_t)off, motors_stopped) : -1;
    double latency = stopped >= 0 ? (tr.s[stopped].t - tr.s[off].t) * 1000.0 : INFINITY;
    free(tr.s);
    rowf(r, "Kill switch: switch off to all motors stopped", "REQ-S2", latency, "ms", "<= 20 ms", latency <= 20.0);
}

static void check_link_loss(report_t *r, uint64_t seed)
{
    trace_t tr = fly("link_loss", seed);
    long lost = find(&tr, 0, link_lost);
    long stage1 = find(&tr, 0, in_stage1);
    long landing = find(&tr, 0, in_landing);
    long touchdown = lost >= 0 ? find(&tr, (size_t)lost, is_on_ground) : -1;
    long disarmed = lost >= 0 ? find(&tr, (size_t)lost, is_disarmed) : -1;

    double t_lost = lost >= 0 ? tr.s[lost].t : NAN;
    double d1 = stage1 >= 0 ? tr.s[stage1].t - t_lost : INFINITY;
    double d2 = landing >= 0 ? tr.s[landing].t - t_lost : INFINITY;
    double v_touch = touchdown >= 0 ? tr.s[touchdown].vel[2] : INFINITY;
    double disarm_after = (touchdown >= 0 && disarmed >= 0) ? tr.s[disarmed].t - tr.s[touchdown].t : INFINITY;
    double max_tilt = 0.0;
    for (size_t i = lost >= 0 ? (size_t)lost : tr.n; i < tr.n && tr.s[i].armed; i++) {
        double tilt = tilt_deg(&tr.s[i]);
        max_tilt = tilt > max_tilt ? tilt : max_tilt;
    }
    bool ends_safe = tr.n > 0 && !tr.s[tr.n - 1].armed && tr.s[tr.n - 1].on_ground;
    free(tr.s);

    rowf(r, "Link lost: failsafe stage 1 (level out) after", "REQ-S4", d1, "s", "0.5 s (+/-10 ms)",
         fabs(d1 - 0.5) <= 0.01);
    rowf(r, "Link lost: landing starts after", "REQ-S4", d2, "s", "3.0 s (+/-10 ms)", fabs(d2 - 3.0) <= 0.01);
    rowf(r, "Link lost: worst tilt until disarmed", "REQ-S4", max_tilt, "deg", "<= 10 deg", max_tilt <= 10.0);
    rowf(r, "Link lost: descent speed at touchdown", "sim target", v_touch, "m/s", "<= 1.5 m/s", v_touch <= 1.5);
    rowf(r, "Link lost: disarmed after touchdown", "REQ-S4", disarm_after, "s", "<= 0.5 s", disarm_after <= 0.5);
    row(r, "Link lost: ends disarmed on the ground", "REQ-S4", ends_safe ? "yes" : "no", "yes", ends_safe);
}

static void check_link_blips(report_t *r, uint64_t seed)
{
    trace_t tr = fly("link_blips", seed);
    long early = find(&tr, index_at(&tr, 8.0), failsafe_active);
    bool early_trip = early >= 0 && tr.s[early].t < 9.0;
    long stage1 = find(&tr, index_at(&tr, 10.0), in_stage1);
    bool stage1_hit = stage1 >= 0 && tr.s[stage1].t < 11.0;
    long landing = find(&tr, 0, in_landing);
    long recovered = find(&tr, index_at(&tr, 11.0), failsafe_idle);
    const sim_sample_t *end = &tr.s[tr.n - 1];
    bool flying = end->armed && -end->pos[2] > 1.0;
    double recover_t = recovered >= 0 ? tr.s[recovered].t - 11.0 : INFINITY;
    free(tr.s);

    row(r, "0.3 s link drop: no failsafe", "REQ-S4", early_trip ? "triggered" : "none", "none", !early_trip);
    row(r, "1 s link drop: stage 1, never landing", "REQ-S4",
        stage1_hit && landing < 0 ? "stage 1 only" : "wrong state", "stage 1 only", stage1_hit && landing < 0);
    rowf(r, "1 s link drop: pilot back in control after the link returns", "REQ-S4", recover_t * 1000.0, "ms",
         "<= 20 ms", recover_t <= 0.02);
    row(r, "1 s link drop: still flying afterwards", "REQ-S4", flying ? "yes" : "no", "yes", flying);
}

static void check_ground_link_loss(report_t *r, uint64_t seed)
{
    trace_t tr = fly("ground_link_loss", seed);
    long armed = find(&tr, 0, is_armed);
    long disarmed = armed >= 0 ? find(&tr, (size_t)armed, is_disarmed) : -1;
    double after = disarmed >= 0 ? tr.s[disarmed].t - 5.0 : INFINITY;
    double max_alt = 0.0;
    for (size_t i = 0; i < tr.n; i++) {
        max_alt = -tr.s[i].pos[2] > max_alt ? -tr.s[i].pos[2] : max_alt;
    }
    free(tr.s);
    rowf(r, "Link lost while idling on the ground: disarmed after", "REQ-S4", after, "s", "<= 0.6 s",
         armed >= 0 && after <= 0.6);
    rowf(r, "Link lost while idling on the ground: highest point", "REQ-S4", max_alt * 100.0, "cm", "<= 5 cm",
         max_alt <= 0.05);
}

static void check_arming_refusals(report_t *r, uint64_t seed)
{
    trace_t boot = fly("switch_on_at_boot", seed);
    long armed = find(&boot, 0, is_armed);
    bool flagged = (boot.s[boot.n - 1].arming_blocked & FC_ARMING_BLOCKED_SWITCH) != 0;
    free(boot.s);
    row(r, "Arm switch already on at power-up: refuses to arm", "REQ-S1", armed < 0 ? "refused" : "ARMED",
        "refused", armed < 0 && flagged);

    trace_t tilted = fly("tilted_arm", seed);
    armed = find(&tilted, 0, is_armed);
    flagged = (tilted.s[tilted.n - 1].arming_blocked & FC_ARMING_BLOCKED_ANGLE) != 0;
    free(tilted.s);
    row(r, "Held at 30 deg of roll: refuses to arm", "REQ-S1", armed < 0 ? "refused" : "ARMED", "refused",
        armed < 0 && flagged);
}

int sim_check_all(FILE *out, uint64_t seed)
{
    report_t r = {out, 0, 0};
    fprintf(out, "# Simulator requirement checks\n\n");
    fprintf(out, "_Generated by `quadsim check` (seed %llu); do not edit by hand._\n\n", (unsigned long long)seed);
    fprintf(out, "The flight-controller core flying the quad model of the 206 g build. \"sim target\" rows\n");
    fprintf(out, "are our own acceptance limits where no requirement exists yet.\n\n");
    fprintf(out, "| Check | Requirement | Measured | Limit | Result |\n|---|---|---|---|:-:|\n");

    check_hover(&r, seed);
    check_angle_steps(&r, seed);
    check_acro_step(&r, seed);
    check_kill(&r, seed);
    check_link_loss(&r, seed);
    check_link_blips(&r, seed);
    check_ground_link_loss(&r, seed);
    check_arming_refusals(&r, seed);

    fprintf(out, "\n%d of %d checks pass.\n", r.total - r.failed, r.total);
    return r.failed;
}
