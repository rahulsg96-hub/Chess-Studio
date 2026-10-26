#include "mahony.h"

void mahony_init(mahony_t *m, float kp, float ki)
{
    m->q = quat_identity();
    m->integral = v3(0.0f, 0.0f, 0.0f);
    m->kp = kp;
    m->ki = ki;
}

void mahony_reset_to_accel(mahony_t *m, vec3_t accel)
{
    /* At rest the accelerometer reads the reaction to gravity: (0, 0, -g) when level. */
    float roll = atan2f(-accel.y, -accel.z);
    float pitch = atan2f(accel.x, sqrtf(accel.y * accel.y + accel.z * accel.z));
    m->q = quat_from_euler(roll, pitch, 0.0f);
    m->integral = v3(0.0f, 0.0f, 0.0f);
}

void mahony_update(mahony_t *m, vec3_t gyro, vec3_t accel, float dt)
{
    vec3_t omega = gyro;
    float norm = v3_norm(accel);

    /* Trust the accelerometer fully at 1 g and not at all beyond +/-15%: away from 1 g the
     * drone is accelerating and the reading isn't just gravity. */
    float weight = 1.0f - fabsf(norm / FC_GRAVITY - 1.0f) / 0.15f;
    if (weight > 0.0f) {
        vec3_t measured = v3_scale(accel, 1.0f / norm);
        vec3_t estimated = quat_rotate_inv(m->q, v3(0.0f, 0.0f, -1.0f));
        vec3_t error = v3_scale(v3_cross(measured, estimated), weight);
        if (m->ki > 0.0f) {
            m->integral = v3_add(m->integral, v3_scale(error, m->ki * dt));
        }
        omega = v3_add(omega, v3_add(v3_scale(error, m->kp), m->integral));
    }

    quat_t rate = {0.0f, omega.x, omega.y, omega.z};
    quat_t q_dot = quat_mul(m->q, rate);
    m->q.w += 0.5f * q_dot.w * dt;
    m->q.x += 0.5f * q_dot.x * dt;
    m->q.y += 0.5f * q_dot.y * dt;
    m->q.z += 0.5f * q_dot.z * dt;
    m->q = quat_normalize(m->q);
}
