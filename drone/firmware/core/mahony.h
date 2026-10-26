/* Mahony complementary filter: integrates the gyro and pulls the attitude toward the
 * gravity direction measured by the accelerometer.
 *
 * Known limitation: in sustained accelerated flight the accelerometer sees thrust, not just
 * gravity, so the flight gain is kept small. The altitude/position estimator (Block 4) will
 * replace this with an EKF that also uses velocity.
 */
#ifndef FC_MAHONY_H
#define FC_MAHONY_H

#include "fc_math.h"

typedef struct {
    quat_t q;
    vec3_t integral;    /* gyro bias correction, rad/s */
    float kp, ki;
} mahony_t;

void mahony_init(mahony_t *m, float kp, float ki);

/* Jump straight to the roll and pitch implied by gravity (yaw = 0). Used at boot. */
void mahony_reset_to_accel(mahony_t *m, vec3_t accel);

/* gyro in rad/s and accel in m/s^2, both body frame. The accel correction is weighted
 * down as its magnitude moves away from 1 g, and ignored beyond +/-15%. */
void mahony_update(mahony_t *m, vec3_t gyro, vec3_t accel, float dt);

#endif
