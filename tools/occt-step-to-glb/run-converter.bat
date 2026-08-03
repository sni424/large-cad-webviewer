@echo off
setlocal

set "OCCT_ROOT=C:\opencascade-8.0.1-vc14-64-combined"
set "CASROOT=%OCCT_ROOT%\opencascade-8.0.1-vc14-64"
set "THIRDPARTY_DIR=%OCCT_ROOT%\3rdparty-vc14-64"

set "PATH=%CASROOT%\win64\vc14\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\angle-gles2-2.1.0-vc14-64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\ffmpeg-3.3.4-64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\freeimage-3.18.0-x64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\freetype-2.13.3-x64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\gl2ps-1.3.8-vc14-64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\jemalloc-vc14-64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\lzma-5.2.2-vc14-64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\openvr-1.14.15-64\bin\win64;%PATH%"
set "PATH=%THIRDPARTY_DIR%\tbb-2021.13.0-x64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\tcltk-8.6.15-x64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\vtk-9.4.1-x64\bin;%PATH%"
set "PATH=%THIRDPARTY_DIR%\zlib-1.2.8-vc14-64\bin;%PATH%"

set "CSF_OCCTResourcePath=%CASROOT%\src"
set "CSF_STEPDefaults=%CSF_OCCTResourcePath%\XSTEPResource"
set "CSF_XSMessage=%CSF_OCCTResourcePath%\XSMessage"
set "CSF_SHMessage=%CSF_OCCTResourcePath%\SHMessage"
set "CSF_XCAFDefaults=%CSF_OCCTResourcePath%\StdResource"
set "CSF_PluginDefaults=%CSF_OCCTResourcePath%\StdResource"

"%~dp0build\Release\occt-step-to-glb.exe" %*
