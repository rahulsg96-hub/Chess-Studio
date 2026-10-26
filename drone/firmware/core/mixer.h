/* Quad-X mixer: turns a collective thrust and three torque commands into four motor
 * commands.
 *
 * Motor order and spin follow Betaflight's default (props in, seen from above):
 *   4 (front left, CW)    2 (front right, CCW)
 *   3 (rear left, CCW)    1 (rear right, CW)
 * Array index i is motor i + 1.
 */
#ifndef FC_MIXER_H
#define FC_MIXER_H

#include <stdbool.h>

#include "fc_math.h"

#define FC_MOTOR_COUNT 4

typedef struct {
    float roll, pitch, yaw;
} mixer_rule_t;

extern const mixer_rule_t fc_mixer_quad_x[FC_MOTOR_COUNT];

/* collective and outputs are 0..1 motor commands; torque is in the same units. The motors
 * never go below `idle`. If the torques can't fit between idle and full throttle they are
 * scaled down together (keeping the attitude correction's direction) and the function
 * returns true. The collective then moves as needed so the torques fit. */
bool mixer_mix(float collective, vec3_t torque, float idle, float motor[FC_MOTOR_COUNT]);

#endif
