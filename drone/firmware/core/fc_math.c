#include "fc_math.h"

quat_t quat_identity(void)
{
    quat_t q = {1.0f, 0.0f, 0.0f, 0.0f};
    return q;
}

quat_t quat_mul(quat_t a, quat_t b)
{
    quat_t r = {
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
    return r;
}

quat_t quat_conj(quat_t q)
{
    quat_t r = {q.w, -q.x, -q.y, -q.z};
    return r;
}

quat_t quat_normalize(quat_t q)
{
    float n = sqrtf(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
    if (n < 1e-9f) {
        return quat_identity();
    }
    quat_t r = {q.w / n, q.x / n, q.y / n, q.z / n};
    return r;
}

vec3_t quat_rotate(quat_t q, vec3_t v)
{
    /* v' = v + w*t + u x t, with u = (x, y, z) and t = 2 * (u x v) */
    vec3_t u = v3(q.x, q.y, q.z);
    vec3_t t = v3_scale(v3_cross(u, v), 2.0f);
    return v3_add(v3_add(v, v3_scale(t, q.w)), v3_cross(u, t));
}

vec3_t quat_rotate_inv(quat_t q, vec3_t v)
{
    return quat_rotate(quat_conj(q), v);
}

quat_t quat_from_euler(float roll, float pitch, float yaw)
{
    float cr = cosf(roll * 0.5f), sr = sinf(roll * 0.5f);
    float cp = cosf(pitch * 0.5f), sp = sinf(pitch * 0.5f);
    float cy = cosf(yaw * 0.5f), sy = sinf(yaw * 0.5f);
    quat_t q = {
        cr * cp * cy + sr * sp * sy,
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
    };
    return q;
}

void quat_to_euler(quat_t q, float *roll, float *pitch, float *yaw)
{
    *roll = atan2f(2.0f * (q.w * q.x + q.y * q.z), 1.0f - 2.0f * (q.x * q.x + q.y * q.y));
    *pitch = asinf(fc_clampf(2.0f * (q.w * q.y - q.z * q.x), -1.0f, 1.0f));
    *yaw = atan2f(2.0f * (q.w * q.z + q.x * q.y), 1.0f - 2.0f * (q.y * q.y + q.z * q.z));
}

float quat_tilt(quat_t q)
{
    /* Element (2,2) of the rotation matrix is the cosine of the tilt. */
    return acosf(fc_clampf(1.0f - 2.0f * (q.x * q.x + q.y * q.y), -1.0f, 1.0f));
}
