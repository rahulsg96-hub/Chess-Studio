/* Small vector and quaternion library for the flight controller (single precision).
 *
 * Frames: body is FRD (x forward, y right, z down), earth is NED (x north, y east, z down).
 * A quaternion q rotates body vectors into the earth frame: v_earth = q * v_body * q^-1.
 * Positive roll = right side down, positive pitch = nose up, positive yaw = nose right.
 */
#ifndef FC_MATH_H
#define FC_MATH_H

#include <math.h>

#define FC_PI      3.14159265f
#define FC_DEG2RAD (FC_PI / 180.0f)
#define FC_RAD2DEG (180.0f / FC_PI)
#define FC_GRAVITY 9.80665f

typedef struct { float x, y, z; } vec3_t;
typedef struct { float w, x, y, z; } quat_t;

static inline float fc_clampf(float v, float lo, float hi)
{
    return v < lo ? lo : (v > hi ? hi : v);
}

static inline vec3_t v3(float x, float y, float z)
{
    vec3_t v = {x, y, z};
    return v;
}

static inline vec3_t v3_add(vec3_t a, vec3_t b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline vec3_t v3_sub(vec3_t a, vec3_t b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline vec3_t v3_scale(vec3_t a, float s) { return v3(a.x * s, a.y * s, a.z * s); }
static inline float v3_dot(vec3_t a, vec3_t b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline float v3_norm(vec3_t a) { return sqrtf(v3_dot(a, a)); }

static inline vec3_t v3_cross(vec3_t a, vec3_t b)
{
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

quat_t quat_identity(void);
quat_t quat_mul(quat_t a, quat_t b);
quat_t quat_conj(quat_t q);
quat_t quat_normalize(quat_t q);

/* Body -> earth, and earth -> body. */
vec3_t quat_rotate(quat_t q, vec3_t v);
vec3_t quat_rotate_inv(quat_t q, vec3_t v);

/* Aerospace Z-Y-X order: yaw, then pitch, then roll. Angles in radians. */
quat_t quat_from_euler(float roll, float pitch, float yaw);
void quat_to_euler(quat_t q, float *roll, float *pitch, float *yaw);

/* Angle between the body z axis and the earth z axis, in radians. */
float quat_tilt(quat_t q);

#endif
