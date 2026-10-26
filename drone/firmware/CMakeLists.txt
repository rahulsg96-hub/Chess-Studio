cmake_minimum_required(VERSION 3.16)
project(drone_firmware C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_compile_options(-Wall -Wextra -Wpedantic -Wshadow -Wfloat-conversion -Werror)

# The flight-controller core: portable C with no hardware access. It runs on the STM32F405's
# single-precision FPU, so accidental double-precision maths is an error here.
add_library(fc_core STATIC
  core/fc_math.c
  core/filter.c
  core/pid.c
  core/mahony.c
  core/mixer.c
  core/flight.c)
target_include_directories(fc_core PUBLIC core)
target_compile_options(fc_core PRIVATE -Wdouble-promotion)
target_link_libraries(fc_core PUBLIC m)

# The simulator: a quad model plus scenarios and requirement checks, flying fc_core.
add_library(quadsim_lib STATIC
  sim/quad_model.c
  sim/sim.c
  sim/checks.c)
target_include_directories(quadsim_lib PUBLIC sim)
target_link_libraries(quadsim_lib PUBLIC fc_core)

add_executable(quadsim sim/main.c)
target_link_libraries(quadsim PRIVATE quadsim_lib)

enable_testing()
add_executable(test_core tests/test_core.c)
target_link_libraries(test_core PRIVATE fc_core)
add_test(NAME core_unit_tests COMMAND test_core)
add_test(NAME sim_requirement_checks COMMAND quadsim check)
