cmake_minimum_required(VERSION 3.24)

project(occt_step_to_glb LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(OCCT_BUNDLE_ROOT "C:/opencascade-8.0.1-vc14-64-combined" CACHE PATH "OCCT combined package root")
set(OCCT_BUNDLED_VTK_DIR "${OCCT_BUNDLE_ROOT}/3rdparty-vc14-64/vtk-9.4.1-x64/lib/cmake/vtk-9.4")
if (EXISTS "${OCCT_BUNDLED_VTK_DIR}/vtk-config.cmake" AND NOT VTK_DIR)
  set(VTK_DIR "${OCCT_BUNDLED_VTK_DIR}" CACHE PATH "Bundled VTK config directory" FORCE)
endif()

find_package(VTK REQUIRED CONFIG)

find_package(OpenCASCADE REQUIRED COMPONENTS
  FoundationClasses
  ModelingData
  ModelingAlgorithms
  Visualization
  ApplicationFramework
  DataExchange
)

set(OCCT_STEP_TO_GLB_LIBRARIES
  ${OpenCASCADE_FoundationClasses_LIBRARIES}
  ${OpenCASCADE_ModelingData_LIBRARIES}
  ${OpenCASCADE_ModelingAlgorithms_LIBRARIES}
  ${OpenCASCADE_Visualization_LIBRARIES}
  ${OpenCASCADE_ApplicationFramework_LIBRARIES}
  ${OpenCASCADE_DataExchange_LIBRARIES}
)

add_executable(occt-step-to-glb
  src/main.cpp
)

target_include_directories(occt-step-to-glb PRIVATE
  ${OpenCASCADE_INCLUDE_DIR}
)

target_link_libraries(occt-step-to-glb PRIVATE
  ${OCCT_STEP_TO_GLB_LIBRARIES}
)

if (MSVC)
  target_compile_options(occt-step-to-glb PRIVATE /W4 /permissive-)
else()
  target_compile_options(occt-step-to-glb PRIVATE -Wall -Wextra -Wpedantic)
endif()
