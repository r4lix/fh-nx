#!/bin/bash
# run_game.sh <outfile> [configs...]: the full game bench under each engine configuration
cd "$(dirname "$0")"
OUT=$1; shift
R=/c/Users/Admin/Documents/fh-nx
NODE="/c/Users/Admin/AppData/Local/Programs/Microsoft VS Code/Code.exe"
FILES="${CFGFILE:-cfg_full.js} gl_consts.js shim.js $R/host/js/env.js $R/host/js/boot.js driver.js"
for c in ${@:-qjs v8-jitless v8-sparkplug v8-maglev v8-full}; do
  case $c in
    qjs) ./qrun.exe $c $FILES ;;
    qjs-sysmalloc) QRUN_SYSMALLOC=1 ./qrun.exe $c $FILES ;;
    qjs-*) ./qrun_${c#qjs-}.exe $c $FILES ;;
    v8-jitless) ELECTRON_RUN_AS_NODE=1 "$NODE" --jitless host_node.js $c $FILES ;;
    v8-sparkplug) ELECTRON_RUN_AS_NODE=1 "$NODE" --no-turbofan --no-maglev host_node.js $c $FILES ;;
    v8-maglev) ELECTRON_RUN_AS_NODE=1 "$NODE" --no-turbofan host_node.js $c $FILES ;;
    v8-full) ELECTRON_RUN_AS_NODE=1 "$NODE" host_node.js $c $FILES ;;
    v8-full-st) ELECTRON_RUN_AS_NODE=1 "$NODE" --single-threaded host_node.js $c $FILES ;;
    v8-jitless-st) ELECTRON_RUN_AS_NODE=1 "$NODE" --jitless --single-threaded host_node.js $c $FILES ;;
  esac 2>&1 | grep "^\[bench\]\|^\[host\]\|tick error" | tee -a "$OUT"
done
