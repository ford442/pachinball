# Distributed under the OSI-approved BSD 3-Clause License.  See accompanying
# file Copyright.txt or https://cmake.org/licensing for details.

cmake_minimum_required(VERSION 3.5)

file(MAKE_DIRECTORY
  "/root/pachinball/native/build-san/_deps/catch2-src"
  "/root/pachinball/native/build-san/_deps/catch2-build"
  "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix"
  "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix/tmp"
  "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix/src/catch2-populate-stamp"
  "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix/src"
  "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix/src/catch2-populate-stamp"
)

set(configSubDirs )
foreach(subDir IN LISTS configSubDirs)
    file(MAKE_DIRECTORY "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix/src/catch2-populate-stamp/${subDir}")
endforeach()
if(cfgdir)
  file(MAKE_DIRECTORY "/root/pachinball/native/build-san/_deps/catch2-subbuild/catch2-populate-prefix/src/catch2-populate-stamp${cfgdir}") # cfgdir has leading slash
endif()
