/* Requirement checks run against the simulator. Each check flies a scenario and compares a
 * measured number with a limit from docs/01-requirements.md, or with a simulator target
 * where no requirement exists yet. */
#ifndef SIM_CHECKS_H
#define SIM_CHECKS_H

#include <stdint.h>
#include <stdio.h>

/* Writes a Markdown report to `out` and returns the number of failed checks. */
int sim_check_all(FILE *out, uint64_t seed);

#endif
