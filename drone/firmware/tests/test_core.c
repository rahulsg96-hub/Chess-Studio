/* Unit tests for the flight-controller core: maths, filters, PID, mixer, attitude estimator,
 * and the arming and failsafe logic driven with synthetic inputs. */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "fc_math.h"
#include "filter.h"
#include "flight.h"
#include "mahony.h"
#include "mixer.h"
#include "pid.h"

static int checks, failures;

#define CHECK(cond, ...)                                       \
    do {                                                       \
        checks++;                                              \
        if (!(cond)) {                                         \
            failures++;                                        \
            printf("FAIL %s:%d: ", __FILE__, __LINE__);        \
            printf(__VA_ARGS__);                               \
            printf("\n");                                      \
        }                                                      \
    } while (0)

static bool near(float a, float b, float tol)
{
    return fabsf(a - b) <= tol;
}

static void test_math(void)
{
    float r, p, y;
    quat_t q = quat_from_euler(0.3f, -0.2f, 1.0f);
    quat_to_euler(q, &r, &p, &y);
    CHECK(near(r, 0.3f, 1e-5f) && near(p, -0.2f, 1e-5f) && near(y, 1.0f, 1e-5f),
          "euler round trip gave %f %f %f", (double)r, (double)p, (double)y);

    vec3_t v = v3(1.0f, 2.0f, 3.0f);
    vec3_t back = quat_rotate_inv(q, quat_rotate(q, v));
    CHECK(near(back.x, 1.0f, 1e-5f) && near(back.y, 2.0f, 1e-5f) && near(back.z, 3.0f, 1e-5f),
          "rotate then inverse-rotate should be identity");

    /* Rolling right moves the body y axis (right) downward: +z in the earth frame. */
    vec3_t right = quat_rotate(quat_from_euler(0.5f, 0.0f, 0.0f), v3(0.0f, 1.0f, 0.0f));
    CHECK(right.z > 0.4f, "positive roll should lower the right side, got z=%f", (double)right.z);

    CHECK(near(quat_tilt(quat_from_euler(0.0f, 0.4f, 2.0f)), 0.4f, 1e-4f), "tilt ignores yaw");
}

static void test_filters(void)
{
    pt1_filter_t pt1;
    pt1_init(&pt1, 10.0f, 0.001f);
    float out = 0.0f;
    for (int i = 0; i < 2000; i++) {
        out = pt1_apply(&pt1, 1.0f);
    }
    CHECK(near(out, 1.0f, 1e-3f), "PT1 should settle at the input, got %f", (double)out);

    /* Low-pass: unity at DC, strong attenuation at 4x the cutoff. */
    biquad_t lp;
    biquad_init_lowpass(&lp, 100.0f, 2000.0f);
    for (int i = 0; i < 2000; i++) {
        out = biquad_apply(&lp, 1.0f);
    }
    CHECK(near(out, 1.0f, 1e-3f), "low-pass DC gain should be 1, got %f", (double)out);

    biquad_init_lowpass(&lp, 100.0f, 2000.0f);
    float peak = 0.0f;
    for (int i = 0; i < 4000; i++) {
        out = biquad_apply(&lp, sinf(2.0f * FC_PI * 400.0f * (float)i / 2000.0f));
        if (i > 2000) {
            peak = fmaxf(peak, fabsf(out));
        }
    }
    CHECK(peak < 0.08f, "400 Hz through a 100 Hz low-pass should be < -22 dB, got %f", (double)peak);

    biquad_t notch;
    biquad_init_notch(&notch, 300.0f, 3.0f, 2000.0f);
    peak = 0.0f;
    for (int i = 0; i < 4000; i++) {
        out = biquad_apply(&notch, sinf(2.0f * FC_PI * 300.0f * (float)i / 2000.0f));
        if (i > 2000) {
            peak = fmaxf(peak, fabsf(out));
        }
    }
    CHECK(peak < 0.01f, "notch should remove its centre frequency, got %f", (double)peak);
}

static void test_pid(void)
{
    pid_ctrl_t pid;
    pid_gains_t g = {2.0f, 10.0f, 0.0f, 0.5f};
    pid_init(&pid, 80.0f, 0.001f);

    float out = pid_update(&pid, &g, 1.0f, 0.0f, 0.001f, 0.0f);
    CHECK(near(out, 2.0f, 1e-6f), "P only (integration held) should give kp*error, got %f", (double)out);

    for (int i = 0; i < 10000; i++) {
        out = pid_update(&pid, &g, 1.0f, 0.0f, 0.001f, 1.0f);
    }
    CHECK(near(out, 2.5f, 1e-4f), "I term should clamp at i_limit (2 + 0.5), got %f", (double)out);

    float held = pid.integral;
    pid_update(&pid, &g, -5.0f, 0.0f, 0.001f, 0.0f);
    CHECK(pid.integral == held, "i_scale 0 should hold the integral");

    pid_reset(&pid, 0.0f);
    pid_update(&pid, &g, 1.0f, 0.0f, 0.001f, 0.5f);
    CHECK(near(pid.integral, 0.0005f, 1e-9f), "i_scale 0.5 should integrate at half speed");

    /* Derivative acts on the measurement: a setpoint jump causes no D kick. */
    pid_gains_t d_only = {0.0f, 0.0f, 1.0f, 0.0f};
    pid_reset(&pid, 0.0f);
    out = pid_update(&pid, &d_only, 100.0f, 0.0f, 0.001f, 1.0f);
    CHECK(near(out, 0.0f, 1e-6f), "setpoint step should not kick the D term, got %f", (double)out);
    out = pid_update(&pid, &d_only, 100.0f, 0.1f, 0.001f, 1.0f);
    CHECK(out < 0.0f, "a rising measurement should give a negative D term, got %f", (double)out);
}

static void test_mixer(void)
{
    float m[FC_MOTOR_COUNT];
    bool sat = mixer_mix(0.5f, v3(0.0f, 0.0f, 0.0f), 0.04f, m);
    CHECK(!sat && near(m[0], 0.5f, 1e-6f) && near(m[3], 0.5f, 1e-6f), "no torque: all motors at collective");

    mixer_mix(0.5f, v3(0.1f, 0.0f, 0.0f), 0.04f, m);
    CHECK(m[2] > 0.5f && m[3] > 0.5f && m[0] < 0.5f && m[1] < 0.5f, "roll right speeds up the left motors (3, 4)");

    mixer_mix(0.5f, v3(0.0f, 0.1f, 0.0f), 0.04f, m);
    CHECK(m[1] > 0.5f && m[3] > 0.5f, "pitch up speeds up the front motors (2, 4)");

    mixer_mix(0.5f, v3(0.0f, 0.0f, 0.1f), 0.04f, m);
    CHECK(m[1] > 0.5f && m[2] > 0.5f, "yaw right speeds up the counter-clockwise motors (2, 3)");

    sat = mixer_mix(0.9f, v3(0.8f, 0.0f, 0.0f), 0.04f, m);
    bool in_range = true;
    for (int i = 0; i < FC_MOTOR_COUNT; i++) {
        in_range = in_range && m[i] >= 0.04f && m[i] <= 1.0f;
    }
    CHECK(sat && in_range, "a torque too big to fit is scaled into [idle, 1] and reported");
    CHECK(near(m[2] - m[0], 0.96f, 1e-5f), "saturated roll still uses the full range, got %f", (double)(m[2] - m[0]));
}

static void test_mahony(void)
{
    /* Gravity as measured when rolled 20 degrees right. */
    float roll = 20.0f * FC_DEG2RAD;
    vec3_t accel = v3(0.0f, -FC_GRAVITY * sinf(roll), -FC_GRAVITY * cosf(roll));

    mahony_t m;
    mahony_init(&m, 2.0f, 0.0f);
    for (int i = 0; i < 5000; i++) {
        mahony_update(&m, v3(0.0f, 0.0f, 0.0f), accel, 0.001f);
    }
    float r, p, y;
    quat_to_euler(m.q, &r, &p, &y);
    CHECK(near(r, roll, 0.5f * FC_DEG2RAD) && near(p, 0.0f, 0.5f * FC_DEG2RAD),
          "estimator should converge to the gravity direction, got roll %f", (double)(r * FC_RAD2DEG));

    mahony_reset_to_accel(&m, accel);
    quat_to_euler(m.q, &r, &p, &y);
    CHECK(near(r, roll, 1e-4f), "reset_to_accel should take roll straight from gravity");
}

/* --- Arming and failsafe ---------------------------------------------------------------- */

static fc_inputs_t level_inputs(void)
{
    fc_inputs_t in;
    memset(&in, 0, sizeof in);
    in.rc_link_ok = true;
    in.rc_mode = FC_MODE_ANGLE;
    in.accel = v3(0.0f, 0.0f, -FC_GRAVITY);
    in.gyro_ok = true;
    return in;
}

/* Runs the controller for `seconds` with a still gyro and the given inputs. */
static void run(fc_t *fc, const fc_inputs_t *in, float seconds, float motors[FC_MOTOR_COUNT])
{
    int loops = (int)(seconds * fc->cfg.loop_hz + 0.5f);
    for (int i = 0; i < loops; i++) {
        fc_gyro_sample(fc, v3(0.0f, 0.0f, 0.0f));
        fc_gyro_sample(fc, v3(0.0f, 0.0f, 0.0f));
        fc_update(fc, in, motors);
    }
}

static void boot(fc_t *fc)
{
    fc_config_t cfg;
    fc_config_defaults(&cfg);
    fc_init(fc, &cfg);
}

static void test_arming(void)
{
    fc_t fc;
    float m[FC_MOTOR_COUNT];
    fc_inputs_t in = level_inputs();

    boot(&fc);
    run(&fc, &in, 0.2f, m);
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    CHECK(!fc.armed && (fc.arming_blocked & FC_ARMING_BLOCKED_GYRO_CAL), "no arming before gyro calibration");

    boot(&fc);
    in = level_inputs();
    run(&fc, &in, 1.2f, m);
    CHECK(fc.arming_blocked == 0, "nothing should block arming, flags %x", (unsigned)fc.arming_blocked);
    in.rc_arm = true;
    run(&fc, &in, 0.001f, m);
    CHECK(fc.armed, "arms on the switch's rising edge once checks pass");
    CHECK(m[0] > 0.0f, "armed motors idle");
    in.rc_arm = false;
    run(&fc, &in, 0.001f, m);
    CHECK(!fc.armed && m[0] == 0.0f && m[3] == 0.0f, "switch off kills the motors in the same update");

    boot(&fc);
    in = level_inputs();
    in.rc_arm = true;
    run(&fc, &in, 1.5f, m);
    CHECK(!fc.armed && (fc.arming_blocked & FC_ARMING_BLOCKED_SWITCH), "switch on at power-up never arms");
    in.rc_arm = false;
    run(&fc, &in, 0.01f, m);
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    CHECK(fc.armed, "arms after the switch is cycled");

    boot(&fc);
    in = level_inputs();
    run(&fc, &in, 1.2f, m);
    in.rc_throttle = 0.3f;
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    CHECK(!fc.armed && (fc.arming_blocked & FC_ARMING_BLOCKED_THROTTLE), "throttle up blocks arming");
    in.rc_throttle = 0.0f;
    run(&fc, &in, 0.01f, m);
    CHECK(!fc.armed, "lowering the throttle alone doesn't arm: the switch must be cycled");

    boot(&fc);
    in = level_inputs();
    float tilt = 30.0f * FC_DEG2RAD;
    in.accel = v3(0.0f, -FC_GRAVITY * sinf(tilt), -FC_GRAVITY * cosf(tilt));
    run(&fc, &in, 1.2f, m);
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    CHECK(!fc.armed && (fc.arming_blocked & FC_ARMING_BLOCKED_ANGLE), "30 degrees of tilt blocks arming");

    boot(&fc);
    in = level_inputs();
    run(&fc, &in, 1.2f, m);
    in.rc_link_ok = false;
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    CHECK(!fc.armed && (fc.arming_blocked & FC_ARMING_BLOCKED_RC_LINK), "no RC link blocks arming");
}

static void test_failsafe(void)
{
    fc_t fc;
    float m[FC_MOTOR_COUNT];
    fc_inputs_t in = level_inputs();

    /* In flight: throttle up, then the link drops. */
    boot(&fc);
    run(&fc, &in, 1.2f, m);
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    in.rc_throttle = 0.5f;
    run(&fc, &in, 1.0f, m);
    in.rc_link_ok = false;
    run(&fc, &in, 0.499f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_IDLE, "no failsafe before 0.5 s");
    run(&fc, &in, 0.002f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_STAGE1, "stage 1 at 0.5 s");
    run(&fc, &in, 2.498f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_STAGE1, "still stage 1 before 3 s");
    run(&fc, &in, 0.002f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_LANDING, "landing at 3 s");
    CHECK(near(fc.collective, fc.cfg.failsafe_throttle, 1e-6f), "landing uses the failsafe throttle");

    in.rc_link_ok = true;
    run(&fc, &in, 0.1f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_LANDING && fc.armed, "a returning link doesn't cancel the landing");

    in.accel = v3(0.0f, 0.0f, -2.5f * FC_GRAVITY);
    run(&fc, &in, 0.05f, m);
    CHECK(!fc.armed, "touchdown impact disarms");

    /* Stage 1 then the link returns: control goes back to the pilot. */
    boot(&fc);
    in = level_inputs();
    run(&fc, &in, 1.2f, m);
    in.rc_arm = true;
    run(&fc, &in, 0.01f, m);
    in.rc_throttle = 0.5f;
    run(&fc, &in, 1.0f, m);
    in.rc_link_ok = false;
    run(&fc, &in, 1.0f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_STAGE1, "stage 1 after 1 s without link");
    in.rc_link_ok = true;
    run(&fc, &in, 0.001f, m);
    CHECK(fc.failsafe == FC_FAILSAFE_IDLE && fc.armed, "link back during stage 1 returns control");

    /* Idling on the ground at zero throttle: losing the link just disarms. */
    boot(&fc);
    in = level_inputs();
    run(&fc, &in, 1.2f, m);
    in.rc_arm = true;
    run(&fc, &in, 2.0f, m);
    in.rc_link_ok = false;
    run(&fc, &in, 0.51f, m);
    CHECK(!fc.armed, "link lost on the ground with zero throttle disarms");
}

int main(void)
{
    test_math();
    test_filters();
    test_pid();
    test_mixer();
    test_mahony();
    test_arming();
    test_failsafe();
    printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
