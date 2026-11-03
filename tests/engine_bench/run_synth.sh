#!/bin/bash
# Runs the synthetic suite under every engine configuration available on this PC. Usage: run_synth.sh <outfile> [bench...]
cd "$(dirname "$0")"
OUT=${1:-results_synth.txt}; shift
BENCHES=${@:-richards deltablue splay raytrace}
NODE="/c/Users/Admin/AppData/Local/Programs/Microsoft VS Code/Code.exe"
for b in $BENCHES; do cat bench/prelude.js bench/$b.js > run/$b.js; done
declare -A CFG
CFG[qjs-O2]="./qjs_o2.exe -C"
CFG[v8-jitless]="NODE --jitless"
CFG[v8-sparkplug]="NODE --no-turbofan --no-maglev"
CFG[v8-maglev]="NODE --no-turbofan"
CFG[v8-full]="NODE"
ORDER=${ORDER:-"qjs-O2 v8-jitless v8-sparkplug v8-maglev v8-full"}
for b in $BENCHES; do
  for c in $ORDER; do
    cmd=${CFG[$c]}
    if [[ $cmd == NODE* ]]; then
      line=$(ELECTRON_RUN_AS_NODE=1 "$NODE" ${cmd#NODE} run/$b.js 2>&1 | grep RESULT)
    else
      line=$($cmd run/$b.js 2>&1 | grep RESULT)
    fi
    echo "$c $line" | tee -a "$OUT"
  done
done
